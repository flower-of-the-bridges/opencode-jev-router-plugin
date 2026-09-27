import type { PluginConfig } from "./config"
import { makeDecisionFixture } from "./router"
import { createPromptRouter, type PromptRouterDeps } from "./router"
import { normalizeConfig } from "./config"
import type { JsonStorage, StoredDecision } from "./decision"
import type { FetchLike } from "./jev"
import type { HistoryMessage } from "./history"
import type { PromptEvent } from "./router"

/** In-memory JsonStorage for tests. */
export class FakeStorage implements JsonStorage {
    readonly map = new Map<string, unknown>()

    async get(key: string): Promise<unknown> {
        return this.map.get(key)
    }

    async set(key: string, value: unknown): Promise<void> {
        this.map.set(key, structuredClone(value))
    }

    async remove(key: string): Promise<void> {
        this.map.delete(key)
    }
}

export interface SessionCalls {
    switchModel: Array<{ sessionID: string; model: { providerID: string; id: string } }>
    synthetic: Array<{ sessionID: string; text: string; description?: string; resume?: boolean }>
    contextCalls: number
}

export function createFakeSession(messages: readonly HistoryMessage[] = []) {
    const calls: SessionCalls = {
        switchModel: [],
        synthetic: [],
        contextCalls: 0,
    }

    return {
        calls,
        session: {
            async switchModel(input: { sessionID: string; model: { providerID: string; id: string } }) {
                calls.switchModel.push(structuredClone(input))
            },
            async synthetic(input: { sessionID: string; text: string; description?: string; resume?: boolean }) {
                calls.synthetic.push(structuredClone(input))
                return { id: "synthetic-1" }
            },
            async context(_: { sessionID: string }): Promise<readonly HistoryMessage[]> {
                calls.contextCalls += 1
                return messages
            },
        },
    }
}

export interface FetchCall {
    url: string
    init?: RequestInit
}

export function createFakeFetch(
    respond: () => Response,
): { fetch: FetchLike; calls: FetchCall[] } {
    const calls: FetchCall[] = []

    const fetchImpl: FetchLike = async (input, init) => {
        calls.push({ url: String(input), init })
        return respond()
    }

    return { fetch: fetchImpl, calls }
}

export interface RouterHarness {
    storage: FakeStorage
    calls: SessionCalls
    fetchCalls: FetchCall[]
    prompt: (event: PromptEvent) => Promise<void>
}

export function createRouterHarness(options: {
    config?: PluginConfig
    messages?: readonly HistoryMessage[]
    fetch?: () => Response
    baseUrl?: string | undefined
    /** Simulate a missing router provider regardless of `baseUrl`. */
    noBaseUrl?: boolean
    apiKey?: string | undefined
    /** Simulate the model registry; absent means "everything available". */
    availableModels?: ReadonlyArray<string>
}): RouterHarness {
    const config = normalizeConfig(options.config)

    const storage = new FakeStorage()
    const { calls, session } = createFakeSession(options.messages ?? [])
    const { fetch: fetchImpl, calls: fetchCalls } = createFakeFetch(
        options.fetch ?? (() => new Response(JSON.stringify(makeDecisionFixture()))),
    )

    const deps: PromptRouterDeps = {
        config,
        logger: {
            info: () => { },
            debug: () => { },
            warn: () => { },
            error: () => { },
        },
        storage,
        session,
        getRouterBaseUrl: async () =>
            options.noBaseUrl ? undefined : options.baseUrl ?? "https://api.example.com/v1",
        getRouterApiKey: async () => options.apiKey ?? "key-123",
        listSkills: async () => [
            { id: "code-review", description: "Review code", content: "x".repeat(400) },
        ],
        repository: "/repo",
        modelAvailable: options.availableModels
            ? async (providerID, modelID) =>
                options.availableModels?.includes(`${providerID}/${modelID}`) ?? true
            : undefined,
        fetchImpl,
    }

    return {
        storage,
        calls,
        fetchCalls,
        prompt: createPromptRouter(deps),
    }
}

export function makePromptEvent(overrides: Partial<PromptEvent["prompt"]> = {}): PromptEvent {
    return {
        sessionID: "ses_test",
        messageID: "msg_current",
        prompt: {
            text: "Please implement a routing table cache with proper invalidation whenever the configuration is reloaded, and make sure the worker pool shuts down cleanly",
            files: [],
            skills: [],
            agents: [],
            ...overrides,
        },
    }
}

export function makeStoredDecision(
    sessionID = "ses_test",
    overrides: Partial<StoredDecision> = {},
): StoredDecision {
    return {
        sessionID,
        messageID: "msg_1",
        createdAt: 1_700_000_000_000,
        response: makeDecisionFixture(),
        ...overrides,
    }
}

export function makeHistoryMessage(
    overrides: Partial<HistoryMessage> & { type: string },
): HistoryMessage {
    return {
        id: `msg_${Math.random().toString(36).slice(2, 8)}`,
        ...overrides,
    }
}
