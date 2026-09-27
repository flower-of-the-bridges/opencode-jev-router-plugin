import { describe, expect, test } from "bun:test"
import { buildConversation, estimateContextTokens, type HistoryMessage, type TokenSummary } from "./history"

const CURRENT = "msg_current"

function user(overrides: Partial<HistoryMessage> = {}): HistoryMessage {
    return { id: "u1", type: "user", text: "previous question", ...overrides }
}

function assistant(overrides: Partial<HistoryMessage> = {}): HistoryMessage {
    return {
        id: "a1",
        type: "assistant",
        model: { providerID: "openrouter", id: "deepseek/deepseek-v4.1-flash" },
        agent: "build",
        finish: "stop",
        cost: 0.01,
        tokens: { input: 100, output: 20, reasoning: 10, cache: { read: 300, write: 0 } },
        snapshot: { files: ["src/a.ts", "src/b.ts"] },
        content: [
            { type: "text", text: "All done, here is the summary." },
            { type: "tool", id: "t1", name: "read" },
            { type: "tool", id: "t2", name: "edit" },
        ],
        ...overrides,
    }
}

describe("buildConversation", () => {
    test("returns undefined for an empty or first-turn session", () => {
        expect(buildConversation([])).toBeUndefined()
        expect(buildConversation([user({ id: CURRENT })])).toBeUndefined()
        expect(buildConversation([user()])).toBeUndefined()
    })

    test("excludes the message currently being admitted", () => {
        const conversation = buildConversation(
            [user(), assistant(), user({ id: CURRENT, text: "new prompt" })],
            { currentMessageID: CURRENT },
        )

        expect(conversation?.turnCount).toBe(1)
    })

    test("summarizes the previous turn", () => {
        const conversation = buildConversation(
            [
                user({
                    text: "please look at\n  the failing test",
                    files: [{ name: "a.test.ts" }],
                }),
                assistant(),
                user({ id: CURRENT }),
            ],
            { currentMessageID: CURRENT },
        )

        expect(conversation?.turnCount).toBe(1)
        expect(conversation?.previous?.userTextPreview).toBe("please look at the failing test")
        expect(conversation?.previous?.userTextTokens).toBeGreaterThan(0)
        expect(conversation?.previous?.assistant?.model).toBe("openrouter/deepseek/deepseek-v4.1-flash")
        expect(conversation?.previous?.assistant?.agent).toBe("build")
        expect(conversation?.previous?.assistant?.finish).toBe("stop")
        expect(conversation?.previous?.assistant?.cost).toBe(0.01)
        expect(conversation?.previous?.assistant?.toolCount).toBe(2)
        expect(conversation?.previous?.assistant?.textPreview).toBe("All done, here is the summary.")
        expect(conversation?.previous?.files).toEqual(["a.test.ts", "src/a.ts", "src/b.ts"])
        expect(conversation?.previous?.fileCount).toBe(3)
        expect(conversation?.contextTokens).toBe(100 + 20 + 10 + 300 + 0)
    })

    test("caps the file list but reports the full count", () => {
        const conversation = buildConversation(
            [
                user(),
                assistant({
                    snapshot: {
                        files: ["f1.ts", "f2.ts", "f3.ts", "f4.ts", "f5.ts", "f6.ts"],
                    },
                }),
            ],
            { maxFiles: 3 },
        )

        expect(conversation?.previous?.files).toEqual(["f1.ts", "f2.ts", "f3.ts"])
        expect(conversation?.previous?.fileCount).toBe(6)
    })

    test("handles assistant answers without token usage", () => {
        const conversation = buildConversation(
            [
                user(),
                assistant({
                    tokens: undefined,
                    content: [{ type: "text", text: "done" }],
                }),
            ],
            {},
        )

        expect(conversation?.previous?.assistant?.tokens).toBeUndefined()
        expect(conversation?.contextTokens).toBeUndefined()
        expect(conversation?.turnCount).toBe(1)
    })

    test("accepts model given as a plain string", () => {
        const conversation = buildConversation(
            [user(), assistant({ model: "openrouter/qwen/qwen3.5-flash" })],
            {},
        )

        expect(conversation?.previous?.assistant?.model).toBe("openrouter/qwen/qwen3.5-flash")
    })

    test("truncates long previews", () => {
        const conversation = buildConversation(
            [
                user({ text: "y".repeat(500) }),
                assistant(),
            ],
            { maxPreviewChars: 50 },
        )

        expect(conversation?.previous?.userTextPreview?.length).toBe(50)
        expect(conversation?.previous?.userTextPreview?.endsWith("…")).toBe(true)
    })
})

describe("estimateContextTokens", () => {
    test("sums input, output, reasoning, and cache", () => {
        const tokens: TokenSummary = {
            input: 100,
            output: 20,
            reasoning: 10,
            cacheRead: 300,
            cacheWrite: 70,
        }

        expect(estimateContextTokens(tokens)).toBe(500)
        expect(estimateContextTokens(undefined)).toBeUndefined()
    })
})
