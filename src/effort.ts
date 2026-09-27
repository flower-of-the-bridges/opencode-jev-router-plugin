import type { RuntimeConfig } from "./config"
import { loadDecision, type JsonStorage } from "./decision"
import type { Logger } from "./logger"

/**
 * Structural subset of the `session.hook("context", ...)` event. The agent
 * loop is the only request kind that reaches this hook, and `options`
 * carries request overrides (typed generation settings plus provider
 * options).
 */
export interface ContextEvent {
    readonly sessionID: string
    readonly model: { providerID: string; id: string }
    options: Record<string, unknown>
}

export interface EffortHookDeps {
    config: RuntimeConfig
    logger: Logger
    storage: JsonStorage
}

/**
 * Create the `session.hook("context", ...)` handler that applies the
 * classifier's effort answer to the outgoing model request.
 *
 * For each agent-loop call the handler looks up the session's latest
 * routing decision and, when the routed provider has a configured
 * provider-option key, sets that option to the mapped effort value:
 *
 * - `openrouter` → `reasoning_effort` (OpenAI-compatible chat protocol)
 * - `openai` → `reasoningEffort` (OpenAI Responses protocol)
 */
export function createEffortHook(deps: EffortHookDeps) {
    const { config, logger, storage } = deps

    return async function onContext(event: ContextEvent): Promise<void> {
        const optionKey = config.reasoningEffort.providers[event.model.providerID]

        if (!optionKey) {
            return
        }

        const stored = await loadDecision(storage, event.sessionID)
        const choice = stored?.response.answers.effort?.choice

        if (!choice) {
            return
        }

        const value = config.reasoningEffort.values[choice] ?? choice

        event.options[optionKey] = value

        logger.debug(
            "applied effort",
            choice,
            "as",
            `${event.model.providerID}:${optionKey}=${value}`,
        )
    }
}
