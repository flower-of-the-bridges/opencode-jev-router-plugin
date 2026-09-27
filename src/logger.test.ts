import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { DEFAULT_LOG_FILE, initLogger } from "./logger"

const testLogFile = "/tmp/opencode/jev-router-test/logger/test.log"

beforeAll(() => {
    rmSync("/tmp/opencode/jev-router-test/logger", { recursive: true, force: true })
})

afterAll(() => {
    rmSync("/tmp/opencode/jev-router-test/logger", { recursive: true, force: true })
})

describe("logger", () => {
    test("writes leveled lines with the system id to the file", () => {
        const logger = initLogger("test-system", { logging: true, logFile: testLogFile })

        logger.info("hello", { a: 1 })
        logger.warn("careful")
        logger.error(new Error("boom"))

        const contents = readFileSync(testLogFile, "utf8").trim().split("\n")
        expect(contents).toHaveLength(3)
        expect(contents[0]).toContain("[INFO] [test-system] hello")
        expect(contents[0]).toContain("20") // ISO timestamp prefix
        expect(contents[1]).toContain("[WARN] [test-system] careful")
        expect(contents[2]).toContain("[ERROR] [test-system]")
        expect(contents[2]).toContain("boom")
    })

    test("serializes errors with name, message, and stack", () => {
        const logger = initLogger("err-system", { logging: true, logFile: testLogFile })
        logger.error(new Error("with stack"))

        const last = readFileSync(testLogFile, "utf8").trim().split("\n").at(-1) as string
        expect(last).toContain('"name":"Error"')
        expect(last).toContain("with stack")
    })

    test("noop logger writes nothing", () => {
        const logger = initLogger("quiet", { logging: false, logFile: testLogFile })
        logger.info("invisible")
        logger.debug("also invisible")

        const contents = readFileSync(testLogFile, "utf8")
        expect(contents).not.toContain("invisible")
    })

    test("default log file lives under /tmp/opencode", () => {
        expect(DEFAULT_LOG_FILE).toBe("/tmp/opencode/jev-router.log")
        expect(existsSync("/tmp/opencode")).toBe(true)
    })
})
