/**
 * JEV classifier protocol: request building and response types.
 *
 * Pure module — no OpenCode SDK imports. `askJev` takes an injectable
 * `fetch` so tests never touch the network.
 */

export type RoutingTaskType =
    | "question"
    | "implementation"
    | "bugfix"
    | "refactor"
    | "review"
    | "research"
    | "debugging"
    | "other"

export type Effort = "low" | "medium" | "high"
export type ModelTier = "cheap" | "default" | "powerful"
export type ReasoningComplexity = "low" | "medium" | "high"
export type TaskScope = "single" | "multi" | "system"
export type Ambiguity = "low" | "medium" | "high"

export interface RoutingFile {
    path: string
    estimatedTokenSize?: number
}

export interface RoutingSkill {
    name: string
    description?: string
    estimatedTokenSize?: number
}

export interface RoutingRequestContext {
    agent?: string
    repository?: string
    language?: string
    framework?: string
    toolCount?: number
}

/** What the last completed turn looked like, as seen by the classifier. */
export interface PreviousTurnContext {
    /** Whitespace-collapsed preview of the previous user message. */
    userTextPreview?: string
    userTextTokens?: number
    /** Previous user message attachments plus assistant-touched files. */
    files?: string[]
    fileCount?: number
    assistant?: {
        /** `providerID/modelID` that produced the previous answer. */
        model?: string
        agent?: string
        finish?: string
        cost?: number
        toolCount?: number
        textPreview?: string
        tokens?: {
            input: number
            output: number
            reasoning: number
            cacheRead: number
            cacheWrite: number
        }
    }
}

export interface RoutingConversation {
    previous?: PreviousTurnContext
    /** Estimated tokens the previous turn saw (input + cache + output). */
    contextTokens?: number
    /** User turns already in the session before this prompt. */
    turnCount?: number
}

export interface RoutingRequest {
    request: {
        userMessage: string
        taskType?: RoutingTaskType
        files: RoutingFile[]
    }
    skills: RoutingSkill[]
    conversation?: RoutingConversation
    executionContext?: RoutingRequestContext
}

export type JevChoiceAnswer<T extends string> = {
    type: "choice"
    choice: T
    probabilities?: Partial<Record<T, number>>
    confidence: number
}

/**
 * Answers are individually optional: a classifier version may omit a
 * question and the plugin must still route.
 */
export type JevRoutingResponseAnswers = {
    model_tier?: JevChoiceAnswer<ModelTier>
    reasoning_complexity?: JevChoiceAnswer<ReasoningComplexity>
    task_scope?: JevChoiceAnswer<TaskScope>
    ambiguity?: JevChoiceAnswer<Ambiguity>
    task_type?: JevChoiceAnswer<RoutingTaskType>
    effort?: JevChoiceAnswer<Effort>
}

export type JevRoutingResponse = {
    model: string
    answers: JevRoutingResponseAnswers
    usage: {
        input_tokens: number
        output_tokens: number
        cost: number
    }
    id?: string
    provider?: string
}

type ChoiceQuestion<T extends string> = {
    type: "choice"
    instructions: string
    criteria: Record<T, string>
}

export interface JevRoutingRequest {
    model: string
    state: RoutingRequest
    questions: {
        model_tier: ChoiceQuestion<ModelTier>
        reasoning_complexity: ChoiceQuestion<ReasoningComplexity>
        task_scope: ChoiceQuestion<TaskScope>
        ambiguity: ChoiceQuestion<Ambiguity>
        task_type: ChoiceQuestion<RoutingTaskType>
        effort: ChoiceQuestion<Effort>
    }
}

export interface BuildJevRequestInput {
    model: string
    userMessage: string
    files: RoutingFile[]
    skills: RoutingSkill[]
    conversation?: RoutingConversation
    executionContext?: RoutingRequestContext
}

export function buildJevRequest({
    model,
    userMessage,
    files,
    skills,
    conversation,
    executionContext,
}: BuildJevRequestInput): JevRoutingRequest {
    const state: RoutingRequest = {
        request: { userMessage, files },
        skills,
    }

    if (conversation) {
        state.conversation = conversation
    }

    if (executionContext) {
        state.executionContext = executionContext
    }

    return {
        model,
        state,

        questions: {
            model_tier: {
                type: "choice",
                instructions: "Choose the minimum model tier that is likely to complete the user's request correctly, considering the requested change, relevant files, active skills, conversation context, ambiguity, number of interacting components, and required reasoning. Do not choose a higher tier merely because the context is large.",
                criteria: {
                    cheap: "The task is straightforward and low-risk: explanation, lookup, formatting, renaming, trivial edit, simple one-file change, or another task requiring little reasoning. The relevant files and skills do not introduce meaningful architectural or debugging complexity.",
                    default: "The task requires normal software-engineering reasoning: ordinary implementation, bug fixing, moderate debugging, feature work, multiple related files, normal refactoring, or meaningful interaction with the active skills and project conventions.",
                    powerful: "The task requires substantial reasoning or has high failure risk: difficult debugging, unclear or conflicting requirements, complex state or control flow, architectural decisions, large refactoring, many interacting subsystems, subtle regressions, or a problem where several plausible implementations must be evaluated.",
                },
            },

            reasoning_complexity: {
                type: "choice",
                instructions: "Classify the intrinsic reasoning complexity of the user's request, independently of the amount of context supplied.",
                criteria: {
                    low: "Direct and deterministic work with little reasoning.",
                    medium: "Requires understanding existing code, making implementation choices, or debugging normal problems.",
                    high: "Requires deep debugging, architecture, non-obvious reasoning, or coordination of several interacting systems.",
                },
            },

            task_scope: {
                type: "choice",
                instructions: "Classify the scope of the requested change based on the files and systems actually relevant to the request.",
                criteria: {
                    single: "Primarily one file or one isolated component.",
                    multi: "Several related files or components.",
                    system: "Multiple subsystems, architecture, or broad repository changes.",
                },
            },

            ambiguity: {
                type: "choice",
                instructions: "Determine how ambiguous the user's requested outcome is after considering the conversation, files, and skills.",
                criteria: {
                    low: "The intended outcome and constraints are clear.",
                    medium: "Some implementation details or requirements need interpretation.",
                    high: "The desired outcome, constraints, or correct implementation are substantially unclear or conflicting.",
                },
            },

            task_type: {
                type: "choice",
                instructions: "Classify the primary kind of work the user is asking for, considering the message, the attached files and skills, and the conversation context.",
                criteria: {
                    question: "The user mainly wants an explanation, an answer, or information. No code changes are expected.",
                    implementation: "Write new code, features, or configuration.",
                    bugfix: "Fix broken or incorrect behavior whose symptom is known.",
                    debugging: "Investigate a failure or misbehavior whose cause is not yet identified.",
                    refactor: "Restructure or clean up existing code without changing behavior.",
                    review: "Critique, audit, or assess provided code, a diff, or a design.",
                    research: "Explore the codebase, gather context, or compare options before acting.",
                    other: "Anything that does not fit the other categories.",
                },
            },

            effort: {
                type: "choice",
                instructions: "Choose how much execution effort the coding agent should spend on this request: how thoroughly to explore, implement, verify, and double-check before finishing. Effort is about diligence, not model size.",
                criteria: {
                    low: "Direct, low-risk work: answer immediately or make an obvious small change with little exploration.",
                    medium: "Normal engineering work: explore the relevant code, implement carefully, and sanity-check the result.",
                    high: "High-stakes or complex work: investigate broadly, weigh alternatives, verify the result, and re-check edge cases before finishing.",
                },
            },
        },
    }
}

export interface AskJevOptions {
    baseUrl: string
    apiKey: string
    /** Abort the request after this many milliseconds. */
    timeoutMs?: number
    /** HTTP endpoint path under `baseUrl`. Defaults to the JEV `systemone` route. */
    path?: string
    fetchImpl?: FetchLike
}

/** Minimal fetch shape; the global fetch satisfies it, and so do test doubles. */
export type FetchLike = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<Response>

const DEFAULT_JEV_PATH = "systemone"

export class JevRequestError extends Error {
    constructor(
        message: string,
        readonly status?: number,
        readonly body?: string,
    ) {
        super(message)
        this.name = "JevRequestError"
    }
}

export async function askJev(
    request: JevRoutingRequest,
    options: AskJevOptions,
): Promise<JevRoutingResponse> {
    const doFetch = options.fetchImpl ?? fetch
    const url = `${options.baseUrl.replace(/\/+$/, "")}/${options.path ?? DEFAULT_JEV_PATH}`

    const response = await doFetch(url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        ...(options.timeoutMs !== undefined
            ? { signal: AbortSignal.timeout(options.timeoutMs) }
            : {}),
    })

    if (!response.ok) {
        const body = await response.text()
        throw new JevRequestError(
            `Jev request failed: ${response.status} ${body}`,
            response.status,
            body,
        )
    }

    const parsed = (await response.json()) as unknown
    assertJevResponse(parsed)
    return parsed
}

/**
 * Light structural check: anything with a model and usage-like object is
 * accepted; individual answers may be missing.
 */
export function assertJevResponse(value: unknown): asserts value is JevRoutingResponse {
    if (typeof value !== "object" || value === null) {
        throw new JevRequestError("Jev returned a non-object response")
    }

    const candidate = value as Partial<JevRoutingResponse>

    if (typeof candidate.model !== "string") {
        throw new JevRequestError("Jev response is missing the classifier model name")
    }

    if (typeof candidate.usage !== "object" || candidate.usage === null) {
        throw new JevRequestError("Jev response is missing usage")
    }

    candidate.answers ??= {}
    candidate.usage = {
        input_tokens: numberOrZero(candidate.usage.input_tokens),
        output_tokens: numberOrZero(candidate.usage.output_tokens),
        cost: numberOrZero(candidate.usage.cost),
    }
}

function numberOrZero(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0
}
