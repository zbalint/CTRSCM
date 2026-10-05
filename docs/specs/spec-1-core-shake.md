# Spec 1: core Shake compaction, artifact store and recovery tool

## 0. Status

> Amended by spec 3 (`docs/specs/spec-3-recovery-steering.md`): the recovery tool description, `DEFAULT_PAGE_CHARS` (now 8000),
> `MAX_PAGE_CHARS` (now 20000) and the `invalid maxChars` deny text (now `invalid maxChars (1 to 20000)`). Sections 3 and 7 below keep
> the original values as the historical record. Spec 4 (`docs/specs/spec-4-placeholder-label.md`) adds an optional tool-call label to the placeholder
> (section 3 keeps the unlabeled text, which `placeholderOf` still produces without a label).

**LOCKED** (2026-10-05, pre-lock gate run; notes in section 12). The owner delegated every design choice to the
architect; decisions are D1 to D9 in section 2. Consultant review: a2amx `m_482` (context `ctrscm-core-shake`), all
findings dispositioned in section 12.

**Scope.** May create or edit exactly these files and no others:

- `.claude-plugin/plugin.json`, `hooks/hooks.json`
- `package.json`, `package-lock.json`, `tsconfig.json` (the typecheck gate, section 13)
- `hooks/register.ts`, `hooks/config.ts`, `hooks/shake.ts`, `hooks/artifacts.ts`, `hooks/recover.ts`
- `tests/register.test.ts`, `tests/config.test.ts`, `tests/shake.test.ts`, `tests/artifacts.test.ts`,
  `tests/recover.test.ts`, and `tests/fixtures/*.ts` (one export per file)
- `README.md` (the `## Status` and `## Trying it` sections only), `docs/backlog.md` (add rows for new
  findings only)

Does not touch: `AGENTS.md`, `docs/intent.md`, `docs/architecture.md`, `docs/specs/*`, `.gitignore`,
`LICENSE`, `.gitattributes`, `a2amx.toml`, anything outside the repository. No
build step and no dependency other than the one dev dependency `typescript` (section 13). `node_modules/` and
`types/` are gitignored and are not deliverables. Do not commit, stage or merge:
leave the diff uncommitted in the working tree.

**Location and branch:** main checkout `/home/zbalint/workspace/CTRSCM`, branch `develop`.
**Shared task `context_id`:** `ctrscm-core-shake`. **Governing documents:** this spec;
`docs/architecture.md` (verified API facts); `AGENTS.md` (conventions). `docs/intent.md` is unverified
background and loses to all three. **Reference declarations:** `mods/types/claude-code.d.ts` in a local
clone of `anthropics/claude-code` (the architect's clone is `~/workspace/throwaway/claude-code`; the engine
writes the same file with `/plugin-types`). Reference mod layout: `mods/agents-md` in that clone.

**Public test seams:** the pure functions exported by `hooks/config.ts`, `hooks/shake.ts` and
`hooks/artifacts.ts`; `recoverResult` in `hooks/recover.ts`; and the registered hooks driven through `$`
(`$.session.start`, `$.session.compact`, `$.tool.call`) in `tests/register.test.ts`.

**Baseline:** develop at the commit that adds this spec (the working tree is clean at assignment; `AGENTS.md`,
`README.md`, `docs/` and `.gitignore` are already committed). Checks run by the architect at lock time against the
shipped reference mod, because this repository has no plugin yet: `claude plugin test mods/agents-md` in the clone passes (5 tests) and
`claude plugin validate mods/agents-md` reports "Validation passed". A throwaway probe confirmed the
`session.compact` test dispatch described in section 9. In this repository `claude plugin validate .`
fails today only because the manifest does not exist; that is the deliverable.

## 1. Why

Claude Code's built-in compaction summarizes the transcript and the model loses everything before it,
including exact tool output and, in practice, exact instructions. Most of a long session's context is old
tool output, which a mechanical pass can remove without touching the conversation. OMP's Shake does this and,
per the owner, its sessions run for hours without provider-side compaction. This spec builds the same idea as
a Claude Code Mod: on `session.compact`, externalize eligible old tool-result text to local artifacts, replace
each with a short placeholder naming a recovery tool, keep all conversation text and tool calls verbatim, and
fall back to the built-in summarizer whenever Shake cannot safely make enough progress. Prior attempts: none in
this repository; `docs/intent.md` (ChatGPT, unverified) is the source of the shape, narrowed here to what the
declarations and a probe support.

## 2. Decisions

- **D1.** The repository root is the plugin; the plugin name is `ctrscm`, so the recovery tool is
  `mcp__ctrscm__recover`. TypeScript, no build step, hooks module `./register.ts`.
- **D2.** Only `session.compact` is hooked for compaction. Trigger `precompute` answers `{ skip: "ctrscm: nothing
  to precompute" }` (the declarations say a skipped precompute computes and keeps nothing). Triggers `manual`,
  `auto` and `plugin` run Shake. A `manual` compaction whose `instructions` contain a non-whitespace character
  always goes to the built-in summarizer (`next(e)`): the person asked for a summary.
- **D3.** Only user-message `toolResults` text is externalized. Assistant messages are never rebuilt; they are
  returned as the engine's own objects. A user message with no eligible result is returned as the engine's own
  object. A user message with at least one eligible result is rebuilt without `handle`; see section 5.
- **D4.** Token counts are estimates: `estimateTokens(text) = Math.ceil(text.length / 4)`. Every number shown to a
  person or written to a manifest says estimated.
- **D5.** Section 3 is authoritative for defaults, the placeholder, the manifest and the page and error texts; a restatement elsewhere must match it exactly.
- **D6.** Any failure after Shake is chosen (no artifact root, a failed write, a failed tool registration) takes the
  configured fallback and returns nothing partial. There is no cleanup (no delete primitive); a chunk file
  without a manifest is inert.
- **D7.** v1 targets Linux and WSL. Paths are joined with `/`. The artifact root never falls back to the project
  directory.
- **D8.** `session.start` registers the recovery tool before `next(e)` (the shipped `diff` mod registers its
  command the same way, `mods/diff/hooks/register.ts` line 657 on).
- **D9.** Options are all strings in `plugin.json` `userConfig` (the shipped mod uses only strings), parsed in
  `hooks/config.ts`.

## 3. Contracts (single source)

**Defaults** (`hooks/config.ts`, exported as `DEFAULT_CONFIG`): `protectTokens` 16000, `minSavings` 4000,
`minResultTokens` 200, `protectedTools` `["Skill"]`, `artifactDir` undefined, `fallback` `"builtin"`.

**Constants** (`hooks/shake.ts`): `RECOVER_TOOL = "mcp__ctrscm__recover"`; `PLACEHOLDER_PREFIX =
"[CTRSCM shaken tool result:"`; `PLACEHOLDER_TOKEN_ESTIMATE = 40`.

**Placeholder** (`placeholderOf(id, chars, tokens)`), exactly:

```text
[CTRSCM shaken tool result: ~{tokens} estimated tokens ({chars} chars) externalized; recover with mcp__ctrscm__recover id="{id}"]
```

`{tokens}` is `estimateTokens` of the original text, `{chars}` its `length`, `{id}` the artifact id.

**Artifact** (`hooks/artifacts.ts`): `CHUNK_CHARS = 262144`. Directory `{root}/{id}`; chunk files
`chunk-0000.txt`, `chunk-0001.txt`, …; manifest `manifest.json`. `id` is `crypto.randomUUID()` (lower-case
hex with dashes, validated by `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`). `root` has
trailing `/` characters removed before joining. Manifest JSON, written with `JSON.stringify(manifest)`:

```json
{ "version": 1, "id": "…", "agentId": null, "toolUseId": "…", "toolName": "Bash",
  "createdAt": "2026-10-05T00:00:00.000Z", "totalChars": 123456, "chunkChars": [123456] }
```

`toolName` is `null` when unknown; `agentId` is `null` for the main conversation; `chunkChars` lists each
chunk's length in UTF-16 code units, in order; `totalChars` is their sum. `createdAt` is
`new Date(await $.clock.now()).toISOString()`.

**Recovery tool** (`hooks/recover.ts`): registered name `recover`; inputs `id` (string, required), `offset`
(number), `maxChars` (number). Validation is exact and numbers only (a string such as `"20000"` is invalid):
`id` must be a string passing `isArtifactId`; `offset` is absent (then 0) or an integer at least 0; `maxChars` is
absent (then 20000) or an integer from 1 to 100000 (larger is invalid, not clamped). Success text, exactly:

```text
CTRSCM artifact {id}
tool: {toolName or "unknown"}
range: {start}..{end-1} of {totalChars} chars
more: {true|false}

{text slice}
```

`start = offset`, `end = min(offset + maxChars, totalChars)`, `more` is `end < totalChars`. A success is answered
`{ result: text }`. An error is answered `{ deny: message }` (the documented way for a hook to refuse a call; the
model receives the text as an error result) with these messages: `invalid artifact id`, `invalid offset`,
`invalid maxChars`, `artifact not found or incomplete`, `offset {offset} is past the end ({totalChars} chars)`.

## 4. `hooks/config.ts`

`export type Config = { protectTokens: number; minSavings: number; minResultTokens: number; protectedTools:
readonly string[]; artifactDir: string | undefined; fallback: "builtin" | "skip" }`.

`export function parseConfig(options: PluginOptions): { config: Config; problems: string[] }`.

- Numeric options (`protectTokens`, `minSavings`, `minResultTokens`) accept a number or a string. A string is trimmed, must be non-empty, and `Number(string)` is used. Valid:
  a safe integer, at least 0 (`minResultTokens` at least 1). Anything else keeps the default and adds one
  problem string `option {name}: {reason}; using the default`.
- `protectedTools` accepts a string (comma-separated; each entry trimmed; empty entries dropped) or an array of
  strings. A missing option keeps `["Skill"]`. An empty string gives `[]` (the person wants none).
- `artifactDir` is the trimmed string, or undefined when missing or empty.
- `fallback` is `"builtin"` or `"skip"`; anything else keeps `"builtin"` and adds a problem.
- Never throws.

## 5. `hooks/shake.ts` (pure: no `$`, no I/O)

```ts
export type Selected = { toolUseId: string; toolName: string | undefined; text: string; tokens: number }
export function estimateTokens(text: string): number
export function placeholderOf(id: string, chars: number, tokens: number): string
export function selectResults(
  messages: readonly SessionMessage[],
  settings: Pick<Config, "protectTokens" | "minSavings" | "minResultTokens" | "protectedTools">,
): { selected: Selected[]; savings: number }
export function rebuild(
  messages: readonly SessionMessage[],
  placeholders: ReadonlyMap<string, string>,
): SessionMessage[]
```

`selectResults`:

1. Tool names: map each assistant `toolUses[].tool_use_id` to its `tool`.
2. Message cost = `estimateTokens(text)` + the sum over `toolUses` of `estimateTokens(JSON.stringify(input))` + the
   sum over `toolResults` of `estimateTokens(text)`. The `text` and `result` of an assistant `toolUses` entry are
   a second view of the same bytes and are not counted.
3. `tail[i]` is the sum of costs of messages with index greater than `i`. Results in message `i` are candidates
   only when `tail[i] >= protectTokens`.
4. A candidate result is eligible when all hold: `text.length > 0`; `isError` is false; its tool name is neither
   in `protectedTools` nor equal to `RECOVER_TOOL` (an unknown tool name is not protected); `text` does not start
   with `PLACEHOLDER_PREFIX`; `estimateTokens(text) >= minResultTokens`; and `estimateTokens(text) >
   PLACEHOLDER_TOKEN_ESTIMATE`.
5. `savings` is the sum over eligible results of `estimateTokens(text) - PLACEHOLDER_TOKEN_ESTIMATE`. When
   `savings < minSavings` or there are no eligible results, return `{ selected: [], savings }`; otherwise return
   the eligible results in transcript order.

`rebuild` returns a new array of the same length and order. A message none of whose `toolResults` has a
`tool_use_id` in `placeholders` is the same object as the input. A message with at least one such entry becomes
a new object `{ role, text, toolUses, toolResults }` with no `handle` key, where `text` and `toolUses` are the
original values, each replaced entry is `{ tool_use_id, text: <placeholder>, isError: false }` (no `result`), and
every other entry is the original entry object. Assistant messages are never replaced.

Worked example (default settings). Messages, with estimated cost in brackets.
Every message not listed with text has `text` `""`; every message not listed with `toolUses` has `[]`; every message
not listed with `toolResults` has none. m0 user, text `start` [2]; m1 assistant, one `Bash` call `tu1` with input
`{"command":"ls"}`, and that entry carries `text` and `result` of 80000 chars each (the answered-call view, not
counted) [4]; m2 user, one result `tu1`, `text` 80000 chars [20000]; m3 assistant, one `Read` call `tu2` with input
`{"file_path":"/work/a.ts"}`, entry `text` and `result` 80000 chars each [7]; m4 user, one result `tu2`, `text`
80000 chars [20000]; m5 assistant, text `done` [1]. Tails: `tail[4] = 1`,
`tail[3] = 20001`, `tail[2] = 20008`. m4 is protected (1 < 16000); m2 is a candidate (20008 >= 16000). `tu1` is
eligible (not an error, tool `Bash`, 20000 >= 200 and > 40). `savings = 19960 >= 4000`, so `selected` is
`[tu1]`. With the same messages but m3 and m4 removed, `tail[2] = 1`, nothing is a candidate, and `selected` is `[]`.

## 6. `hooks/artifacts.ts`

```ts
export type Fs = { read: (path: string) => Promise<string>; write: (path: string, text: string) => Promise<void> }  // `$.fs` is assignable to it
export type Manifest = { /* the shape in section 3 */ }
export const CHUNK_CHARS = 262144
export function isArtifactId(id: string): boolean
export function splitChunks(text: string): string[]
export async function writeArtifact(fs: Fs, root: string, manifest: Omit<Manifest, "totalChars" | "chunkChars">, text: string): Promise<void>
export async function readPage(fs: Fs, root: string, id: string, offset: number, maxChars: number):
  Promise<{ ok: true; manifest: Manifest; start: number; end: number; text: string } | { ok: false; reason: "notFound" | "pastEnd"; total?: number }>
```

- `splitChunks(text)` returns consecutive slices of at most `CHUNK_CHARS` code units whose concatenation equals
  `text`, never ending between a high and a low surrogate (a slice that would end on a high surrogate ends one unit
  earlier). `splitChunks("")` is `[]`.
- `writeArtifact` writes every chunk with `fs.write` in order, then the manifest last (the commit marker), with
  `totalChars` and `chunkChars` computed from the chunks. Any rejection propagates; nothing is retried.
- `readPage` reads and validates `manifest.json` (valid JSON; `version` 1; `id` equals the requested id;
  `chunkChars` a non-empty array of positive integers; `totalChars` equals their sum), then reads only the chunks
  that overlap `[offset, offset + maxChars)` and checks each read chunk's length equals its `chunkChars` entry. Any
  failure (read rejection, bad JSON, any check failing) returns `{ ok: false, reason: "notFound" }`. An `offset`
  at or beyond `totalChars` returns `{ ok: false, reason: "pastEnd", total }`.

## 7. `hooks/recover.ts`

`export const RECOVER_NAME = "recover"`, `RECOVER_DESCRIPTION` (text telling the model that CTRSCM placeholders
name an artifact id and that this tool returns the original text in pages), `RECOVER_SCHEMA` (JSON schema object
with `id` string required, `offset` and `maxChars` integers), `DEFAULT_PAGE_CHARS = 20000`, `MAX_PAGE_CHARS =
100000` (the values in section 3), and `export async function recoverResult(fs: Fs, root: string, input: { id?: unknown; offset?: unknown;
maxChars?: unknown }): Promise<{ result: string } | { deny: string }>` producing exactly the success text and error
messages in section 3. Validation order: `id`, `offset`, `maxChars`, then `readPage`.

## 8. `hooks/register.ts`, manifests

`export function register(on: On, options: PluginOptions): void`. State inside the closure: `config` and
`problems` from `parseConfig(options)`, and `isRecoverReady = false`.

- **`session.start`:** log each problem once with `$.ui.log`; `await $.tool.register({ name: RECOVER_NAME,
  description: RECOVER_DESCRIPTION, inputSchema: RECOVER_SCHEMA })` inside a try; on success set `isRecoverReady`
  true, on rejection `$.ui.log` one line naming the error message and leave it false; then `return next(e)`.
- **`tool.call` on `{ tool: RECOVER_TOOL }`:** resolve the artifact root (below); with no root, answer `{ deny:
  "artifact root unavailable" }`; otherwise answer `await recoverResult($.fs, root, e)` using the call's `id`,
  `offset` and `maxChars` fields (top-level fields of `e`, typed `unknown`). Never call `next`.
- **`session.compact`:** in this order.
  1. Trigger `precompute`: return `{ skip: "ctrscm: nothing to precompute" }`.
  2. Trigger `manual` with non-whitespace `e.instructions`: return `next(e)`.
  3. If `!isRecoverReady`: take the fallback.
  4. `selectResults(e.messages, config)`; when `selected` is empty: take the fallback.
  5. Resolve the root; none: take the fallback.
  6. For each selected result in order: generate an id, `writeArtifact` (manifest fields: `toolUseId`, `toolName`
     or null, `agentId: e.agentId ?? null`, `createdAt`). Any rejection: log one `$.ui.log` line with the error
     message and the count of artifacts already written, then take the fallback.
  7. After every artifact is written: `rebuild(e.messages, placeholders)`, one `$.ui.log` line `CTRSCM: shook {n}
     tool results (~{savings} estimated tokens)`, and return `{ messages }`.
  "Take the fallback" means `return next(e)` when `config.fallback` is `"builtin"` and `return { skip: "ctrscm:
  shake not applied" }` when it is `"skip"`.
- **Artifact root:** `config.artifactDir` when set; else `{home}/.ctrscm/artifacts` where `home` is `await
  $.env.get("HOME")`; when that is undefined or empty the root is unavailable.

`.claude-plugin/plugin.json`: `name` `ctrscm`, `version` `0.1.0`, a one-paragraph `description`, `author`
`{ "name": "zbalint" }`, and `userConfig` with these string options, each with `type` `"string"`, a `title`, a
`description`, `required` false and a `default`: `protectTokens` ("16000"), `minSavings` ("4000"),
`minResultTokens` ("200"), `protectedTools` ("Skill"), `artifactDir` (""), `fallback` ("builtin", `options`
`["builtin", "skip"]`). Defaults must equal section 3. `hooks/hooks.json`: `{ "description": "...", "modules":
["./register.ts"] }`.

## 9. Tests (written first, one behavior at a time)

Files per the scope list; names follow `AGENTS.md`. Required behaviors, each with literal expected values:

- `config`: defaults on empty options; a numeric string parses; `"abc"` and `-1` keep the default with one
  problem; `protectedTools` as a string and as an array; empty string gives `[]`; invalid `fallback` keeps `builtin`
  with one problem.
- `shake`: the worked example in section 5 (both variants; the assistant `text` and `result` fields in it prove
  assistant answered-call views are not counted); an errored result, a `Skill` result, a
  `mcp__ctrscm__recover` result and an already-shaken placeholder are never selected; a result under
  `minResultTokens` is not selected; total savings under `minSavings` gives `selected: []`; `rebuild` returns the
  same object (`toBe`) for untouched messages, drops `handle` and `result` on a rebuilt message, keeps `tool_use_id` and
  every other entry, and never changes an assistant message; `placeholderOf` produces the exact string in section 3.
- `artifacts`: `splitChunks` on a text of exactly `CHUNK_CHARS`, `CHUNK_CHARS + 1`, and a text whose cut falls
  between a surrogate pair (the pair stays whole and the concatenation equals the input); `writeArtifact` followed
  by `readPage` round-trips a multi-chunk text; the manifest is written after all chunks (record the order of
  `fs.write` calls); a failing chunk write rejects and leaves no manifest write; `readPage` returns `notFound` for a
  missing chunk, a `totalChars` that disagrees with `chunkChars`, an id mismatch and invalid JSON; `pastEnd` at
  `offset == totalChars`; a page spanning two chunks.
- `recover`: the exact success text for a first page and for a last page (`more: false`); each error message in
  section 3; defaults applied when `offset` and `maxChars` are absent.
- `register`, through `$`: `session.start` registers `recover` and logs config problems; `session.compact` with
  `precompute` answers the skip; with `manual` plus instructions it calls the layer beneath unchanged; with `auto`
  and the worked-example transcript it writes artifacts (chunk then manifest, observed through an `on("fs.write")`
  hook), returns messages whose m2 result text is the placeholder and whose other messages are deeply equal to the input
  (object identity does not survive the test dispatch; give fixture messages `handle` strings and assert them),
  and does not call the layer beneath; a failing `fs.write` makes it call the layer beneath (fallback `builtin`) or
  answer the skip (fallback `skip`); a failed tool registration makes it fall back; no `HOME`
  (undefined, no `artifactDir`) falls back; `tool.call` on `mcp__ctrscm__recover` returns the page for an
  artifact the same test wrote.

Test dispatch seam (every item below verified by the architect with throwaway probes: compact dispatch, tool
registration accepted and rejected, `tool.call` dispatch with `{ result }` and `{ deny }`, `ui.log` capture): in a test, `await
$.session.compact({ trigger, messages, instructions?, agentId? } as never)` runs the registered hook with that
input (a bare `$.session.compact()` supplies no messages because no core runs); `as never` (and `as const`) are the
only allowed casts, in tests. Answer the world beneath with `on("session.start", ($, e) => ({ cwd: e.cwd }))`,
`on("session.compact", …)` for the fallback, `on("fs.write" | "fs.read", …)`, `on("clock.now", …)` or
`mock.clock(on)`, `mock.env(on, { HOME: "/home/example" })`, `on("tool.register", ($, e) => ({ value: { tool:
"mcp__ctrscm__" + e.name } }))` to accept the registration (leave `tool.register` unanswered, or throw in the
hook, to make it reject: the engine reports "no implementation for tool.register"), and `on("ui.log", ($, e) =>
{ logs.push(e.text); return { value: undefined } })` to observe log lines. After `$.session.start`, `await
$.tool.call({ tool: "mcp__ctrscm__recover", tool_use_id: "t1", id, offset } as never)` dispatches the recovery
hook and resolves to its `{ result }` or `{ deny }`. Assert the `next(e)` fallback by having the
beneath `session.compact` hook record that it was called and return a recognizable result.

## 10. Out of scope

Proactive compaction (`turn.complete`); a `/shake` or status command; elision of fenced or XML blocks in prose;
image or mixed-content handling beyond the rule that only `toolResults` text is replaced; artifact cleanup or
expiry; Windows paths; exact token counting; any change to `AGENTS.md`, `docs/architecture.md` or other specs;
a build or bundling step; a live (non-test) run of Claude Code, which belongs to a later tester assignment
(open items V1 to V7 in `docs/architecture.md`). Adjacent temptations to refuse: splitting the five modules
further, adding runtime dependencies, an options UI, or logging tool-result bodies.

## 11. Acceptance

Run from `/home/zbalint/workspace/CTRSCM` after implementation (all require the new code, so none runs at lock
time; feasibility was checked against the reference mod and the throwaway probe):

```sh
. ~/.nvm/nvm.sh && npm ci && npx tsc -p tsconfig.json   # exit 0, no output (section 13)
claude plugin validate . --strict          # exit 0, "Validation passed"
claude plugin test .                       # exit 0, 0 fail, every test in section 9 present
rg -n "node:|: any\b|as any|eval\(|import\(" hooks tests   # no output
rg -n "as never" hooks                                       # no output (the cast seam exists only in tests)
git status --short                         # only files named in section 0 (README.md, docs/backlog.md, .claude-plugin/, hooks/, tests/, package.json, package-lock.json, tsconfig.json)
```

Further bars: the defaults in `plugin.json`, `DEFAULT_CONFIG`, and section 3 are identical (compare the three);
the placeholder, manifest and page header produced by the code match section 3 byte for byte (the tests assert
literals); nothing is committed.

## 12. Pre-lock gate notes (2026-10-05)

Scope: every file in section 0 was checked against sections 4 to 9 and the commands in section 11; the tree holds
no plugin files yet, so the `rg` acceptance scan returns nothing today by construction. Repeated values (defaults,
chunk size, page sizes, placeholder, manifest, page header, error texts) were compared by search across this spec,
`docs/architecture.md` and `AGENTS.md` and match; section 3 is authoritative. The section 5 example arithmetic was
recomputed (costs 2, 4, 20000, 7, 20000, 1; tails 1, 20001, 20008; savings 19960). Probes run against the real
engine with a throwaway plugin outside the repository: compact dispatch with a chosen transcript; `tool.register`
accepted and rejected; `tool.call` dispatch returning `{ result }`, `{ result, isError }` and `{ deny }`; `ui.log`
capture; object identity does not survive the test dispatch (so section 9 asserts deep equality there). Baseline:
`claude plugin test` (5 pass) and `claude plugin validate` pass on the shipped `agents-md` mod. Acceptance commands
needing new code are deferred to implementation and were checked for feasibility only.

Consultant findings (`m_482`) and dispositions: F1 baseline wording fixed (commit before assignment); F2 D5
reworded; F3 errors now `{ deny }`; F4 `Fs` is a plain structural type; F5 recover input validation made exact
(numbers only, `maxChars` 1 to 100000, larger invalid); F6 numeric strings defined; F7 `USERPROFILE` dropped;
F8 example fields made explicit, answered-call `text` and `result` added to prove they are not counted; F9 the
cast scan reduced to `as never` in `hooks` plus a review read (a regex cannot tell a cast from prose); F10 the
`toolUses` text scan removed in favor of the fixture test; F11 test seams for `tool.register` and `ui.log` added
and probed; F12 deep equality in `register` tests; F13 `tool.call` dispatch probed and its form stated. Not
adopted: none. Left open on purpose: live behavior (architecture V1 to V7). The typecheck gate, first deferred for
lack of Node, was added by Amendment 1 (section 13) the same day, after its own probe.

## 13. Amendment 1: typecheck gate (2026-10-05, before assignment)

Origin: the owner installed Node (nvm, v24.21.0, WSL). Probe by the architect, outside the repository: a plugin with
`tsconfig.json` below and `typescript` 5.9.3 typechecks against `types/claude-code.d.ts`, including the `claude-code`
and `claude-code/testing` modules and `as never` casts; its only errors were `console` calls, which the runtime
does not provide (so the compiler also enforces "no console"). This amendment supersedes the earlier "no
`package.json`/`tsconfig.json`" and "no typecheck" sentences, edited in place in sections 0, 10 and 11.

- `tsconfig.json`, exactly:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "types": [],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["types", "hooks", "tests"]
}
```

- `package.json`: `name` `ctrscm`, `version` `0.1.0`, `private` true, `devDependencies` `{ "typescript": "^5" }`, and
  nothing else (no scripts, no runtime dependencies). `package-lock.json` comes from `npm install`.
- Node is installed with nvm, so a non-login shell needs `. ~/.nvm/nvm.sh &&` before `node`, `npm` or `npx`
  (`AGENTS.md` says so). `types/claude-code.d.ts` is already present in the working tree (gitignored; copied from the
  reference clone's `mods/types/claude-code.d.ts`; `/plugin-types` writes the same file). The developer does not
  create or edit it; if it is missing, stop and report.
- Acceptance: `. ~/.nvm/nvm.sh && npm ci && npx tsc -p tsconfig.json` exits 0 with no output, in addition to the
  other commands in section 11. Every type error is a defect to fix in the code, never a reason to add `any`, a cast
  other than `as never` in tests or `as const`, or `// @ts-` directives (`rg -n "@ts-" hooks tests` has no output).

