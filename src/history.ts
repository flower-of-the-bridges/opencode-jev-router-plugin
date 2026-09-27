import type { PreviousTurnContext, RoutingConversation } from "./jev"
import { estimateTokens, truncatePreview } from "./text"

export interface HistoryContentPart {
    type?: string
    text?: string
    id?: string
    name?: string
}

/** Structural subset of the session messages returned by `ctx.session.context()`. */
export interface HistoryMessage {
    id?: string
    type?: string
    text?: string
    files?: ReadonlyArray<{ name?: string }>
    agent?: string
    model?: { providerID?: string; id?: string } | string
    finish?: string
    cost?: number
    tokens?: {
        input?: number
        output?: number
        reasoning?: number
        cache?: { read?: number; write?: number }
    }
    snapshot?: { files?: ReadonlyArray<string> }
    content?: ReadonlyArray<HistoryContentPart>
}

export interface BuildConversationOptions {
    /** The prompt currently being admitted; it is not history yet. */
    currentMessageID?: string
    maxPreviewChars?: number
    maxFiles?: number
}

function modelName(model: HistoryMessage["model"]): string | undefined {
    if (typeof model === "string") {
        return model || undefined
    }

    if (model?.providerID && model?.id) {
        return `${model.providerID}/${model.id}`
    }

    return undefined
}

export interface TokenSummary {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
}

function tokenSummary(tokens: HistoryMessage["tokens"]): TokenSummary | undefined {
    if (!tokens || typeof tokens.input !== "number") {
        return undefined
    }

    return {
        input: tokens.input,
        output: tokens.output ?? 0,
        reasoning: tokens.reasoning ?? 0,
        cacheRead: tokens.cache?.read ?? 0,
        cacheWrite: tokens.cache?.write ?? 0,
    }
}

/** Tokens the previous model call saw, including its own output. */
export function estimateContextTokens(tokens: TokenSummary | undefined): number | undefined {
    if (!tokens) {
        return undefined
    }

    return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite
}

function collectFileNames(
    userFiles: HistoryMessage["files"],
    touchedFiles: ReadonlyArray<string> | undefined,
    maxFiles: number,
): { files: string[]; fileCount: number } | undefined {
    const names: string[] = []

    for (const file of userFiles ?? []) {
        if (file.name) {
            names.push(file.name)
        }
    }

    for (const file of touchedFiles ?? []) {
        if (file && !names.includes(file)) {
            names.push(file)
        }
    }

    if (names.length === 0) {
        return undefined
    }

    return { files: names.slice(0, maxFiles), fileCount: names.length }
}

/**
 * Summarize the conversation for the classifier: previous turn details and
 * a context-size estimate. Returns `undefined` when there is no completed
 * turn to report, keeping first prompts lean.
 */
export function buildConversation(
    messages: readonly HistoryMessage[],
    options: BuildConversationOptions = {},
): RoutingConversation | undefined {
    const maxPreviewChars = options.maxPreviewChars ?? 240
    const maxFiles = options.maxFiles ?? 10

    const history = messages.filter(
        (message) =>
            (message.type === "user" || message.type === "assistant")
            && message.id !== options.currentMessageID,
    )

    if (history.length === 0) {
        return undefined
    }

    const turnCount = history.filter((message) => message.type === "user").length

    let lastAssistantIndex = -1

    for (let i = history.length - 1; i >= 0; i -= 1) {
        if (history[i].type === "assistant") {
            lastAssistantIndex = i
            break
        }
    }

    if (lastAssistantIndex < 0) {
        return undefined
    }

    const assistantMessage = history[lastAssistantIndex]
    const userMessage = history
        .slice(0, lastAssistantIndex)
        .reverse()
        .find((message) => message.type === "user")

    const previous: PreviousTurnContext = {}

    if (userMessage?.text) {
        previous.userTextPreview = truncatePreview(userMessage.text, maxPreviewChars)
        previous.userTextTokens = estimateTokens(userMessage.text)
    }

    const tokens = tokenSummary(assistantMessage.tokens)

    const assistant: NonNullable<PreviousTurnContext["assistant"]> = {}

    const model = modelName(assistantMessage.model)

    if (model) {
        assistant.model = model
    }

    if (assistantMessage.agent) {
        assistant.agent = assistantMessage.agent
    }

    if (assistantMessage.finish) {
        assistant.finish = assistantMessage.finish
    }

    if (typeof assistantMessage.cost === "number") {
        assistant.cost = assistantMessage.cost
    }

    if (tokens) {
        assistant.tokens = tokens
    }

    const toolCount = (assistantMessage.content ?? [])
        .filter((part) => part.type === "tool")
        .length

    if (toolCount > 0) {
        assistant.toolCount = toolCount
    }

    const assistantText = (assistantMessage.content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join(" ")

    if (assistantText.trim()) {
        assistant.textPreview = truncatePreview(assistantText, maxPreviewChars)
    }

    if (Object.keys(assistant).length > 0) {
        previous.assistant = assistant
    }

    const files = collectFileNames(
        userMessage?.files,
        assistantMessage.snapshot?.files,
        maxFiles,
    )

    if (files) {
        previous.files = files.files
        previous.fileCount = files.fileCount
    }

    const contextTokens = estimateContextTokens(tokens)

    return {
        previous,
        ...(contextTokens !== undefined ? { contextTokens } : {}),
        turnCount,
    }
}
