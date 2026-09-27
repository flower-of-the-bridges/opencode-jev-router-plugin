import type { RuntimeConfig } from "./config"
import {
    resolveModel,
    saveDecision,
    type JsonStorage,
    type StoredDecision,
} from "./decision"
import { describeDecision, formatDecisionBlock } from "./display"
import { buildConversation, type HistoryMessage } from "./history"
import {
    askJev,
    buildJevRequest,
    type FetchLike,
    type JevRoutingResponse,
    type RoutingFile,
    type RoutingSkill,
} from "./jev"
import type { Logger } from "./logger"
import { estimateFileTokens, estimateTokens, stripMentions, type Mention } from "./text"
import { addUsage } from "./usage"

export interface PromptEvent {
    readonly sessionID: string
    readonly messageID: string
    prompt: {
        text: string
        files?: Array<{
            uri: string
            name?: string
            mention?: Mention
        }>
        skills?: Array<{
            id: string
            mention?: Mention
        }>
        agents?: Array<{
            name: string
            mention?: Mention
        }>
    }
}

export interface PromptRouterDeps {
    config: RuntimeConfig
    logger: Logger
    storage: JsonStorage
    session: {
        switchModel(input: {
            sessionID: string
            model: { providerID: string; id: string }
        }): Promise<void>
        synthetic(input: {
            sessionID: string
            text: string
            description?: string
            resume?: boolean
        }): Promise<unknown>
        context(input: { sessionID: string }): Promise<readonly HistoryMessage[]>
    }
    /** Base URL of the provider hosting the JEV classifier, or undefined. */
    getRouterBaseUrl: () => Promise<string | undefined>
    /** API key for the router provider, or undefined. */
    getRouterApiKey: () => Promise<string | undefined>
    listSkills: () => Promise<Array<{ id: string; description?: string; content?: string }>>
    /** Canonical project directory, sent as classifier context. */
    repository?: string
    /** Registry check for a resolved model; when it reports false the plugin uses the fallback. */
    modelAvailable?: (providerID: string, modelID: string) => Promise<boolean>
    fetchImpl?: FetchLike
}

/**
 * Create the `session.hook("prompt", ...)` handler. The hook must never
 * throw: prompt admission fails otherwise, so every routing error is
 * contained and lands on the fallback model instead.
 */
export function createPromptRouter(deps: PromptRouterDeps) {
    const { config, logger, storage, session } = deps

    return async function onPrompt(event: PromptEvent): Promise<void> {
        const { messageID, sessionID, prompt } = event
        const text = prompt.text ?? ""

        if (!text.trim()) {
            logger.debug("skipped: empty prompt")
            return
        }

        const trimmedText = text.trimStart()

        if (config.ignoredPrefixes.some((prefix) => trimmedText.startsWith(prefix))) {
            logger.debug("skipped: ignored prefix", trimmedText.slice(0, 32))
            return
        }

        const mentionedAgents = prompt.agents ?? []

        if (mentionedAgents.some((agent) => config.ignoredAgents.includes(agent.name))) {
            logger.debug("skipped: ignored agent mention", mentionedAgents.map((a) => a.name))
            return
        }

        const routerBaseUrl = await deps.getRouterBaseUrl()

        if (!routerBaseUrl) {
            logger.warn(`provider ${config.router.provider} not found; skipping routing`)
            return
        }

        try {
            await routePrompt(event, routerBaseUrl)
        } catch (error: unknown) {
            logger.error("jev routing failed, using fallback:", error)

            try {
                await session.switchModel({
                    sessionID,
                    model: {
                        providerID: config.fallback.provider,
                        id: config.fallback.model,
                    },
                })
            } catch (switchError) {
                logger.error("failed to switch to fallback model:", switchError)
            }
        }
    }

    async function routePrompt(event: PromptEvent, routerBaseUrl: string): Promise<void> {
        const { messageID, sessionID, prompt } = event
        const text = prompt.text ?? ""

        // Collect mentions first, then strip them in one pass so offsets stay valid.
        const mentions: Mention[] = [
            ...(prompt.skills ?? []).map((skill) => skill.mention),
            ...(prompt.files ?? []).map((file) => file.mention),
        ].filter((mention): mention is Mention => mention !== undefined)

        let userMessage = stripMentions(text, mentions)

        if (userMessage.trim().length < config.minimumPromptLength) {
            logger.debug("skipped: prompt too short after mention stripping", userMessage.length)
            return
        }

        const apiKey = await deps.getRouterApiKey()

        if (!apiKey) {
            throw new Error("no API key available for the router provider")
        }

        const ctxSkills = await deps.listSkills()

        const routingSkills: RoutingSkill[] = (prompt.skills ?? []).map((skill) => {
            const ctxSkill = ctxSkills.find((entry) => entry.id === skill.id)
            return {
                name: skill.id,
                description: ctxSkill?.description ?? "",
                estimatedTokenSize: ctxSkill?.content
                    ? estimateTokens(ctxSkill.content)
                    : undefined,
            }
        })

        const routingFiles: RoutingFile[] = []

        for (const file of prompt.files ?? []) {
            let estimatedTokenSize: number | undefined

            try {
                estimatedTokenSize = await estimateFileTokens(file.uri)
            } catch (error) {
                // Files may be directories or unreadable; size is optional.
                logger.debug("could not estimate token size for", file.uri, error)
            }

            routingFiles.push({
                path: file.name ?? file.uri,
                estimatedTokenSize,
            })
        }

        const conversation = config.previousContext.enabled
            ? buildConversation(await session.context({ sessionID }), {
                currentMessageID: messageID,
                maxPreviewChars: config.previousContext.maxPreviewChars,
                maxFiles: config.previousContext.maxFiles,
            })
            : undefined

        const jevRequest = buildJevRequest({
            model: config.router.model,
            userMessage,
            files: routingFiles,
            skills: routingSkills,
            conversation,
            executionContext: {
                repository: deps.repository,
            },
        })

        logger.debug("sending jev request", jevRequest)

        const response = await askJev(jevRequest, {
            baseUrl: routerBaseUrl,
            apiKey,
            timeoutMs: config.timeoutMs,
            fetchImpl: deps.fetchImpl,
        })

        logger.debug("received jev response", response)

        await addUsage(storage, sessionID, response.usage)

        const decision: StoredDecision = {
            sessionID,
            messageID,
            createdAt: Date.now(),
            response,
        }

        await saveDecision(storage, decision)

        let { model, provider, tier } = resolveModel(config, response)
        let keepSessionModel = false

        if (deps.modelAvailable && !(await deps.modelAvailable(provider, model))) {
            logger.warn(
                `resolved model ${provider}/${model} is not available; trying fallback`,
            )

            if (await deps.modelAvailable(config.fallback.provider, config.fallback.model)) {
                provider = config.fallback.provider
                model = config.fallback.model
            } else {
                logger.warn(
                    `fallback model ${config.fallback.provider}/${config.fallback.model} is also unavailable; keeping the session model`,
                )
                keepSessionModel = true
            }
        }

        logger.info(
            "routing decision:",
            describeDecision(response, { provider, model }, tier),
        )

        if (!keepSessionModel) {
            await session.switchModel({
                sessionID,
                model: { providerID: provider, id: model },
            })
        }

        const synthetic = await session.synthetic({
            sessionID,
            text: formatDecisionBlock({
                response,
                resolved: { provider, model },
                tier,
                conversation,
            }),
            description: describeDecision(
                response,
                { provider, model },
                tier,
            ),
            resume: false,
        })

        logger.debug("published routing decision", synthetic)
    }
}

/** Exposed for tests: a full routing response fixture. */
export function makeDecisionFixture(
    overrides: Partial<JevRoutingResponse> = {},
): JevRoutingResponse {
    return {
        model: "typesafe/jev-1.13",
        id: "dec_test",
        provider: "openrouter",
        usage: { input_tokens: 1200, output_tokens: 96, cost: 0.0000024 },
        answers: {
            model_tier: { type: "choice", choice: "powerful", confidence: 0.93 },
            reasoning_complexity: { type: "choice", choice: "high", confidence: 0.88 },
            task_scope: { type: "choice", choice: "multi", confidence: 0.81 },
            ambiguity: { type: "choice", choice: "medium", confidence: 0.7 },
            task_type: { type: "choice", choice: "implementation", confidence: 0.9 },
            effort: { type: "choice", choice: "high", confidence: 0.85 },
        },
        ...overrides,
    }
}
