import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { decisionKey } from "./decision"
import { makeDecisionFixture } from "./router"
import { createRouterHarness, makeHistoryMessage, makePromptEvent } from "./testing"
import { usageKey } from "./usage"

const scratch = mkdtempSync(path.join(tmpdir(), "jev-router-router-"))
const sampleFile = path.join(scratch, "sample.ts")
mkdirSync(scratch, { recursive: true })
writeFileSync(sampleFile, "export const x = 1\n".repeat(40))

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
})

const HISTORY = [
    makeHistoryMessage({
        type: "user",
        text: "earlier question about routing",
        files: [{ name: "old.md" }],
    }),
    makeHistoryMessage({
        type: "assistant",
        model: { providerID: "openrouter", id: "qwen/qwen3.5-flash" },
        tokens: { input: 500, output: 50, cache: { read: 100 } },
        snapshot: { files: ["src/a.ts"] },
        content: [{ type: "text", text: "done earlier" }],
    }),
]

describe("prompt router", () => {
    test("routes, switches model, and posts a decision message", async () => {
        const harness = createRouterHarness({ messages: HISTORY })

        const text = "@code-review please review the attached routing module and improve the error handling around retry storms and backoff @sample.ts"

        await harness.prompt(makePromptEvent({
            text,
            skills: [
                {
                    id: "code-review",
                    mention: { start: 0, end: 12, text: "@code-review" },
                },
            ],
            files: [
                {
                    uri: pathToFileURL(sampleFile).toString(),
                    name: "sample.ts",
                    mention: {
                        start: text.indexOf("@sample.ts"),
                        end: text.indexOf("@sample.ts") + "@sample.ts".length,
                        text: "@sample.ts",
                    },
                },
            ],
        }))

        // One classifier call with stripped message, sized files/skills, history.
        expect(harness.fetchCalls).toHaveLength(1)
        expect(harness.fetchCalls[0].url).toBe("https://api.example.com/v1/systemone")

        const body = JSON.parse(String(harness.fetchCalls[0].init?.body))
        expect(body.state.request.userMessage).not.toContain("@code-review")
        expect(body.state.request.userMessage).not.toContain("@sample.ts")
        expect(body.state.request.userMessage).toContain("improve the error handling")

        const skill = body.state.skills[0]
        expect(skill.name).toBe("code-review")
        expect(skill.estimatedTokenSize).toBe(100)

        const file = body.state.request.files[0]
        expect(file.path).toBe("sample.ts")
        expect(file.estimatedTokenSize).toBeGreaterThan(0)

        expect(body.state.conversation.turnCount).toBe(1)
        expect(body.state.conversation.previous.assistant.model).toBe("openrouter/qwen/qwen3.5-flash")
        expect(body.state.conversation.contextTokens).toBe(650)
        expect(body.state.executionContext.repository).toBe("/repo")

        // Model switched to the powerful tier from the fixture.
        expect(harness.calls.switchModel).toEqual([
            {
                sessionID: "ses_test",
                model: { providerID: "openrouter", id: "deepseek/deepseek-v4-pro-0813" },
            },
        ])

        // Fancy synthetic message with description.
        expect(harness.calls.synthetic).toHaveLength(1)
        const synthetic = harness.calls.synthetic[0]
        expect(synthetic.description).toContain("powerful (93%)")
        expect(synthetic.description).toContain("$0.00000240")
        expect(synthetic.text).toContain("[JEV ROUTING DECISION]")
        expect(synthetic.text).toContain("task_type: implementation")
        expect(synthetic.resume).toBe(false)

        // Decision and usage persisted through storage, not an in-memory map.
        expect(harness.storage.map.has(decisionKey("ses_test"))).toBe(true)
        const usage = await harness.storage.get(usageKey("ses_test")) as { requests: number }
        expect(usage.requests).toBe(1)
    })

    test("skips short prompts", async () => {
        const harness = createRouterHarness({})
        await harness.prompt(makePromptEvent({ text: "hi" }))

        expect(harness.fetchCalls).toHaveLength(0)
        expect(harness.calls.switchModel).toHaveLength(0)
    })

    test("skips ignored prefixes", async () => {
        const harness = createRouterHarness({})
        await harness.prompt(makePromptEvent({ text: "/help with routing config please" }))

        expect(harness.fetchCalls).toHaveLength(0)
    })

    test("skips ignored agent mentions", async () => {
        const harness = createRouterHarness({})
        await harness.prompt(makePromptEvent({
            agents: [{ name: "title" }],
        }))

        expect(harness.fetchCalls).toHaveLength(0)
    })

    test("skips routing without a classifier provider", async () => {
        const harness = createRouterHarness({ noBaseUrl: true })
        await harness.prompt(makePromptEvent())

        expect(harness.fetchCalls).toHaveLength(0)
        expect(harness.calls.switchModel).toHaveLength(0)
    })

    test("falls back to the fallback model on classifier failure", async () => {
        const harness = createRouterHarness({
            fetch: () => new Response("classifier down", { status: 500 }),
        })

        await expect(harness.prompt(makePromptEvent())).resolves.toBeUndefined()

        expect(harness.calls.switchModel).toEqual([
            {
                sessionID: "ses_test",
                model: { providerID: "openrouter", id: "z-ai/glm-5.3-flash" },
            },
        ])
        expect(harness.calls.synthetic).toHaveLength(0)
    })

    test("still routes when a file cannot be read", async () => {
        const harness = createRouterHarness({})

        await harness.prompt(makePromptEvent({
            files: [{ uri: path.join(scratch, "missing.txt") }],
        }))

        const body = JSON.parse(String(harness.fetchCalls[0].init?.body))
        expect(body.state.request.files[0].estimatedTokenSize).toBeUndefined()
        expect(harness.calls.switchModel).toHaveLength(1)
    })

    test("omits conversation when previousContext is disabled", async () => {
        const harness = createRouterHarness({
            config: { previousContext: { enabled: false } },
            messages: HISTORY,
        })

        await harness.prompt(makePromptEvent())

        expect(harness.calls.contextCalls).toBe(0)
        const body = JSON.parse(String(harness.fetchCalls[0].init?.body))
        expect(body.state.conversation).toBeUndefined()
    })

    test("uses the task-type model override when configured", async () => {
        const harness = createRouterHarness({
            config: {
                taskTypeModels: {
                    implementation: { provider: "anthropic", model: "claude-builder" },
                },
            },
        })

        await harness.prompt(makePromptEvent())

        expect(harness.calls.switchModel).toEqual([
            {
                sessionID: "ses_test",
                model: { providerID: "anthropic", id: "claude-builder" },
            },
        ])
    })

    test("falls back when the resolved model is not in the registry", async () => {
        const harness = createRouterHarness({
            availableModels: [
                "openrouter/z-ai/glm-5.3-flash",
            ],
        })

        await harness.prompt(makePromptEvent())

        expect(harness.calls.switchModel).toEqual([
            {
                sessionID: "ses_test",
                model: { providerID: "openrouter", id: "z-ai/glm-5.3-flash" },
            },
        ])
    })

    test("keeps the session model when even the fallback is unavailable", async () => {
        const harness = createRouterHarness({
            availableModels: [],
        })

        await harness.prompt(makePromptEvent())

        expect(harness.calls.switchModel).toHaveLength(0)
        expect(harness.calls.synthetic).toHaveLength(1)
    })

    test("survives a classifier that answers with unknown fields", async () => {
        const harness = createRouterHarness({
            fetch: () => new Response(JSON.stringify({
                model: "typesafe/jev-1.13",
                answers: {
                    model_tier: { type: "choice", choice: "cheap", confidence: 0.99 },
                },
                usage: { input_tokens: "bad" },
            })),
        })

        await harness.prompt(makePromptEvent())

        expect(harness.calls.switchModel).toEqual([
            {
                sessionID: "ses_test",
                model: { providerID: "openrouter", id: "qwen/qwen3.6-flash" },
            },
        ])
        expect(harness.calls.synthetic[0].text).not.toContain("task_type:")
    })

    test("records zero usage when the classifier omits numbers", async () => {
        const harness = createRouterHarness({
            fetch: () => new Response(JSON.stringify(makeDecisionFixture({
                usage: { input_tokens: "x" as unknown as number, output_tokens: 0, cost: 0 },
            }))),
        })

        await harness.prompt(makePromptEvent())

        const usage = await harness.storage.get(usageKey("ses_test")) as { inputTokens: number }
        expect(usage.inputTokens).toBe(0)
    })
})
