import { homedir } from "os"
import path from "path"
import fs from "fs/promises"

export const AUTH_FILE_LOCATION = path.join(
    homedir(),
    ".local",
    "share",
    "opencode",
    "auth.json",
)

type OpenCodeAuth = Record<string, {
    type: "api",
    key: string
}>

/**
 * Read the API key OpenCode stored for a provider.
 * Missing file, unparsable JSON, or non-API credentials return `undefined`.
 */
export async function getApiAuthFromProvider(
    providerId: string,
    authFile: string = AUTH_FILE_LOCATION,
): Promise<string | undefined> {
    let raw: string

    try {
        raw = await fs.readFile(authFile, { encoding: "utf8" })
    } catch {
        return undefined
    }

    let auth: OpenCodeAuth

    try {
        auth = JSON.parse(raw) as OpenCodeAuth
    } catch {
        return undefined
    }

    if (!auth || typeof auth !== "object") {
        return undefined
    }

    const providerAuth = auth[providerId]

    if (providerAuth?.type === "api") {
        return providerAuth.key
    }

    return undefined
}
