import { appendFileSync, mkdirSync } from "node:fs"
import path from "node:path"

export const DEFAULT_LOG_FILE = "/tmp/opencode/jev-router.log"

export interface LoggerOptions {
    logging?: boolean
    logFile?: string
}

function serializeArg(arg: unknown): unknown {
    if (arg instanceof Error) {
        return JSON.stringify({
            name: arg.name,
            message: arg.message,
            stack: arg.stack,
            cause: arg.cause ? serializeArg(arg.cause) : undefined,
        })
    } else if (typeof arg === "object") {
        return JSON.stringify(arg)
    } else {
        return arg
    }
}

function log(file: string, ...args: unknown[]) {
    const serializedArgs = args.map(serializeArg)
    appendFileSync(file, `[${new Date().toISOString()}] ${serializedArgs.join(" ")}\n`)
}

let directoryEnsured: string | undefined

function ensureDirectory(file: string) {
    const directory = path.dirname(file)

    if (directoryEnsured === directory) {
        return
    }

    try {
        mkdirSync(directory, { recursive: true })
        directoryEnsured = directory
    } catch {
        // Fall through: appendFileSync reports its own error below.
    }
}

const fileLogger = (systemId: string, file: string) => {
    ensureDirectory(file)

    return {
        info: (...args: unknown[]) => log(file, "[INFO]", `[${systemId}]`, ...args),
        debug: (...args: unknown[]) => log(file, "[DEBUG]", `[${systemId}]`, ...args),
        warn: (...args: unknown[]) => log(file, "[WARN]", `[${systemId}]`, ...args),
        error: (...args: unknown[]) => log(file, "[ERROR]", `[${systemId}]`, ...args),
    }
}

const noopLogger = (_: string) => ({
    info: (..._: unknown[]) => { },
    debug: (..._: unknown[]) => { },
    warn: (..._: unknown[]) => { },
    error: (..._: unknown[]) => { },
})

export const initLogger = (systemId: string, options: LoggerOptions = {}) => {
    if (!options.logging) {
        return noopLogger(systemId)
    }

    return fileLogger(systemId, options.logFile ?? DEFAULT_LOG_FILE)
}

export type Logger = ReturnType<typeof initLogger>
