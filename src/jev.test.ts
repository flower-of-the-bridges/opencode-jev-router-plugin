import { describe, expect, test } from "bun:test"
import { askJev, buildJevRequest, JevRequestError, type JevRoutingResponse } from "./jev"
import { makeDecisionFixture } from "./router"

const QUESTION_KEYS = [
    "model_tier",
    "reasoning_complexity",
    "task_scope",
    "ambiguity",
    "task_type",
    "effort",
] as const

describe("buildJevRequest", () => {
    test("includes every classifier question", () => {
        const request = buildJevRequest({
            model: "typesafe/jev-1.13",
            userMessage: "do the thing",
            files: [],
            skills: [],
        })

        expect(Object.keys(request.questions)).toEqual([...QUESTION_KEYS])
        expect(request.model).toBe("typesafe/jev-1.13")
    })

    test("covers all criteria choices for task_type and effort", () => {
        const request = buildJevRequest({
            model: "m",
            userMessage: "x",
            files: [],
            skills: [],
        })

        expect(Object.keys(request.questions.task_type.criteria).sort()).toEqual([
            "bugfix", "debugging", "implementation", "other", "question", "refactor", "research", "review",
        ])
        expect(Object.keys(request.questions.effort.criteria).sort()).toEqual([
            "high", "low", "medium",
        ])
    })

    test("passes conversation and execution context through", () => {
        const conversation = { turnCount: 3, previous: { userTextPreview: "hi" } }
        const request = buildJevRequest({
            model: "m",
            userMessage: "x",
            files: [{ path: "a.ts" }],
            skills: [{ name: "review" }],
            conversation,
            executionContext: { repository: "/repo" },
        })

        expect(request.state.conversation).toEqual(conversation)
        expect(request.state.executionContext).toEqual({ repository: "/repo" })
        expect(request.state.request.files).toEqual([{ path: "a.ts" }])
        expect(request.state.skills).toEqual([{ name: "review" }])
    })

    test("omits conversation when absent", () => {
        const request = buildJevRequest({
            model: "m",
            userMessage: "x",
            files: [],
            skills: [],
        })

        expect(request.state.conversation).toBeUndefined()
        expect(request.state.executionContext).toBeUndefined()
    })
})

describe("askJev", () => {
    const request = buildJevRequest({
        model: "typesafe/jev-1.13",
        userMessage: "x",
        files: [],
        skills: [],
    })

    test("posts to systemone with bearer auth and returns the parsed body", async () => {
        let seenUrl = ""
        let seenInit: RequestInit | undefined

        const response = await askJev(request, {
            baseUrl: "https://api.example.com/v1/",
            apiKey: "secret",
            fetchImpl: async (url, init) => {
                seenUrl = String(url)
                seenInit = init
                return new Response(JSON.stringify(makeDecisionFixture()), { status: 200 })
            },
        })

        expect(seenUrl).toBe("https://api.example.com/v1/systemone")
        expect(seenInit?.method).toBe("POST")
        expect((seenInit?.headers as Record<string, string>).Authorization).toBe("Bearer secret")
        expect(JSON.parse(String(seenInit?.body)).model).toBe("typesafe/jev-1.13")
        expect(response.id).toBe("dec_test")
        expect(response.answers.model_tier?.choice).toBe("powerful")
    })

    test("passes a timeout signal when configured", async () => {
        let signal: AbortSignal | undefined

        await askJev(request, {
            baseUrl: "https://api.example.com",
            apiKey: "k",
            timeoutMs: 1234,
            fetchImpl: async (_url, init) => {
                signal = init?.signal as AbortSignal
                return new Response(JSON.stringify(makeDecisionFixture()))
            },
        })

        expect(signal).toBeInstanceOf(AbortSignal)
    })

    test("throws JevRequestError on HTTP failure with status and body", async () => {
        let thrown: unknown

        try {
            await askJev(request, {
                baseUrl: "https://api.example.com",
                apiKey: "k",
                fetchImpl: async () => new Response("boom", { status: 503 }),
            })
        } catch (error) {
            thrown = error
        }

        expect(thrown).toBeInstanceOf(JevRequestError)
        expect((thrown as JevRequestError).status).toBe(503)
        expect((thrown as JevRequestError).message).toContain("boom")
    })

    test("rejects malformed responses", async () => {
        await expect(askJev(request, {
            baseUrl: "https://api.example.com",
            apiKey: "k",
            fetchImpl: async () => new Response("not json"),
        })).rejects.toThrow()

        await expect(askJev(request, {
            baseUrl: "https://api.example.com",
            apiKey: "k",
            fetchImpl: async () => new Response(JSON.stringify({ nope: true })),
        })).rejects.toBeInstanceOf(JevRequestError)
    })

    test("defaults missing usage numbers to zero", async () => {
        const partial: Partial<JevRoutingResponse> = {
            model: "jev",
            usage: {} as JevRoutingResponse["usage"],
            answers: {},
        }

        const response = await askJev(request, {
            baseUrl: "https://api.example.com",
            apiKey: "k",
            fetchImpl: async () => new Response(JSON.stringify(partial)),
        })

        expect(response.usage).toEqual({ input_tokens: 0, output_tokens: 0, cost: 0 })
    })
})
