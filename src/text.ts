import { createReadStream } from "node:fs"
import { fileURLToPath } from "node:url"

/** Rough token estimate (~4 chars/token). Good enough for routing. */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
}

/** Stream a local file and estimate its token count. */
export async function estimateFileTokens(uri: string): Promise<number> {
    const path = fileURLToPath(uri)
    let count = 0

    for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
        count += chunk.length
    }

    return Math.ceil(count / 4)
}

export interface Mention {
    start: number
    end: number
    text: string
}

/**
 * Remove `@`-mention ranges from text.
 *
 * Ranges are removed from the end of the string backwards so earlier
 * offsets stay valid while later mentions are cut. If an offset no longer
 * matches its expected text, the mention falls back to a text lookup.
 */
export function stripMentions(text: string, mentions: readonly Mention[]): string {
    if (mentions.length === 0) {
        return text.trim()
    }

    const ranges = [...mentions]
        .filter((mention) => mention.end > mention.start)
        .sort((a, b) => b.start - a.start)

    let result = text

    for (const mention of ranges) {
        result = removeRange(result, mention)
    }

    return result.trim()
}

function removeRange(text: string, mention: Mention): string {
    const start = Math.max(0, Math.min(mention.start, text.length))
    const end = Math.max(start, Math.min(mention.end, text.length))

    if (text.slice(start, end) === mention.text) {
        return tidy(text.slice(0, start), text.slice(end))
    }

    // Offsets drifted (overlapping edits, reordered mentions): match by text.
    const index = text.indexOf(mention.text)

    if (index >= 0) {
        return tidy(text.slice(0, index), text.slice(index + mention.text.length))
    }

    return text
}

/** Join two halves, dropping one blank so the seam has no double space. */
function tidy(before: string, after: string): string {
    if (/[\t ]$/.test(before) && /^[\t ]/.test(after)) {
        return before.slice(0, -1) + after
    }

    return before + after
}

/** Collapse whitespace and cap length, marking truncation with an ellipsis. */
export function truncatePreview(text: string, maxChars: number): string {
    const collapsed = text.replace(/\s+/g, " ").trim()

    if (collapsed.length <= maxChars) {
        return collapsed
    }

    return `${collapsed.slice(0, Math.max(0, maxChars - 1))}…`
}
