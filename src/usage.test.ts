import { describe, expect, test } from "bun:test"
import { FakeStorage } from "./testing"
import { addUsage, getUsage } from "./usage"

describe("usage tracking", () => {
    test("starts at zero for unknown sessions", async () => {
        const storage = new FakeStorage()
        expect(await getUsage(storage, "ses_1")).toEqual({
            cost: 0,
            inputTokens: 0,
            outputTokens: 0,
            requests: 0,
        })
    })

    test("accumulates per-session usage", async () => {
        const storage = new FakeStorage()

        await addUsage(storage, "ses_1", { input_tokens: 100, output_tokens: 10, cost: 0.01 })
        await addUsage(storage, "ses_1", { input_tokens: 50, output_tokens: 5, cost: 0.02 })
        await addUsage(storage, "ses_2", { input_tokens: 7, output_tokens: 1, cost: 0.001 })

        const stats = await getUsage(storage, "ses_1")
        expect(stats.requests).toBe(2)
        expect(stats.inputTokens).toBe(150)
        expect(stats.outputTokens).toBe(15)
        expect(stats.cost).toBeCloseTo(0.03, 10)
        expect((await getUsage(storage, "ses_2")).requests).toBe(1)
    })

    test("tolerates corrupt stored values", async () => {
        const storage = new FakeStorage()
        storage.map.set("jev/usage/ses_bad", { cost: "nonsense" })

        const stats = await getUsage(storage, "ses_bad")
        expect(stats.cost).toBe(0)
        expect(stats.requests).toBe(0)
    })
})
