# opencode-jev-router-plugin

Model routing for [OpenCode](https://opencode.ai/v2/) powered by the
[JEV](https://openrouter.ai/typesafe/jev-1.13) classifier. Before each prompt
is admitted, the plugin asks JEV a handful of small classification questions
about it, then switches the session to the cheapest model that is likely to
complete the work — and tells you (and the model) exactly why.

```text
⚡ jev: powerful (93%) → openrouter/deepseek/deepseek-v4.1-flash · implementation · effort high · $0.00000240
```

The line above is what you see collapsed in the TUI. Expanding the synthetic
message shows the full decision block that is also injected into the
conversation, so the model knows which constraints it is running under.

---

## How it works

```
 you type a prompt
        │
        ▼
 session.hook("prompt")            plugin, before admission
        │
        ├─ skip? empty text, /command prefix, ignored @agent, too short
        │
        ├─ collect context         files (with token estimates), @skills,
        │                          previous turn + context size, repository
        │
        ▼
 JEV classifier (systemone API)    one call, six questions
        │
        ├─ model_tier              cheap | default | powerful
        ├─ reasoning_complexity    low | medium | high
        ├─ task_scope              single | multi | system
        ├─ ambiguity               low | medium | high
        ├─ task_type               question | implementation | bugfix | …
        └─ effort                  low | medium | high
        │
        ▼
 resolve tier → model              confidence gate + task-type overrides
        │
        ├─ availability check      model missing from the registry?
        │                          → fallback; fallback missing → keep model
        ├─ session.switchModel     session now runs on the chosen model
        ├─ session.synthetic       the decision block you see in the TUI
        └─ storage                 decision + usage persisted per session
        │
        ▼
 session.hook("context")           on every agent-loop model call
        │
        └─ apply effort            reasoning_effort / reasoningEffort
                                   provider option from the effort answer
```

If anything in the routing path fails — classifier down, bad key, timeout —
the session falls back to the configured fallback model and routing simply
does not happen. The prompt is always admitted; routing is best-effort and
never blocks your work.

## Installation

### Local directory (this repo)

```jsonc title="~/.config/opencode/opencode.jsonc"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./plugins/jev-router/src",
      "options": {}
    }
  ]
}
```

### Published package

```jsonc title="opencode.jsonc"
{
  "plugins": [
    {
      "package": "opencode-jev-router-plugin",
      "options": { "logging": false }
    }
  ]
}
```

### Requirements

- The classifier provider must be authenticated with OpenCode itself
  (`opencode auth login`), because the plugin reads the API key for the
  **router** provider from `~/.local/share/opencode/auth.json`. The routed
  target models use OpenCode's normal provider auth.
- The router provider must expose the JEV `systemone` endpoint (OpenRouter
  does).

## Configuration

All options are optional; defaults below. Options are read from the
`options` object of the plugin entry in `opencode.jsonc`. Nested objects are
deep-merged with the defaults, so you can override a single field.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Set `false` to unload all hooks; the plugin becomes a no-op. |
| `router` | `{ provider, model }` | `openrouter` / `typesafe/jev-1.13` | The JEV classifier endpoint. |
| `cheap` | `{ provider, model }` | `openrouter` / `qwen/qwen3.6-flash` | Target model for the `cheap` tier. |
| `powerful` | `{ provider, model }` | `openrouter` / `deepseek/deepseek-v4-pro-0813` | Target model for the `powerful` tier. |
| `fallback` | `{ provider, model }` | `openrouter` / `z-ai/glm-5.3-flash` | Target for the `default` tier, low-confidence decisions, and all failures. |
| `taskTypeModels` | `Record<task_type, { provider, model }>` | `{}` | Optional per-task-type model override. Wins over the tier model. |
| `minimumPromptLength` | `number` | `100` | Prompts shorter than this (after `@`-mentions are stripped) are not routed. |
| `minimumThresholdConfidence` | `number` | `0.5` | Tier answers below this confidence are untrusted → fallback model. |
| `timeoutMs` | `number` | `5000` | Classifier call timeout in milliseconds. |
| `ignoredPrefixes` | `string[]` | `["/help", "/models", "/connect", "/logout", "/clear"]` | Prompts starting with these are not routed. |
| `ignoredAgents` | `string[]` | `["title", "compaction"]` | Prompts mentioning these `@agents` are not routed. |
| `previousContext` | `{ enabled, maxPreviewChars, maxFiles }` | `true` / `240` / `10` | Send previous-turn and context-size details to the classifier. |
| `reasoningEffort` | `{ providers, values }` | see below | Apply the classifier's `effort` answer as a provider option. |
| `logging` | `boolean` | `true` | Write a debug log file. |
| `logFile` | `string` | `/tmp/opencode/jev-router.log` | Log destination (created on demand). |

### Example: custom tiers and task-type overrides

```jsonc title="opencode.jsonc"
{
  "plugins": [
    {
      "package": "./plugins/jev-router/src",
      "options": {
        "cheap": { "provider": "openrouter", "model": "qwen/qwen3.5-flash" },
        "powerful": { "provider": "anthropic", "model": "claude-opercraft-4-6" },
        "taskTypeModels": {
          // reviews always go to the review specialist, whatever the tier
          "review": { "provider": "anthropic", "model": "claude-reviewer" }
        },
        "minimumPromptLength": 40,
        "logging": false
      }
    }
  ]
}
```

## The six classifier questions

| Question | Choices | Feeds |
| --- | --- | --- |
| `model_tier` | `cheap` / `default` / `powerful` | The model the session switches to. |
| `reasoning_complexity` | `low` / `medium` / `high` | Display + decision block. |
| `task_scope` | `single` / `multi` / `system` | Display + decision block. |
| `ambiguity` | `low` / `medium` / `high` | Display + decision block. |
| `task_type` | `question` / `implementation` / `bugfix` / `debugging` / `refactor` / `review` / `research` / `other` | `taskTypeModels` override + display. |
| `effort` | `low` / `medium` / `high` | Provider reasoning-effort option + display. |

Answers may be missing (classifier version drift, partial failure); every
consumer degrades gracefully to the fallback/default behavior instead of
throwing.

## Model resolution

For each prompt the plugin resolves one model, in order:

1. **Task-type override** — if `taskTypeModels[task_type]` is configured,
   that model wins outright.
2. **Trusted tier** — if the `model_tier` answer is at or above
   `minimumThresholdConfidence`, `powerful` → `powerful.*`, `cheap` →
   `cheap.*`.
3. **Fallback** — `default` tier, untrusted or missing tier answers, and
   every error path land on `fallback.*`.

Before switching, the resolved model is checked against OpenCode's model
registry. If it is not available (removed, renamed, provider disabled), the
plugin logs a warning and switches to the fallback instead; if even the
fallback is missing, the session keeps its current model and the decision
message still explains what happened.

Before switching, the resolved model is checked against the OpenCode model
registry. If it is not available (wrong ID, provider not configured), the
plugin logs a warning and uses the fallback model; if even the fallback is
missing, the session keeps its current model. Routing degrades, it never
breaks the session.

The confidence gate and the resolved model are shown in the synthetic
message:

```text
[JEV ROUTING DECISION]
model_tier: powerful (confidence 0.93)
reasoning_complexity: high
task_type: implementation
effort: high
task_scope: multi
ambiguity: medium
selected_model: openrouter/deepseek/deepseek-v4.1-flash
decision_id: gen-dec-1790535436-c4v4f0DIgjFJho8dPSbL
[/JEV ROUTING DECISION]

⚡ **JEV routed** → `openrouter/deepseek/deepseek-v4.1-flash`
tier `powerful` (93%) · task `implementation` · reasoning `high` · effort `high` · scope `multi` · ambiguity `medium` · 3 prior turns · ~12.4k tok context · 2 prev files
jev cost $0.00000240 (1200 in / 96 out)
```

The bracketed block is deliberately machine-readable: it travels in the
conversation, so the model itself knows its tier, reasoning budget, and task
context. The summary lines below it are for humans.

## Previous-message context

When `previousContext.enabled` is on (the default), the plugin reads the
session history with `ctx.session.context()` and sends the classifier a
compact `conversation` object:

| Field | Meaning |
| --- | --- |
| `previous.userTextPreview` | The previous user message, whitespace-collapsed, capped at `maxPreviewChars`. |
| `previous.userTextTokens` | Rough token estimate of that message. |
| `previous.assistant.model` | Which model produced the last answer. |
| `previous.assistant.agent` | Which agent ran it. |
| `previous.assistant.finish` | `stop`, `tool-calls`, `error`, … |
| `previous.assistant.cost` | What the last turn cost. |
| `previous.assistant.tokens` | `input` / `output` / `reasoning` / `cacheRead` / `cacheWrite`. |
| `previous.assistant.toolCount` | Tool calls the last turn made. |
| `previous.assistant.textPreview` | Preview of the last answer. |
| `previous.files` / `previous.fileCount` | Files the last turn touched (user attachments + assistant `snapshot.files`), deduplicated and capped at `maxFiles`. |
| `contextTokens` | Estimated size of the context the previous call saw: `input + output + reasoning + cacheRead + cacheWrite`. |
| `turnCount` | User turns already in the session. |

This is what lets JEV tell a "continue refactoring what we started" prompt
on a 60k-token conversation apart from the same sentence on turn one.
Previews are truncated; file names are capped; no file contents are ever
sent to the classifier — only counts and names.

## Effort → reasoning effort

The classifier's `effort` answer is applied to every agent-loop model call
of the session through the `session.hook("context", …)` hook. The mapping is
configurable per provider, because provider protocols name the option
differently:

| Provider (default map) | Provider option set |
| --- | --- |
| `openrouter` | `reasoning_effort` (OpenAI-compatible chat protocol) |
| `openai` | `reasoningEffort` (OpenAI Responses protocol) |

Providers missing from the map get nothing. Opt one out with an empty
string, add your own, and optionally remap the values:

```jsonc title="opencode.jsonc"
{
  "plugins": [
    {
      "package": "./plugins/jev-router/src",
      "options": {
        "reasoningEffort": {
          "providers": {
            // keep defaults, add one, opt one out
            "anthropic": "thinking_budget",
            "openai": ""
          },
          // remap a classifier choice to a protocol value
          "values": { "high": "xhigh" }
        }
      }
    }
  ]
}
```

## Usage and cost tracking

Every classifier call is accumulated per session in plugin storage:

- `jev/decision/<sessionID>` — the latest `StoredDecision` (response, message
  id, timestamp). One per session; each prompt overwrites it. It survives
  plugin reloads, and it is what the effort hook reads.
- `jev/usage/<sessionID>` — `{ cost, inputTokens, outputTokens, requests }`.

Inspect them with any storage browser, or grep the log file for
`routing decision:` lines.

## Logging

With `logging: true` (default) the plugin appends one compact JSON-per-line
record per event to `logFile`:

```text
[2026-09-27T17:41:02.115Z] [INFO] [opencode-jev-router-plugin] routing decision: ⚡ jev: powerful (93%) → …
[2026-09-27T17:41:02.117Z] [DEBUG] [opencode-jev-router-plugin] applied effort high as openrouter:reasoning_effort=high
```

Set `logging: false` for silent operation.

## Development

```sh
bun test            # 78 tests across 11 files, colocated *.test.ts
bunx tsc --noEmit   # strict typecheck
```

Layout:

```text
src/
├── index.ts        # plugin entry: wires real OpenCode deps into the router
├── router.ts       # prompt-hook flow (testable, deps injected)
├── effort.ts       # context-hook flow: effort → provider option
├── jev.ts          # classifier request/response protocol
├── history.ts      # previous turn + context-size summarizer
├── decision.ts     # tier/confidence resolution + storage persistence
├── display.ts      # TUI formatting (one-liner + decision block)
├── usage.ts        # per-session usage accumulation
├── config.ts       # options + deep-merged defaults
├── text.ts         # token estimates, @-mention stripping, previews
├── logger.ts       # leveled file logger
└── auth.ts         # reads the router provider key from OpenCode auth
```

Testing follows the same convention as `@opencode/plugin` itself: `bun test`,
colocated `*.test.ts` files, no build step. The plugin entry (`index.ts`) is
a thin shell; everything it wires is a plain function taking injected
dependencies, which is why the whole prompt flow is tested without starting
OpenCode.

## Troubleshooting

- **Nothing seems to route.** Check the log file first. Common causes: the
  router provider has no `auth.json` entry (log: `no API key available`),
  the provider is missing or has no `baseURL` (log: `provider … not found`),
  or the prompt is shorter than `minimumPromptLength` after `@`-mention
  stripping.
- **Every prompt lands on the fallback model.** The classifier call is
  failing — look for `jev routing failed` in the log; `timeoutMs` may be too
  small for your network.
- **"resolved model … is not available".** Your tier defaults point at
  models your OpenCode setup does not have. Override `cheap`, `powerful`,
  and `fallback` with model IDs from `opencode models`.
- **Effort is not applied.** The routed provider must appear in
  `reasoningEffort.providers`, and the protocol must accept the option
  (check the provider's docs). Unknown providers are silently skipped.
