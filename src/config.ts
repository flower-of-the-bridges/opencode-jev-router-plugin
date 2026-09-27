import type { RoutingTaskType } from "./jev"

export type ChoiceConfig = {
    provider: string
    model: string
}

/** Maps a JEV effort choice to the provider option value to send. */
export type EffortValues = Partial<Record<string, string>>

export interface ReasoningEffortConfig {
    /**
     * providerID → provider-option key used by that provider's protocol.
     * A provider missing from the map gets no effort option.
     * Set a value to "" to opt a provider out without deleting defaults.
     */
    providers?: Record<string, string>
    /** Maps JEV effort choices to option values. Defaults to identity. */
    values?: EffortValues
}

export interface PreviousContextConfig {
    enabled?: boolean
    /** Max characters of previews sent to the classifier. */
    maxPreviewChars?: number
    /** Max file names listed per previous turn. */
    maxFiles?: number
}

export interface PluginConfig {
    enabled?: boolean
    // OpenCode provider/model IDs.
    // OpenRouter models are referenced as provider=openrouter,
    // id=<OpenRouter model ID>.
    router?: ChoiceConfig

    cheap?: ChoiceConfig
    powerful?: ChoiceConfig

    /** Model used for the `default` tier and whenever routing fails. */
    fallback?: ChoiceConfig

    /** Optional per-task-type model override; wins over the tier model. */
    taskTypeModels?: Partial<Record<RoutingTaskType, ChoiceConfig>>

    minimumPromptLength?: number
    minimumThresholdConfidence?: number
    timeoutMs?: number

    ignoredPrefixes?: string[]
    ignoredAgents?: string[]

    /** Send previous-turn and context-size details to the classifier. */
    previousContext?: PreviousContextConfig

    /** Apply the classifier's effort answer as a reasoning-effort option. */
    reasoningEffort?: ReasoningEffortConfig

    logging?: boolean
    logFile?: string
}

export type RuntimeConfig = Required<PluginConfig> & {
    previousContext: Required<PreviousContextConfig>
    reasoningEffort: Required<ReasoningEffortConfig>
}

const DEFAULTS: RuntimeConfig = {
    enabled: true,

    router: {
        provider: "openrouter",
        model: "typesafe/jev-1.13",
    },

    cheap: {
        provider: "openrouter",
        model: "qwen/qwen3.6-flash",
    },

    fallback: {
        provider: "openrouter",
        model: "z-ai/glm-5.3-flash",
    },

    powerful: {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-pro-0813",
    },

    taskTypeModels: {},

    minimumThresholdConfidence: 0.5,
    minimumPromptLength: 100,
    timeoutMs: 5000,

    ignoredPrefixes: [
        "/help",
        "/models",
        "/connect",
        "/logout",
        "/clear",
    ],

    ignoredAgents: [
        "title",
        "compaction",
    ],

    previousContext: {
        enabled: true,
        maxPreviewChars: 240,
        maxFiles: 10,
    },

    reasoningEffort: {
        providers: {
            openrouter: "reasoning_effort",
            openai: "reasoningEffort",
        },
        values: {},
    },

    logging: true,
    logFile: "/tmp/opencode/jev-router.log",
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Merge `patch` into `base`; plain objects merge recursively, everything else replaces. */
export function deepMerge<T>(base: T, patch: unknown): T {
    if (!isPlainObject(base) || !isPlainObject(patch)) {
        return (patch === undefined ? base : patch) as T
    }

    const merged: Record<string, unknown> = { ...base }

    for (const [key, patchValue] of Object.entries(patch)) {
        merged[key] = deepMerge((base as Record<string, unknown>)[key], patchValue)
    }

    return merged as T
}

export function normalizeConfig(options: unknown): RuntimeConfig {
    const input = isPlainObject(options) ? options : {}
    return deepMerge(DEFAULTS, input)
}
