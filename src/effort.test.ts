import { describe, expect, test } from "bun:test"
import { normalizeConfig } from "./config"
import { createEffortHook, type ContextEvent } from "./effort"
import { FakeStorage } from "./testing"
import { makeStoredDecision } from "./testing"

const config = normalizeConfig({})

function makeEvent(overrides: Partial<ContextEvent> = {}): ContextEvent {
    return {
        sessionID: "ses_test",
        model: { providerID: "openrouter", id: "deepseek/deepseek-v4.1-flash" },
        options: {},
        ...overrides,
    }
}

async function harness(overrides: Partial<ContextEvent> = {}, stored = true) {
    const storage = new FakeStorage()

    if (stored) {
        storage.map.set("jev/decision/ses_test", makeStoredDecision())
    }

    const onContext = createEffortHook({
        config,
        logger: { info: () => { }, debug: () => { }, warn: () => { }, error: () => { } },
        storage,
    })

    const event = makeEvent(overrides)
    await onContext(event)
    return event
}

describe("effort hook", () => {
    test("applies reasoning_effort for openrouter", async () => {
        const event = await harness()
        expect(event.options.reasoning_effort).toBe("high")
    })

    test("applies reasoningEffort for openai", async () => {
        const event = await harness({
            model: { providerID: "openai", id: "gpt-5.2" },
        })
        expect(event.options.reasoningEffort).toBe("high")
    })

    test("leaves unknown providers untouched", async () => {
        const event = await harness({
            model: { providerID: "anthropic", id: "claude-x" },
        })
        expect(Object.keys(event.options)).toHaveLength(0)
    })

    test("leaves requests untouched without a stored decision", async () => {
        const event = await harness({}, false)
        expect(Object.keys(event.options)).toHaveLength(0)
    })

    test("maps effort choices through configured values", async () => {
        const mappedConfig = normalizeConfig({
            reasoningEffort: { values: { high: "xhigh" } },
        })

        const storage = new FakeStorage()
        storage.map.set("jev/decision/ses_test", makeStoredDecision())

        const onContext = createEffortHook({
            config: mappedConfig,
            logger: { info: () => { }, debug: () => { }, warn: () => { }, error: () => { } },
            storage,
        })

        const event = makeEvent()
        await onContext(event)
        expect(event.options.reasoning_effort).toBe("xhigh")
    })

    test("can opt a provider out with an empty key", async () => {
        const optedOut = normalizeConfig({
            reasoningEffort: { providers: { openrouter: "" } },
        })

        const storage = new FakeStorage()
        storage.map.set("jev/decision/ses_test", makeStoredDecision())

        const onContext = createEffortHook({
            config: optedOut,
            logger: { info: () => { }, debug: () => { }, warn: () => { }, error: () => { } },
            storage,
        })

        const event = makeEvent()
        await onContext(event)
        expect(Object.keys(event.options)).toHaveLength(0)
    })
})
