# CTRSCM — Claude Tool Result Shake Compaction Mod
## Research-backed implementation intent

> **Status:** [Unverified] as a whole because this document combines source-verified behavior with proposed CTRSCM architecture and implementation recommendations.
>
> **Research date:** 2026-10-05
>
> **Primary intent:** Build a Claude Code **Mod** that replaces ordinary summary-based compaction, when possible, with deterministic OMP-style **tool-result Shake compaction**: old/heavy tool-result text is externalized to recoverable local artifacts and replaced in the live transcript by small references, while conversational text and tool calls remain intact.

---

# 1. Project identity

**Name:** CTRSCM  
**Expansion:** Claude Tool Result Shake Compaction Mod

CTRSCM is intentionally narrow. It is not a general summarizer, memory system, semantic compressor, or context manager.

The first implementation should solve one problem well:

> When Claude Code wants to compact a conversation, preserve the conversation itself and mechanically remove bulk from eligible tool results, while keeping every removed result recoverable.

The implementation should be deterministic, local, auditable, and reversible through an explicit recovery tool.

---

# 2. Non-negotiable product intent

## 2.1 Preserve conversational context verbatim

CTRSCM v1 MUST NOT summarize, rewrite, classify, paraphrase, or delete ordinary user/assistant text.

Specifically:

- Preserve every `SessionMessage.text` value byte-for-byte/string-for-string unless Claude Code itself has already transformed it before the Mod sees it.
- Preserve assistant tool calls.
- Preserve tool-call ordering.
- Preserve each tool result's `tool_use_id`.
- Preserve recent tool-result context according to the configured protection window.
- Externalize only eligible tool-result **text** in v1.
- Do not implement OMP's fenced-code/XML-block shaking in user/assistant prose in v1.

This narrower scope is deliberate. OMP Shake supports both tool results and large fenced/XML regions, but CTRSCM's name and primary purpose are specifically **Tool Result Shake Compaction**.

## 2.2 No LLM in the compaction algorithm

The compaction decision MUST NOT require:

- Claude,
- another remote model,
- a local model,
- embeddings,
- a relevance classifier,
- or a network request.

The algorithm should be mechanical.

This matches modern OMP Shake. OMP briefly introduced a local-model `summarizeShakeRegions` path in 15.7.3, then removed it in 15.7.4 so Shake became mechanical artifact-backed elision only.

## 2.3 Never advertise recovery unless recovery is real

A placeholder MUST NOT claim that removed text can be recovered until the artifact has been successfully persisted in the exact storage system used by the recovery tool.

This is a hard correctness invariant.

OMP issue #12466 demonstrates why: in a non-persisted OMP session, Shake could mint an `artifact://` identifier even though the artifact could not actually be resolved. CTRSCM must structurally prevent this class of bug.

**Required ordering:**

1. Detect eligible results.
2. Construct artifact payloads.
3. Persist all artifacts/chunks.
4. Commit each artifact manifest.
5. Verify the artifact set is resolvable enough for the recovery implementation.
6. Only then construct/return the rewritten transcript.

If any required artifact cannot be committed, CTRSCM MUST NOT return a transcript containing a recovery reference to it.

## 2.4 Recovery is part of the feature, not an optional extra

Every shaken result must be recoverable by a Mod-provided custom tool.

Do not imitate OMP's literal `artifact://` URI unless CTRSCM actually implements such a protocol. Claude Code already provides a cleaner mechanism: register a custom tool such as:

`mcp__ctrscm__recover`

The placeholder should tell the model exactly which tool and artifact ID to use.

---

# 3. What OMP Shake actually does

## 3.1 High-level behavior

Source-verified OMP behavior:

- Shake is an **inline/local** reduction, not an LLM summary.
- It can elide:
  - eligible tool-result text;
  - large fenced blocks;
  - large top-level lowercase XML blocks.
- Removed content is replaced with a small placeholder.
- The original content is persisted as an artifact.
- A recent context tail is protected.
- Some tools/results are protected.
- Shake runs only if its savings gate is met.
- Tool calls themselves are never removed by Shake, preserving tool-call/result pairing.
- OMP can fall through to another compaction method when Shake does not create enough headroom.

OMP's current documentation explicitly describes Shake as local reduction using recoverable artifact references rather than a summarization model.

## 3.2 OMP's current core defaults

From `packages/agent/src/compaction/shake.ts`:

### Automatic Shake

```text
protectTokens = 16,000
minSavings   = 4,000
fenceMinTokens = 400
protectedTools =
  - skill
  - skill:// reads
  - artifact-recovery reads
```

### Aggressive/manual Shake

```text
protectTokens = 4,000
minSavings   = 0
protectedTools =
  - skill
  - skill:// reads
```

OMP deliberately keeps a small recent tail even for manual `/shake`, following a bug where aggressive Shake could remove outputs the agent was actively working from.

There is also a rescue configuration with `protectTokens = 0` for a dead-end recovery path, while artifact-recovery reads stay protected.

CTRSCM should copy the **principles**, not necessarily every numerical default blindly, because Claude Mods do not expose OMP's model-scoped tokenizer directly.

## 3.3 OMP region selection

OMP's `collectShakeRegions()`:

1. Computes how many context tokens occur after each entry.
2. Walks history oldest-to-newest.
3. Skips entries older than a previous compaction boundary that are no longer sent to the model.
4. Keeps entries inside the recent protected-token window.
5. Allows explicitly "useless" non-error results to bypass that protection.
6. Skips already-pruned results.
7. Skips protected tools/results.
8. Selects eligible tool-result text.
9. Separately scans user/developer/assistant/custom text for large fenced/XML blocks.
10. Computes estimated savings and returns no regions if total savings is below `minSavings`.

Important invariant from the source:

> Tool-call blocks are never touched.

That behavior should carry directly into CTRSCM.

## 3.4 OMP mutation behavior

For a selected tool result OMP:

- replaces the first non-empty text block with the Shake placeholder;
- removes additional text blocks;
- preserves non-text blocks, including images;
- marks the result as pruned;
- invalidates cached message conversion.

OMP 18.0.9 specifically fixed mixed tool-result handling so images remain preserved and savings accounting stays correct.

Claude Code's Mod-facing `ToolResultSummary` is already a flattened/model-read text representation rather than OMP's raw block array, so CTRSCM cannot blindly reproduce the block-level implementation. It should preserve the semantics at the `SessionMessage` abstraction exposed to Mods.

## 3.5 OMP artifact format

OMP currently emits placeholders similar to:

```text
[shaken ~N tokens — recover: artifact://ID (region K)]
```

and stores all regions for that Shake pass in one artifact with headings similar to:

```text
### region 1 (tool-name, ~N tok)

<original content>
```

The orchestration writes the artifact before mutating session history.

## 3.6 OMP's transactional orchestration is more important than its placeholder syntax

`SessionMaintenance.shake()` provides the most important implementation lesson.

OMP roughly performs:

```text
collect regions
→ reserve artifact
→ calculate exact replacement strings/savings
→ write recovery artifact
→ snapshot affected entries
→ apply in-memory replacements
→ persist rewritten history
→ if persistence fails: restore snapshots and rebuild context
→ rebuild live agent messages
→ reset dependent runtimes
→ tear down provider sessions/caches whose history identity changed
```

CTRSCM does not control Claude Code's internal provider session/cache machinery directly. However, Claude Code's `session.compact` hook gives CTRSCM a supported transcript replacement boundary, so the Mod should let Claude Code perform the host-side history replacement rather than attempting to mutate hidden state.

The transactional lesson remains:

> External data must commit before the transcript points at it.

## 3.7 OMP Shake is not the same as OMP pre-compaction pruning

Do not accidentally merge these concepts.

OMP also has a separate pruning pass whose current documented defaults protect the newest 40,000 tool-output tokens and require 20,000 estimated savings. That is **not** Shake.

CTRSCM v1 should implement Shake-like compaction only. Any opportunistic per-turn pruning should be a later, separate feature if desired.

---

# 4. Claude Mods: the integration surface CTRSCM should use

## 4.1 Mod structure

Anthropic's current official Claude Code repository describes a Mod as a plugin whose behavior lives in a function-hook module:

```ts
export const register: Register = (on, options) => {
  // on(...)
}
```

Typical layout:

```text
ctrscm/
├── .claude-plugin/
│   └── plugin.json
├── hooks/
│   ├── hooks.json
│   └── register.ts
├── src/
│   ├── shake.ts
│   ├── artifacts.ts
│   ├── recover.ts
│   ├── messages.ts
│   ├── estimate.ts
│   └── config.ts
├── tests/
│   └── ...
├── tsconfig.json
└── README.md
```

`hooks/hooks.json` names the TypeScript hook module.

Anthropic currently labels function hooks/Mods **early access**. The checked-in official declaration inspected for this research says it was generated by Claude Code `2.1.277` and explicitly warns that the API may change between releases.

Therefore:

**Do not code against copied type assumptions. Before implementation, run `/plugin-types` on the developer's installed Claude Code and treat those generated declarations as authoritative.**

Also run:

```text
claude plugin validate <ctrscm-dir>
claude plugin test <ctrscm-dir>
```

## 4.2 Runtime restrictions

The current official declarations say a hooks module:

- runs in its own environment;
- has no DOM;
- has no Node runtime APIs;
- uses ES modules;
- has no `require`;
- can use supplied web APIs such as `URL`, `TextEncoder`, `AbortController`, and `crypto.subtle`;
- performs effects through the `$` engine interface.

Do not design CTRSCM around Node's:

- `fs`,
- `path`,
- `crypto` module,
- `process`,
- or CommonJS.

Use Mod APIs and web APIs.

## 4.3 `session.compact` is the key hook

Current official declarations expose:

```ts
on('session.compact', async ($, event, next) => {
  ...
})
```

The event includes:

```text
trigger:
  manual
  auto
  plugin
  precompute

agentId?:
  identifies a subagent/fork transcript

instructions?:
  focus text after /compact or plugin-provided instructions

messages:
  the exact transcript being compacted
```

A hook can either:

- call `next(event)` and let the next hook/core perform normal compaction;
- return `{ skip: "reason" }`;
- or return `{ messages: [...] }` and supply the replacement transcript itself.

The official type documentation explicitly states:

> There is no summary string; the summary is a message.

More importantly for CTRSCM, **there does not have to be a summary at all**. A Mod can return an edited transcript.

This is the central enabling mechanism for the project.

## 4.4 Message handles are critical

Each `SessionMessage` handed to `session.compact` carries an opaque `handle`.

The official API documents this behavior:

- If a returned message still has the engine's handle, it stands for the engine's original whole message.
- A returned message without a handle is rebuilt from `role`, `text`, and tool blocks.

Therefore the safe rewrite pattern is:

### Unchanged message

Return the original `SessionMessage` object unchanged.

This preserves its handle and tells Claude Code to reuse the original engine-owned message.

### Changed message

Construct a **new** `SessionMessage` without `handle`.

Copy:

- `role`,
- exact `text`,
- original `toolUses`,
- `toolResults` with only selected result objects replaced.

This pattern is independently demonstrated by the community `fast-jev-compaction` Claude Mod.

## 4.5 Claude's tool-result shape

Current `ToolResultSummary` exposes:

```ts
{
  tool_use_id: string
  text: string
  isError: boolean
  result?: unknown
}
```

The API says:

- `text` is what the model read;
- `result` is the structured record stored for the call;
- in headless mode the stored structured result may already omit bulk even though `text` still contains what the model saw.

For CTRSCM, **`text` is the authoritative payload to preserve for model-visible recovery.**

When a result is shaken:

```ts
{
  tool_use_id: original.tool_use_id,
  text: placeholder,
  isError: original.isError
  // intentionally no original bulk result
}
```

Do not blindly copy the original `result` field into the shaken transcript, because that can defeat the purpose of removing bulk or allow host reconstruction to retain unnecessary data.

The existing `fast-jev-compaction` Mod similarly rebuilds changed `ToolResultSummary` values without copying `result`.

This behavior must be tested against the locally generated Claude Code API before release.

## 4.6 Custom recovery tool

Current Mod APIs allow:

```ts
await $.tool.register({
  name: 'recover',
  description: '...',
  inputSchema: { ... }
})
```

A short tool name is exposed to the model as:

```text
mcp__<plugin>__<name>
```

For plugin name `ctrscm` and tool name `recover`, the model-facing name is expected to be:

```text
mcp__ctrscm__recover
```

Register it at `session.start`, then serve it in a `tool.call` hook without forwarding the call to another provider.

CTRSCM should use this mechanism instead of pretending Claude Code understands OMP's `artifact://` scheme.

## 4.7 Filesystem limits materially change the artifact design

Claude Mod `$.fs` currently:

- treats relative paths as relative to the session working directory;
- accepts absolute paths;
- creates directories as needed on write;
- rejects individual reads or writes over **4 MiB**.

`$.store` is also limited to approximately 4 MiB of JSON across the plugin store and is shared/persistent plugin state.

Therefore:

- `$.store` is suitable for small metadata, not Shake bodies.
- A single OMP-style aggregate artifact can exceed the Mod filesystem call limit.
- CTRSCM should use **chunked file-backed artifacts**.

---

# 5. Existing Claude Mod proof-of-concept: `fast-jev-compaction`

A community project already demonstrates that the core replacement architecture works.

`fast-jev-compaction`:

1. hooks `session.compact`;
2. analyzes `event.messages`;
3. builds a reduced transcript;
4. returns `{ messages }` when reduction is sufficient;
5. calls `next(event)` when it wants Claude's built-in summary fallback;
6. preserves handles for unchanged messages;
7. rebuilds changed messages without handles;
8. optionally triggers `$.session.compact()` from `turn.complete` when a context percentage threshold is crossed.

CTRSCM should reuse the **integration pattern**, not its semantic algorithm.

Key difference:

- `fast-jev-compaction` uses an external relevance model/classifier.
- CTRSCM should be fully local and deterministic.
- CTRSCM should externalize exact tool-result text rather than make semantic keep/drop judgments.

This repository is valuable as a Claude-Mod implementation reference for message mapping and compaction interception.

---

# 6. CTRSCM v1 scope

## 6.1 In scope

- Claude Code Mod/plugin packaging.
- `session.compact` interception.
- Mechanical selection of old/heavy tool-result text.
- Protected recent context tail.
- Protected tool names.
- Protected CTRSCM recovery results.
- Artifact persistence before transcript replacement.
- Chunked artifact storage.
- Explicit recovery tool.
- Preservation of all conversation text.
- Preservation of all tool calls.
- Preservation of tool-call/result IDs.
- Built-in compaction fallback when Shake cannot safely make enough progress, configurable.
- Manual, automatic, and plugin-triggered compaction support.
- Main-session and subagent/fork transcript support.
- Detailed automated tests.

## 6.2 Out of scope for v1

- LLM-generated summaries.
- Semantic relevance scoring.
- Embeddings.
- Remote services.
- Rewriting normal user/assistant prose.
- OMP-style fenced/XML block elision.
- Image/media manipulation.
- Replacing Claude Code's underlying transcript database/file format directly.
- Provider-specific cache manipulation.
- Background indexing.
- A general artifact browser.
- Cross-session semantic search.

---

# 7. Recommended architecture

```text
session.compact event
        │
        ▼
┌───────────────────────┐
│ Compaction coordinator│
└──────────┬────────────┘
           │
           ├── resolve configuration
           ├── handle trigger semantics
           ├── correlate tool calls/results
           ▼
┌───────────────────────┐
│ Shake detector        │
│ pure / no I/O         │
└──────────┬────────────┘
           │ regions
           ▼
┌───────────────────────┐
│ Artifact transaction  │
│ chunk + persist       │
└──────────┬────────────┘
           │ committed artifact IDs
           ▼
┌───────────────────────┐
│ Transcript rewriter   │
│ pure                  │
└──────────┬────────────┘
           │ new SessionMessage[]
           ▼
      return {messages}

session.start
        │
        └── register mcp__ctrscm__recover

tool.call(mcp__ctrscm__recover)
        │
        ▼
┌───────────────────────┐
│ Recovery service      │
│ validate ID/scope     │
│ read artifact pages   │
└───────────────────────┘
```

Keep detection and rewriting pure. Keep all I/O in the artifact layer.

That separation mirrors OMP's own division between its pure `shake.ts` and session-maintenance orchestration.

---

# 8. Data model

## 8.1 Candidate result

Suggested internal representation:

```ts
type ShakeCandidate = {
  messageIndex: number
  resultIndex: number
  toolUseId: string
  toolName: string
  originalText: string
  isError: boolean
  estimatedTokens: number
}
```

The tool name must be resolved by correlating `tool_use_id` against assistant `toolUses`.

Do not trust model-controlled text as a filesystem path.

## 8.2 Artifact identity

Use an opaque generated ID.

Preferred options:

- `crypto.randomUUID()` if present in the locally generated Mod runtime declarations;
- otherwise random bytes from web crypto encoded into a safe identifier.

Allowed artifact ID alphabet should be tightly validated, e.g.:

```text
[A-Za-z0-9_-]+
```

Never accept path separators from the model.

## 8.3 Artifact manifest

Suggested manifest:

```json
{
  "version": 1,
  "artifactId": "...",
  "sessionId": "...",
  "agentId": null,
  "toolUseId": "...",
  "toolName": "Bash",
  "isError": false,
  "createdAt": "2026-10-05T...",
  "originalChars": 123456,
  "estimatedTokens": 30000,
  "chunkCount": 2,
  "encoding": "utf-8"
}
```

The original text lives in chunk files, not the manifest.

The manifest should be written **last** and treated as the commit marker.

## 8.4 Suggested file layout

Conceptually:

```text
<artifact-root>/
└── <session-id>/
    └── <agent-scope>/
        └── <artifact-id>/
            ├── chunk-0000.txt
            ├── chunk-0001.txt
            └── manifest.json
```

`agent-scope` should distinguish the main conversation from subagents/forks.

Because Mod code has no Node `path` module, implement a minimal, tested path-construction helper or use a deliberately constrained path scheme supported on both POSIX and Windows.

### Artifact root

Recommended resolution order:

1. explicit `artifactDir` plugin option, if configured;
2. a home-directory location derived from `HOME` / `USERPROFILE`;
3. only as a fallback, a session-working-directory-local CTRSCM directory.

Do not assume `~` expansion.

The coding agent MUST test path behavior on Windows and POSIX.

---

# 9. Artifact chunking and recovery

## 9.1 Why chunking is required

The current Mod API rejects a single `$.fs.read` or `$.fs.write` over 4 MiB.

Therefore an individual tool result can itself exceed the API limit.

CTRSCM must either refuse to Shake such results or chunk them.

**Preferred design: chunk them.**

## 9.2 Storage chunks

Use a conservative per-file UTF-8 byte limit substantially below 4 MiB.

Do not chunk by JavaScript code-unit count alone: non-ASCII text can consume multiple UTF-8 bytes.

Use `TextEncoder` or equivalent web APIs available in the Mod runtime to measure encoded size and avoid splitting surrogate pairs/code points incorrectly.

The exact storage chunk size is an implementation parameter, not a product contract.

## 9.3 Recovery pagination

Do not automatically inject an entire multi-megabyte artifact back into context.

The recovery tool should support bounded paging, for example:

```json
{
  "id": "<artifact-id>",
  "offset": 0,
  "maxChars": 20000
}
```

and return:

```text
CTRSCM artifact <id>
tool: Bash
range: 0..19999 of 143208 chars
more: true

<original text slice>
```

The exact default page size should be configurable or chosen conservatively after testing.

The important properties are:

- exact original text is recoverable;
- a model can request later pages;
- one recovery call does not recreate the whole context blow-up.

## 9.4 Recovery security

The recovery tool MUST:

- validate artifact ID format;
- derive the path internally;
- never accept arbitrary file paths;
- bind recovery to the current session/artifact namespace by default;
- avoid path traversal;
- avoid exposing unrelated project/user files;
- avoid network access;
- not log artifact body content.

Consider whether cross-agent recovery inside the same Claude session should be permitted. Defaulting to same session + same agent scope is the safer v1 behavior unless usability testing requires broader session scope.

---

# 10. Placeholder contract

Suggested form:

```text
[CTRSCM shaken tool result: ~12345 estimated tokens externalized; recover with mcp__ctrscm__recover id="abc123"]
```

Or, if token estimation is too approximate:

```text
[CTRSCM shaken tool result: 48123 chars externalized; recover with mcp__ctrscm__recover id="abc123"]
```

Requirements:

- clearly state that this is CTRSCM-created;
- identify that it was a tool result;
- give a stable artifact ID;
- name the recovery tool;
- remain short;
- never contain arbitrary original tool output;
- never claim recoverability before artifact commit.

CTRSCM should recognize its own placeholder format so repeated compactions are idempotent and do not recursively externalize a placeholder.

---

# 11. Selection algorithm

## 11.1 Correlate calls and results

Build:

```text
tool_use_id → ToolUseSummary
```

from assistant messages.

For each user `toolResults[]`, use its `tool_use_id` to determine:

- tool name;
- input if needed for protection rules;
- whether it is CTRSCM's own recovery tool.

## 11.2 Protect recent context

OMP protects the newest 16k context tokens in automatic Shake.

Claude Mods expose total/session context usage, but the researched API does not expose an OMP-equivalent exact per-message tokenizer interface.

Therefore CTRSCM should introduce a clean abstraction:

```ts
interface TokenEstimator {
  estimateText(text: string): number
  estimateMessage(message: SessionMessage): number
}
```

Implementation priorities:

1. Before coding, inspect the locally generated `/plugin-types` output for any newer exact token-count API.
2. If an exact supported API exists, use it.
3. Otherwise use a deterministic, clearly named **approximate** estimator.
4. Keep the estimator isolated so it can be replaced later.

Do not present approximate counts as provider-exact counts.

The protection calculation should walk messages newest-to-oldest and preserve a configured recent tail approximately equivalent to OMP's recent-context protection.

## 11.3 Default protected classes

Recommended v1 protections:

### MUST protect

- results from `mcp__ctrscm__recover`;
- already-shaken CTRSCM placeholders;
- results in the recent protected tail.

### SHOULD protect by default

- errored tool results;
- Claude's `Skill` tool output;
- any tool names explicitly configured by the user.

Protecting errors is a CTRSCM recommendation rather than an OMP requirement. Errors often contain active diagnostic state and are less safe to remove blindly.

## 11.4 Candidate eligibility

A tool result is eligible when all are true:

```text
has non-empty model-visible text
AND outside protected recent tail
AND not protected tool
AND not an error (default policy)
AND not already a CTRSCM placeholder
AND projected savings are positive
```

Optionally require a minimum per-result size so tiny outputs are not replaced by an equally large placeholder.

## 11.5 Savings gate

OMP's automatic Shake uses a 4,000-token minimum total estimated savings.

CTRSCM should implement:

```text
estimatedSavings =
  Σ(originalEstimatedTokens - placeholderEstimatedTokens)
```

and only commit a Shake transcript when total savings meets the configured threshold.

If exact tokens are unavailable, the variable and UI must explicitly say `estimated`.

## 11.6 Make real headroom, not repeated no-op compactions

OMP's maintenance layer checks whether Shake creates enough headroom and falls through to another compaction method if not.

CTRSCM should adopt the same principle.

At minimum:

- if there are no candidates → fallback;
- if savings is below threshold → fallback;
- if artifact commit fails → fallback.

A later refinement can compare current `$.session.usage()` against expected post-Shake usage and require a target recovery margin.

Avoid a loop in which Claude auto-compacts, CTRSCM frees too little, and the next turn immediately triggers compaction again.

---

# 12. Transcript rewrite algorithm

For each message:

## Unchanged

Return the exact original `SessionMessage` object.

## Changed user message

Create a fresh message without `handle`:

```ts
{
  role: original.role,
  text: original.text,
  toolUses: original.toolUses,
  toolResults: [...]
}
```

For each unmodified tool result:

- preserve the original object if possible.

For each shaken tool result:

```ts
{
  tool_use_id: original.tool_use_id,
  text: placeholder,
  isError: original.isError
}
```

Deliberately do not carry the old bulk `result` unless local API testing proves a lightweight structured field is required.

## Assistant messages

CTRSCM v1 should never alter assistant messages.

That keeps:

- tool calls;
- tool inputs;
- assistant text;
- engine handles

untouched.

## User prose

A user message containing both normal text and tool results must preserve its `text` exactly while selectively replacing only entries inside `toolResults`.

---

# 13. `session.compact` trigger semantics

Claude currently distinguishes:

```text
manual
auto
plugin
precompute
```

CTRSCM should handle them deliberately.

## 13.1 `auto`

Primary use case.

Run Shake. If safe and sufficient, return `{ messages }`.

## 13.2 `manual`

A bare `/compact` can run Shake.

### Manual compaction with focus instructions

`/compact <instructions>` semantically asks a summarizer to emphasize specific information.

A mechanical Shake cannot honestly honor such instructions.

Recommended v1 behavior:

- if `event.instructions` is non-empty, call `next(event)` and let Claude perform directed built-in compaction;
- log that CTRSCM intentionally yielded because focused compaction was requested.

Do not silently ignore focus instructions.

If the project later wants a strict "never summarize" mode, make that an explicit option.

## 13.3 `plugin`

Treat like `auto` unless the caller supplies focus instructions.

Avoid recursive calls from CTRSCM itself.

## 13.4 `precompute`

A precompute result is speculative and may never become the active transcript.

Artifact writes are side effects, so eagerly creating recovery files during abandoned precomputations can create orphan artifacts.

Recommended v1 behavior:

```text
return { skip: "CTRSCM performs deterministic compaction only when it is committed" }
```

or otherwise bypass speculative CTRSCM artifact generation.

Verify exact precompute interaction against the locally installed Claude Code build before finalizing this behavior.

A later version can support speculative Shake if it also implements artifact garbage collection and prefix/snapshot identity safely.

---

# 14. Fallback policy

OMP itself uses Shake as one method in a method chain; if Shake cannot make sufficient progress, maintenance can advance to another method.

CTRSCM should therefore support a safety fallback rather than trapping the session near overflow.

Suggested configuration:

```text
fallbackMode:
  builtin   # call next(event)
  skip      # return {skip: ...}
```

Recommended default: `builtin`.

Use fallback when:

- there are no eligible results;
- projected savings are below threshold;
- artifacts cannot be persisted;
- recovery cannot be made trustworthy;
- directed `/compact <instructions>` was requested;
- the Mod hits an unsupported transcript shape;
- another internal correctness check fails.

The fallback must be visible in debug/transcript logging, but should not dump private tool output.

`skip` mode is useful for users who explicitly prefer eventual context exhaustion over any summary-based compaction.

---

# 15. Optional proactive compaction

CTRSCM does **not** need to trigger compaction itself for v1.

Claude Code already invokes `session.compact` for built-in automatic compaction.

Start by intercepting that path only.

A future/configurable feature can mirror `fast-jev-compaction`:

```text
turn.complete
→ $.session.usage()
→ if context percentage >= configured threshold
→ $.session.compact()
```

If implemented:

- guard against concurrent/in-flight compact calls;
- prevent recursion;
- choose a threshold that leaves enough room for artifact work;
- test against Claude's own automatic threshold.

This is optional and should not block the first correct implementation.

---

# 16. Plugin configuration

Use `userConfig` in `.claude-plugin/plugin.json`.

Suggested initial options:

```text
protectApproxTokens       number
minApproxSavings          number
minResultApproxTokens     number
protectErrors             boolean
protectedTools            string[]
artifactDir               string
fallbackMode              "builtin" | "skip"
recoveryPageChars         number
debugLogging              boolean
```

Potential later options:

```text
proactiveCompactPercent
aggressiveManualMode
artifactRetentionDays
allowCrossAgentRecovery
```

Defaults should be conservative.

Where OMP defaults are reused, document that they are inspired by OMP but CTRSCM's token count may be approximate unless a supported exact tokenizer API is available.

---

# 17. Artifact transaction protocol

This should be treated like a miniature transactional subsystem.

For every selected result:

```text
generate artifact ID
→ encode/split original text into storage chunks
→ write all chunk files
→ optionally stat/verify expected chunk files
→ write manifest LAST
→ mark artifact committed
```

Only after **every** artifact required for the compaction is committed:

```text
construct placeholders
→ rebuild changed SessionMessages
→ return {messages}
```

If any write fails:

```text
do not return partially shaken transcript
→ clean up partial files when possible
→ invoke configured fallback
```

A manifest is valid only if:

- schema version supported;
- ID matches request;
- session/agent scope matches;
- chunk count is sane;
- every referenced chunk exists;
- no path escapes the artifact root.

Recovery must reject incomplete artifacts.

---

# 18. Crash and consistency model

Important failure windows:

## Failure before manifest write

Artifact is incomplete. Recovery ignores it.

## Failure after manifest write but before transcript replacement

Artifact becomes an orphan, but no context is lost. This is safe.

## Failure after Claude accepts rewritten messages

Artifact must already exist and be recoverable.

Therefore the correct bias is:

> Orphaned artifact is acceptable; unrecoverable placeholder is not.

Garbage collection can be added later.

---

# 19. Subagents and forks

`session.compact` includes `agentId?`.

The API explicitly warns that `$.session.messages()` is the main conversation regardless of the `agentId` being compacted.

Therefore:

**Always operate on `event.messages`, never fetch the main session transcript as a substitute.**

Artifact namespace should include:

- Claude session ID;
- main-vs-agent scope;
- `agentId` when present.

Tests must cover compaction of a subagent/fork transcript.

---

# 20. Recovery-result protection

This is essential.

If Claude recovers a shaken artifact, that recovery itself appears as a new tool result.

If CTRSCM immediately shakes it again at the next compaction, the model can enter a frustrating recover/re-elide cycle.

OMP explicitly protects artifact-recovery tool results in its normal automatic Shake configuration.

CTRSCM should do the same:

```text
mcp__ctrscm__recover result
→ protected from normal automatic Shake
```

A later aggressive/manual mode may allow old recovery results to become eligible again, analogous to OMP's more aggressive manual configuration.

---

# 21. Logging and observability

CTRSCM should log metadata, never body content.

Useful message:

```text
CTRSCM: shook 12 tool results; ~31,400 estimated tokens externalized; 12 artifacts committed.
```

Fallback example:

```text
CTRSCM: built-in compaction fallback; projected Shake savings ~1,100 < minimum 4,000.
```

Artifact failure:

```text
CTRSCM: built-in compaction fallback; recovery artifacts could not be committed.
```

Do not log:

- full commands;
- file contents;
- Bash stdout;
- credentials;
- recovered body content.

Debug logging can include IDs, counts, tool names, sizes, and reasons.

---

# 22. Security requirements

Tool output may contain secrets.

CTRSCM artifact storage therefore deserves the same trust level as Claude's local session data.

Requirements:

- local only;
- no network transport;
- no arbitrary file-read recovery interface;
- opaque IDs, not paths;
- strict path containment;
- validate manifests;
- no body logging;
- never interpolate artifact contents into shell commands;
- do not permit model-supplied artifact directory/path;
- document where artifacts live;
- support eventual user-controlled cleanup.

If current Mod APIs expose filesystem permissions controls, investigate them. Do not assume POSIX chmod is available because the Mod environment has no Node APIs.

---

# 23. Implementation phases

## Phase 0 — API grounding

Before writing production code:

1. Run `/plugin-types` using the developer's installed Claude Code.
2. Record the generated Claude Code version.
3. Confirm:
   - `session.compact`;
   - `SessionMessage.handle`;
   - `ToolResultSummary`;
   - `$.tool.register`;
   - `tool.call`;
   - `$.fs.read/write/stat/exists`;
   - `$.session.id`;
   - `$.session.usage`;
   - `$.env.get`;
   - hook execution limits.
4. Run `claude plugin validate` on a minimal skeleton.
5. Create one test proving that returning `{messages}` from `session.compact` installs the supplied transcript.

Do not proceed based solely on the declarations quoted in this research file; Mods are early access.

## Phase 1 — Pure Shake engine

Implement without filesystem I/O:

- tool-use/result correlation;
- protected-tail calculation;
- protection matchers;
- candidate collection;
- savings gate;
- placeholder planning;
- transcript rewriting;
- idempotence detection.

Unit-test this layer heavily.

## Phase 2 — Artifact subsystem

Implement:

- root resolution;
- session/agent namespace;
- safe IDs;
- UTF-8 chunking;
- manifests;
- transaction/commit marker;
- validation;
- paged recovery.

## Phase 3 — Mod hooks

Implement:

- `session.start` recovery-tool registration;
- `tool.call` recovery handler;
- `session.compact` coordinator;
- fallback semantics;
- observability.

## Phase 4 — Integration tests

Use `claude plugin test`.

Then run real Claude Code sessions using `--plugin-dir`.

## Phase 5 — Long-session soak tests

Create artificial sessions with:

- many Bash outputs;
- repeated file reads;
- parallel tool calls;
- mixed tiny/huge results;
- recovered artifacts;
- subagents;
- multiple compactions.

Measure:

- whether summary compaction stays avoided when Shake has sufficient removable bulk;
- context percentage before/after;
- artifact fidelity;
- recovery success;
- repeated-compaction behavior;
- prompt-cache/session behavior observable from Claude Code.

---

# 24. Mandatory test matrix

The coding agent should treat these as acceptance tests, not suggestions.

## Transcript correctness

1. All ordinary user text remains identical.
2. All assistant text remains identical.
3. All assistant tool calls remain present.
4. Tool-call ordering remains unchanged.
5. Every result retains its original `tool_use_id`.
6. Only selected result `text` changes.
7. Unchanged messages retain their original engine objects/handles.
8. Changed messages are rebuilt without handles.
9. Multiple tool results inside one user message are handled independently.
10. A user message containing both prose and tool results keeps its prose exactly.

## Selection

11. Recent results are protected.
12. Protected tools are untouched.
13. Recovery-tool results are untouched during normal automatic Shake.
14. Error results are protected when `protectErrors=true`.
15. Tiny results are skipped.
16. Already-shaken placeholders are skipped.
17. Total savings below threshold produces no Shake commit.
18. Re-running compaction on an already-shaken transcript is idempotent.

## Artifact correctness

19. Artifact body reconstructs the exact original `ToolResultSummary.text`.
20. UTF-8/multibyte text round-trips exactly.
21. Results larger than 4 MiB round-trip through multiple storage chunks.
22. Manifest is written only after chunks.
23. Missing chunk makes recovery fail closed.
24. Malformed manifest fails closed.
25. Path-traversal IDs are rejected.
26. Artifact-write failure never returns a recovery placeholder.
27. Partial artifact failure triggers fallback with original transcript unchanged.

## Recovery

28. Recovery tool returns requested text page exactly.
29. Pagination covers entire artifact with no gap/overlap.
30. Invalid ID cannot read arbitrary files.
31. Wrong session/agent scope is rejected according to policy.
32. Recovery tool result is recognized as protected on next Shake.

## Trigger behavior

33. `auto` uses Shake.
34. bare `manual` uses Shake.
35. `manual` with focus instructions follows chosen directed-compaction fallback policy.
36. `plugin` works without recursion.
37. `precompute` follows the explicitly chosen side-effect policy.
38. A subagent/fork uses `event.messages`, not the main transcript.
39. Concurrent compaction attempts do not corrupt artifacts.

## Fallback

40. No candidates → configured fallback.
41. Insufficient savings → configured fallback.
42. Artifact failure → configured fallback.
43. Unsupported API shape → configured fallback.
44. `fallbackMode=skip` never accidentally calls built-in summary.
45. `fallbackMode=builtin` calls `next(event)` exactly once.

---

# 25. Acceptance criteria for v1

CTRSCM v1 is successful when all of the following are true:

1. It loads as a valid Claude Code Mod.
2. It intercepts `session.compact`.
3. A compaction with sufficient old tool-output bulk returns an edited transcript without an LLM summary.
4. Conversational user/assistant text remains unchanged.
5. Tool calls remain unchanged.
6. Eligible old tool-result text is replaced by compact references.
7. Original tool-result text is recoverable exactly through `mcp__ctrscm__recover`.
8. Artifacts are committed before transcript references are returned.
9. Large results beyond the Mod's single-file-call limit remain recoverable through chunking.
10. Recent working results are protected.
11. Recovery results are protected.
12. Failed artifact persistence cannot produce a false recovery reference.
13. Insufficient Shake progress falls back according to configured policy.
14. Repeated compactions do not corrupt or repeatedly wrap already-shaken data.
15. Main and subagent transcripts behave correctly.
16. `claude plugin validate` passes.
17. `claude plugin test` passes.
18. A long real coding session can cross Claude's normal compaction point while retaining verbatim conversational history and successfully continuing from shaken tool results.

---

# 26. Questions the coding agent must resolve from the locally installed Claude build

Do not guess these. Check `/plugin-types`, validate, and test.

1. Is there now a supported exact message/text token-count API available to Mods?
2. What is the currently installed Claude Code version and exact `session.compact` contract?
3. Are hook execution time limits still compatible with writing many chunk files in one compaction?
4. Does `crypto.randomUUID()` exist in the current Mod runtime, or only `crypto.subtle`/other web crypto?
5. What path separator behavior is officially supported for absolute Windows paths in `$.fs`?
6. Does the current runtime expose a file delete/remove primitive useful for cleanup?
7. Does omitting `ToolResultSummary.result` from a rebuilt tool result behave exactly as expected in:
   - interactive mode;
   - headless mode;
   - session resume;
   - transcript rendering?
8. What observable behavior occurs when a `session.compact` hook returns a rewritten tool-result transcript while provider prompt caching is active?
9. Does returning `{skip}` for `precompute` have any unwanted effect on later real auto-compaction?
10. Can/should CTRSCM register a `/shake` or `/ctrscm-shake` command later, or is interception of `/compact` sufficient?

Record answers in the repository before locking the architecture.

---

# 27. Strong implementation guidance

## Do

- Reimplement the behavior cleanly for Claude's Mod abstractions.
- Keep the Shake detector pure.
- Treat artifact persistence transactionally.
- Preserve original engine messages whenever they are unchanged.
- Rebuild only the minimum changed messages.
- Keep recovery explicit.
- Fail safe.
- Test exact round-trip fidelity.
- Use local generated types as authority.

## Do not

- Copy OMP's session internals mechanically.
- Modify Claude Code's transcript files behind its back.
- Assume Node APIs.
- Assume OMP's `artifact://` resolver exists in Claude.
- Store large bodies in `$.store`.
- Put all Shake results into one unbounded artifact file.
- Remove tool calls.
- summarize user/assistant conversation.
- silently ignore `/compact` focus instructions.
- claim a result is recoverable before it is committed.
- repeatedly Shake CTRSCM's own placeholders.
- allow arbitrary paths through the recovery tool.

---

# 28. Recommended first implementation decision

The coding agent should start from this minimal behavioral contract:

```text
On session.compact:

  if trigger == precompute:
      follow the chosen no-side-effect precompute policy

  if focused/manual instructions exist:
      fallback according to directed-compaction policy

  candidates = collect old eligible tool results outside protected recent tail

  if estimated savings < minimum:
      fallback

  persist exact result texts as recoverable chunked artifacts

  if any artifact commit fails:
      fallback with transcript untouched

  rewritten = event.messages where:
      - all assistant messages are unchanged
      - all normal text is unchanged
      - only candidate toolResults receive CTRSCM placeholders
      - changed messages are fresh objects without handles
      - unchanged messages retain original handles

  return { messages: rewritten }
```

And:

```text
On session.start:
  register tool "recover"

On tool.call for mcp__ctrscm__recover:
  validate opaque artifact ID
  verify session/agent scope
  read requested bounded page
  return exact stored text page
```

That is the smallest architecture that captures the useful part of OMP Shake without importing unrelated OMP complexity.

---

# 29. Research conclusions

The key technical conclusion is that CTRSCM appears architecturally feasible using Claude Code's current Mod API.

The necessary primitive is already exposed: `session.compact` lets a function hook replace the transcript directly with a supplied `SessionMessage[]`. A community Mod already uses this to bypass summary compaction.

OMP contributes the mature algorithmic lessons:

- mechanical rather than semantic compaction;
- preserve tool calls;
- protect recent working context;
- protect recovery reads;
- require meaningful savings;
- externalize before rewrite;
- keep removed evidence recoverable;
- fall through when Shake cannot make sufficient progress.

Claude Mods contribute a cleaner integration boundary than OMP's internal session mutation, but also impose constraints OMP does not have, especially:

- early-access API instability;
- no Node runtime;
- 4 MiB per `$.fs` read/write;
- opaque message-handle semantics.

CTRSCM should therefore be an **OMP-inspired behavior port, not a line-for-line port**.

The most important correctness invariant for the entire project is:

> **A tool result may leave live context only after CTRSCM has made its exact model-visible text durably and safely recoverable.**

---

# 30. Sources

Sources below were inspected on 2026-10-05.

## Primary: OMP

1. **OMP compaction documentation**  
   `can1357/oh-my-pi` — `docs/compaction.md`  
   https://github.com/can1357/oh-my-pi/blob/main/docs/compaction.md

2. **OMP Shake core implementation**  
   `can1357/oh-my-pi` — `packages/agent/src/compaction/shake.ts`  
   https://github.com/can1357/oh-my-pi/blob/main/packages/agent/src/compaction/shake.ts

3. **OMP session-maintenance / Shake orchestration**  
   `can1357/oh-my-pi` — `packages/coding-agent/src/session/session-maintenance.ts`  
   https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/session/session-maintenance.ts

4. **OMP artifact implementation**  
   `can1357/oh-my-pi` — `packages/coding-agent/src/session/artifacts.ts`  
   https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/session/artifacts.ts

5. **OMP agent changelog**  
   Includes Shake history, removal of `summarizeShakeRegions`, recent-tail fixes, and mixed-result/image fixes.  
   `can1357/oh-my-pi` — `packages/agent/CHANGELOG.md`  
   https://github.com/can1357/oh-my-pi/blob/main/packages/agent/CHANGELOG.md

6. **OMP issue #12466 — unresolvable Shake recovery link in non-persisted sessions**  
   https://github.com/can1357/oh-my-pi/issues/12466

## Primary: Claude Code Mods

7. **Official Claude Code Mods README**  
   `anthropics/claude-code` — `mods/README.md`  
   https://github.com/anthropics/claude-code/blob/main/mods/README.md

8. **Official Mod API TypeScript declarations**  
   `anthropics/claude-code` — `mods/types/claude-code.d.ts`  
   https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts

9. **Official `agents-md` Mod manifest — `userConfig` example**  
   `anthropics/claude-code` — `mods/agents-md/.claude-plugin/plugin.json`  
   https://github.com/anthropics/claude-code/blob/main/mods/agents-md/.claude-plugin/plugin.json

## Secondary implementation reference

10. **fast-jev-compaction**  
    Community Claude Mod demonstrating direct `session.compact` transcript replacement, handle-preserving message mapping, fallback via `next(event)`, and optional proactive `$.session.compact()`.  
    https://github.com/tamaratran/fast-jev-compaction

11. **fast-jev session hook implementation**  
    https://github.com/tamaratran/fast-jev-compaction/blob/main/hooks/fast-jev.ts

---

# 31. Final instruction to the coding agent

Treat this file as an **intent and architecture constraint document**, not as permission to blindly implement every proposed detail.

Before coding:

1. inspect the repository state;
2. regenerate Claude Mod types locally;
3. verify the API questions in Section 26;
4. compare findings against this intent;
5. call out any contradiction;
6. preserve the core invariants even if API details require a different mechanism.

Priority order:

```text
correctness
> recoverability
> preservation of conversation/tool-call structure
> safe fallback
> context savings
> implementation simplicity
> optional features
```

Do not optimize away the transactional artifact guarantee.
