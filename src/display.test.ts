import { describe, expect, test } from "bun:test"
import { normalizeConfig } from "./config"
import { describeDecision, formatDecisionBlock } from "./display"
import { makeDecisionFixture } from "./router"

const resolved = { provider: "openrouter", model: "deepseek/deepseek-v4.1-flash" }
const fixture = makeDecisionFixture()

describe("describeDecision", () => {
    test("one line with tier, model, task type, effort, and cost", () => {
        const description = describeDecision(fixture, resolved, { tier: "powerful", confidence: 0.93, trusted: true })

        expect(description.startsWith("⚡ jev:")).toBe(true)
        expect(description).toContain("powerful (93%)")
        expect(description).toContain("→ openrouter/deepseek/deepseek-v4.1-flash")
        expect(description).toContain("implementation")
        expect(description).toContain("effort high")
        expect(description).toContain("$0.00000240")
        expect(description.split("\n").length).toBe(1)
    })

    test("degrades when there is no trusted tier", () => {
        const description = describeDecision(fixture, resolved, { trusted: false })
        expect(description).toContain("untrusted tier")
        expect(description).not.toContain("(")
    })
})

describe("formatDecisionBlock", () => {
    test("emits the machine-readable block and human summary", () => {
        const text = formatDecisionBlock({
            response: fixture,
            resolved,
            tier: { tier: "powerful", confidence: 0.93, trusted: true },
            conversation: {
                turnCount: 3,
                contextTokens: 12400,
                previous: { fileCount: 2 },
            },
        })

        expect(text).toContain("[JEV ROUTING DECISION]")
        expect(text).toContain("[/JEV ROUTING DECISION]")
        expect(text).toContain("model_tier: powerful (confidence 0.93)")
        expect(text).toContain("reasoning_complexity: high")
        expect(text).toContain("task_type: implementation")
        expect(text).toContain("effort: high")
        expect(text).toContain("task_scope: multi")
        expect(text).toContain("ambiguity: medium")
        expect(text).toContain("selected_model: openrouter/deepseek/deepseek-v4.1-flash")
        expect(text).toContain("decision_id: dec_test")

        expect(text).toContain("tier `powerful` (93%)")
        expect(text).toContain("task `implementation`")
        expect(text).toContain("reasoning `high` · effort `high`")
        expect(text).toContain("scope `multi` · ambiguity `medium`")
        expect(text).toContain("3 prior turns · ~12.4k tok context · 2 prev files")
        expect(text).toContain("jev cost $0.00000240 (1200 in / 96 out)")
    })

    test("omits lines for missing answers and reports untrusted tiers", () => {
        const text = formatDecisionBlock({
            response: makeDecisionFixture({
                id: undefined,
                answers: {
                    model_tier: { type: "choice", choice: "cheap", confidence: 0.1 },
                },
            }),
            resolved: { provider: "openrouter", model: "z-ai/glm-5.3-flash" },
            tier: { tier: "cheap", confidence: 0.1, trusted: false },
        })

        expect(text).toContain("model_tier: untrusted (below confidence threshold)")
        expect(text).not.toContain("reasoning_complexity:")
        expect(text).not.toContain("task_type:")
        expect(text).not.toContain("effort:")
        expect(text).not.toContain("task_scope:")
        expect(text).not.toContain("ambiguity:")
        expect(text).not.toContain("decision_id:")
    })
})
