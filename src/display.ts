import type { ChoiceConfig } from "./config"
import type { JevRoutingResponse, RoutingConversation } from "./jev"
import type { TierPick } from "./decision"

function percent(confidence: number | undefined): string {
    return confidence === undefined ? "?" : `${Math.round(confidence * 100)}%`
}

function formatTokens(tokens: number): string {
    if (tokens >= 1000) {
        return `${(tokens / 1000).toFixed(1)}k`
    }

    return `${tokens}`
}

function formatCost(cost: number): string {
    return `$${cost.toFixed(8)}`
}

/**
 * One-line summary for the TUI: shown as the collapsed-message description.
 * Example: `⚡ jev: powerful (93%) → openrouter/deepseek-v4.1-flash ·
 * implementation · effort high · $0.0000024`
 */
export function describeDecision(
    response: JevRoutingResponse,
    resolved: ChoiceConfig,
    tier: TierPick,
): string {
    const parts: string[] = []

    if (tier.trusted && tier.tier) {
        parts.push(`${tier.tier} (${percent(tier.confidence)})`)
    } else {
        parts.push("untrusted tier")
    }

    parts.push(`→ ${resolved.provider}/${resolved.model}`)

    const taskType = response.answers.task_type?.choice

    if (taskType) {
        parts.push(taskType)
    }

    const effort = response.answers.effort?.choice

    if (effort) {
        parts.push(`effort ${effort}`)
    }

    parts.push(formatCost(response.usage.cost))

    return `⚡ jev: ${parts.join(" · ")}`
}

export interface DecisionBlockInput {
    response: JevRoutingResponse
    resolved: ChoiceConfig
    tier: TierPick
    conversation?: RoutingConversation
}

/**
 * Full synthetic-message text. The bracketed block is stable,
 * machine-readable context for the model; the summary below is for humans.
 */
export function formatDecisionBlock({
    response,
    resolved,
    tier,
    conversation,
}: DecisionBlockInput): string {
    const lines: string[] = ["[JEV ROUTING DECISION]"]

    const push = (key: string, value: string | undefined, suffix?: string) => {
        if (value !== undefined) {
            lines.push(`${key}: ${value}${suffix ? ` ${suffix}` : ""}`)
        }
    }

    if (tier.trusted && tier.tier) {
        push("model_tier", tier.tier, `(confidence ${tier.confidence?.toFixed(2)})`)
    } else {
        lines.push("model_tier: untrusted (below confidence threshold)")
    }

    push("reasoning_complexity", response.answers.reasoning_complexity?.choice)
    push("task_type", response.answers.task_type?.choice)
    push("effort", response.answers.effort?.choice)
    push("task_scope", response.answers.task_scope?.choice)
    push("ambiguity", response.answers.ambiguity?.choice)
    push("selected_model", `${resolved.provider}/${resolved.model}`)
    push("decision_id", response.id)

    lines.push("[/JEV ROUTING DECISION]")

    lines.push("")

    // Human-readable summary rendered by the TUI.
    const summary: string[] = []

    summary.push(
        `⚡ **JEV routed** → \`${resolved.provider}/${resolved.model}\``,
    )

    const facts: string[] = []

    if (tier.trusted && tier.tier) {
        facts.push(`tier \`${tier.tier}\` (${percent(tier.confidence)})`)
    }

    const taskType = response.answers.task_type?.choice

    if (taskType) {
        facts.push(`task \`${taskType}\``)
    }

    const complexity = response.answers.reasoning_complexity?.choice
    const effort = response.answers.effort?.choice

    if (complexity || effort) {
        facts.push(
            `reasoning ${complexity ? `\`${complexity}\`` : "?"}${effort ? ` · effort \`${effort}\`` : ""}`,
        )
    }

    const scope = response.answers.task_scope?.choice
    const ambiguity = response.answers.ambiguity?.choice

    if (scope || ambiguity) {
        facts.push(
            `scope ${scope ? `\`${scope}\`` : "?"}${ambiguity ? ` · ambiguity \`${ambiguity}\`` : ""}`,
        )
    }

    if (conversation) {
        const contextBits: string[] = [`${conversation.turnCount ?? 0} prior turns`]

        if (conversation.contextTokens !== undefined) {
            contextBits.push(`~${formatTokens(conversation.contextTokens)} tok context`)
        }

        if (conversation.previous?.fileCount) {
            contextBits.push(`${conversation.previous.fileCount} prev files`)
        }

        facts.push(contextBits.join(" · "))
    }

    summary.push(
        `${facts.join(" · ")}`,
    )

    summary.push(
        `jev cost ${formatCost(response.usage.cost)} (${response.usage.input_tokens} in / ${response.usage.output_tokens} out)`,
    )

    lines.push(...summary)

    return lines.join("\n")
}
