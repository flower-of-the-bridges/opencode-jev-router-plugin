import { describe, expect, test } from "bun:test"
import { deepMerge, normalizeConfig } from "./config"

describe("normalizeConfig", () => {
    test("returns full defaults for empty input", () => {
        const config = normalizeConfig({})

        expect(config.enabled).toBe(true)
        expect(config.router).toEqual({ provider: "openrouter", model: "typesafe/jev-1.13" })
        expect(config.cheap).toEqual({ provider: "openrouter", model: "qwen/qwen3.6-flash" })
        expect(config.powerful).toEqual({ provider: "openrouter", model: "deepseek/deepseek-v4-pro-0813" })
        expect(config.fallback).toEqual({ provider: "openrouter", model: "z-ai/glm-5.3-flash" })
        expect(config.minimumPromptLength).toBe(100)
        expect(config.minimumThresholdConfidence).toBe(0.5)
        expect(config.timeoutMs).toBe(5000)
        expect(config.previousContext.enabled).toBe(true)
        expect(config.previousContext.maxPreviewChars).toBe(240)
        expect(config.reasoningEffort.providers).toEqual({
            openrouter: "reasoning_effort",
            openai: "reasoningEffort",
        })
        expect(config.ignoredPrefixes).toContain("/help")
    })

    test("deep-merges nested objects instead of replacing them", () => {
        const config = normalizeConfig({
            router: { model: "typesafe/jev-1.13-beta" },
            previousContext: { maxPreviewChars: 80 },
        })

        expect(config.router.provider).toBe("openrouter")
        expect(config.router.model).toBe("typesafe/jev-1.13-beta")
        expect(config.previousContext.enabled).toBe(true)
        expect(config.previousContext.maxPreviewChars).toBe(80)
        expect(config.previousContext.maxFiles).toBe(10)
    })

    test("merges user providers into the reasoning-effort map", () => {
        const config = normalizeConfig({
            reasoningEffort: { providers: { anthropic: "thinking_budget" } },
        })

        expect(config.reasoningEffort.providers).toEqual({
            openrouter: "reasoning_effort",
            openai: "reasoningEffort",
            anthropic: "thinking_budget",
        })
    })

    test("accepts task-type model overrides", () => {
        const config = normalizeConfig({
            taskTypeModels: {
                review: { provider: "anthropic", model: "claude-reviewer" },
            },
        })

        expect(config.taskTypeModels.review).toEqual({
            provider: "anthropic",
            model: "claude-reviewer",
        })
    })

    test("tolerates null and primitive options", () => {
        expect(normalizeConfig(undefined).enabled).toBe(true)
        expect(normalizeConfig(null).enabled).toBe(true)
        expect(normalizeConfig("nope" as unknown).enabled).toBe(true)
    })
})

describe("deepMerge", () => {
    test("replaces non-object patches", () => {
        const replaced = deepMerge({ a: 1 }, 5)
        expect(replaced as unknown).toBe(5)
        expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 })
    })

    test("merges arrays by replacement", () => {
        expect(deepMerge({ list: [1, 2] }, { list: [3] })).toEqual({ list: [3] })
    })
})
