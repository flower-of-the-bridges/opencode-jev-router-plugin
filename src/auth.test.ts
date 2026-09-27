import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { getApiAuthFromProvider } from "./auth"

const authDir = "/tmp/opencode/jev-router-test/auth"
const authFile = `${authDir}/auth.json`

afterAll(() => {
    rmSync("/tmp/opencode/jev-router-test", { recursive: true, force: true })
})

describe("getApiAuthFromProvider", () => {
    test("reads the api key for a provider", async () => {
        mkdirSync(authDir, { recursive: true })
        writeFileSync(authFile, JSON.stringify({
            openrouter: { type: "api", key: "sk-or-123" },
            other: { type: "oauth", key: "not-api" },
        }))

        expect(await getApiAuthFromProvider("openrouter", authFile)).toBe("sk-or-123")
        expect(await getApiAuthFromProvider("other", authFile)).toBeUndefined()
        expect(await getApiAuthFromProvider("unknown", authFile)).toBeUndefined()
    })

    test("returns undefined for a missing file", async () => {
        expect(await getApiAuthFromProvider("openrouter", "/tmp/opencode/jev-router-test/missing.json")).toBeUndefined()
    })

    test("returns undefined for unparsable json", async () => {
        mkdirSync(authDir, { recursive: true })
        writeFileSync(authFile, "{not json")

        expect(await getApiAuthFromProvider("openrouter", authFile)).toBeUndefined()
    })
})
