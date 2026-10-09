# Spec 14: protect the last N user turns from Shake (`protectTurns`, backlog B18)

## 0. Status

**LOCKED** (2026-10-09), revision 1. Owner decision (2026-10-09): B18 is wanted ("sounds useful"). Consultant `m_849` applied: specify the protection only, off by default; eager per-turn shaking is **not** part of this spec (it costs more cache rewrites than it saves).

**Scope.** Edits: `hooks/shake.ts`, `hooks/config.ts`, `hooks/register.ts`, `hooks/status.ts`, `.claude-plugin/plugin.json`, `README.md` (the options table only), `tests/shake.test.ts`, `tests/config.test.ts`, `tests/status.test.ts`, `tests/register.test.ts`. Does not touch: other `hooks/*`, other `tests/*`, `docs/*`, `types/`, `AGENTS.md` (the architect edits `docs/usage.md` and `docs/backlog.md` after acceptance). No new dependency, no new file. No commit, stage, merge or push: leave the diff uncommitted.

**Location and branch:** main checkout `/home/zbalint/workspace/CTRSCM`, branch `develop`, at the commit that holds this spec. **Shared task `context_id`:** `ctrscm-protect-turns`.
**Public test seams:** `protectedFrom` and `selectResults` (pure, `hooks/shake.ts`), `parseConfig` (pure), `statusText` (pure), and the registered hooks driven through `$`.

## 1. Why

`protectTokens` protects the newest part of the transcript measured in estimated tokens (`hooks/shake.ts:107` to `112`). When one turn reads a lot (backlog B26: ~111k to ~336k in one turn), the protected tail is smaller than that turn, so a pass can shake results the model read a few minutes ago and then has to recover them. Protecting by **completed user turns** is independent of how big the turns are: with `protectTurns` 2, everything from the second-to-last typed prompt onward stays verbatim, whatever it weighs. Only tool-result text is ever externalized (product invariants), so this changes which results are eligible, nothing else.

## 2. Decisions

- **D1. Option `protectTurns`**, default **0** (off), a safe integer at least 0; added to `Config`, `DEFAULT_CONFIG`, `CONFIG_OPTION_NAMES` and the `numericOption` name union in `hooks/config.ts`, with the problem text `option protectTurns: must be a safe integer at least 0; using the default` (same reason string as `protectTokens`). `CONFIG_OPTION_NAMES` therefore gains one name: the `options:` status line counts one more option (D5).
- **D2. A pure `protectedFrom(messages, protectTurns): number`** exported from `hooks/shake.ts`. It returns the index of the first message that is protected: messages at an index `>=` the returned value are protected. Rules:
  - `protectTurns <= 0`: returns `messages.length` (nothing protected by turns).
  - A **typed prompt** is a message with `role === 'user'`, `text.trim() !== ''` and no tool results (`(message.toolResults ?? []).length === 0`). A user message that carries tool results is never a typed prompt, whatever its text. Assistant messages are never typed prompts.
  - Count typed prompts from the end; the result is the index of the `protectTurns`-th typed prompt from the end. If there are fewer typed prompts than `protectTurns`, the result is `0` (everything is within the last N turns). If there are no typed prompts at all and `protectTurns > 0`, the result is `0` as well.
  - Known limit, documented in the code comment as a `// shortcut:` line: an injected user message that has text and no tool results (a hook-injected reminder, a channel message) counts as a prompt; upgrade when the engine marks injected user messages.
- **D3. `selectResults` uses it.** `Pick<Config, ...>` in its `settings` parameter gains `'protectTurns'`. Compute `const protectedStart = protectedFrom(messages, settings.protectTurns)` once; in the selection loop skip a message when `index >= protectedStart`, in addition to the existing token-tail skip (`tail[index] < settings.protectTokens`). A result is protected when **either** rule protects it (union). Nothing else in `selectResults`, `rebuild` or the placeholders changes; with `protectTurns` 0 the behavior is byte-identical to today.
- **D4. Which passes.** The ordinary (proactive, manual-less `auto`), idle and `plugin` passes use `config.protectTurns` through `config` unchanged. The `aggressive` pass (queued `/shake`) exists to override protection, so in the `session.compact` hook (`hooks/register.ts:559` to `563`) its settings become `{ ...config, protectTokens: config.aggressiveProtectTokens, protectTurns: 0 }`. Idle keeps `{ ...config, minSavings: 0 }`. No other change in that hook.
- **D5. Status.** In `hooks/status.ts` the `shake:` line becomes `shake: protect ${protectTokens}, aggressive protect ${aggressiveProtectTokens}, protect turns ${protectTurns} (0 = off), min savings ...` (the rest of the line unchanged). The `options:` line counts `CONFIG_OPTION_NAMES` and now reads one higher default count.
- **D6. Manifest and README.** `.claude-plugin/plugin.json` gets a `protectTurns` entry in the existing style (title `Protected turns`, description `Number of most recent typed user turns whose tool results are never externalized, on top of the token tail; zero disables it.`, `"required": false`), placed after `protectTokens`. The README options table gets the row `| \`protectTurns\` | \`0\` | Most recent typed user turns protected from ordinary Shake, on top of \`protectTokens\`; \`/shake\` ignores it. \`0\` disables it. |` after the `protectTokens` row. No other README text.
- **D7. Invariants.** No product invariant changes: only tool-result text is externalized, no tool call or message order changes, artifacts first, no bodies logged. Nothing is written by the new code.

## 3. Tests

Write the failing test first, one behavior at a time. Literals only (AGENTS.md); build the message arrays by hand.

1. `tests/shake.test.ts`, `protectedFrom`:
   - no turns protected (`protectTurns` 0) returns the message count;
   - messages `[user "a", assistant (tool use), user (tool result only), assistant, user "b", assistant, user (tool result only), assistant]`: `protectTurns` 1 returns the index of "b", 2 returns the index of "a", 3 returns 0;
   - a user message with both text and tool results is not a prompt; a whitespace-only user message is not a prompt; no typed prompt at all with `protectTurns` 1 returns 0.
2. `tests/shake.test.ts`, `selectResults`: with the worked-example messages the file already uses and `protectTokens` 0, `protectTurns` 0 selects exactly what it selects today (existing expected value); `protectTurns` 1 leaves out every result at or after the last typed prompt and keeps those before it; the union case: a result before the turn bound but inside the token tail is still protected; `savings` and `minSavings` behave as before on the remaining selection.
3. `tests/config.test.ts`: `protectTurns` default 0; `'2'` gives 2; `'abc'` and `-1` give the default with the D1 problem text; a blank value is unset; add `protectTurns: 0` wherever a full `Config` literal is asserted.
4. `tests/status.test.ts`, `tests/register.test.ts`: the new `shake:` line text; the `options:` default counts go up by one (`13` to `14` at `tests/register.test.ts:176`, `14` to `15` at `:522` and in `tests/status.test.ts:27` and `:56`); add one registered-hook case: a pass with `protectTokens` '0' and `protectTurns` '1' leaves the result after the last typed prompt untouched, and a queued `/shake` with the same options shakes it (D4). Existing behavior: every existing test passes unchanged except the literals listed above.

## 4. Out of scope

Eager per-turn shaking and any shaking of finished turns without a trigger; counting turns by anything other than typed prompts (assistant turns, `turn.complete` events); a per-pass `protectTurns` override; a `/ctrscm report` line; the A/B measurement of cache churn and re-reads (a live task after acceptance); changing `protectTokens` or its default; excluding injected user messages (the D2 shortcut).

## 5. Probe result

Pre-lock baseline (2026-10-09, tree at `413f7e3`, source unchanged since `32b9b13`): `npx tsc -p tsconfig.json` exit 0, `claude plugin validate . --strict` pass, `claude plugin test .` 129 pass, 0 fail. Read in this tree: `hooks/shake.ts` (all), `hooks/config.ts` 88 to 140, `hooks/status.ts` 60 to 75, `hooks/register.ts` 553 to 568, `types/claude-code.d.ts` `SessionMessage` (`toolResults?` optional, `text` is `''` when none). Content search: `protectTokens` appears in `hooks/shake.ts`, `hooks/config.ts`, `hooks/register.ts`, `hooks/status.ts`, `.claude-plugin/plugin.json`, `README.md` and the tests above; the three `default` count literals are the only ones that change.

## 6. Acceptance

```sh
. ~/.nvm/nvm.sh && npx tsc -p tsconfig.json
claude plugin validate . --strict
claude plugin test .
rg -n "protectTurns" hooks .claude-plugin README.md
rg -n "shortcut:" hooks/shake.ts
rg -n "as unknown as" hooks tests
git diff --check
git status --short
```

All three gates pass with no warnings; the test count is the baseline 129 plus the new tests, 0 fail; `rg -n "as unknown as" hooks tests` hits only the two existing fixtures; `git status --short` shows only files named in section 0.
