import type { JevRoutingResponse } from "./jev"
import type { JsonStorage } from "./decision"

export interface JevUsageStats {
    /** Cumulative classifier cost in USD. */
    cost: number
    inputTokens: number
    outputTokens: number
    requests: number
}

export function usageKey(sessionID: string): string {
    return `jev/usage/${sessionID}`
}

export async function addUsage(
    storage: JsonStorage,
    sessionID: string,
    usage: JevRoutingResponse["usage"],
): Promise<JevUsageStats> {
    const previous = await getUsage(storage, sessionID)
    const next: JevUsageStats = {
        cost: previous.cost + usage.cost,
        inputTokens: previous.inputTokens + usage.input_tokens,
        outputTokens: previous.outputTokens + usage.output_tokens,
        requests: previous.requests + 1,
    }

    await storage.set(usageKey(sessionID), next)
    return next
}

export async function getUsage(
    storage: JsonStorage,
    sessionID: string,
): Promise<JevUsageStats> {
    const stored = (await storage.get(usageKey(sessionID))) as Partial<JevUsageStats> | undefined

    return {
        cost: typeof stored?.cost === "number" ? stored.cost : 0,
        inputTokens: typeof stored?.inputTokens === "number" ? stored.inputTokens : 0,
        outputTokens: typeof stored?.outputTokens === "number" ? stored.outputTokens : 0,
        requests: typeof stored?.requests === "number" ? stored.requests : 0,
    }
}
