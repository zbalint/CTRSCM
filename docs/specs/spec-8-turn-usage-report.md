# Spec 8: per-turn usage events and `/ctrscm report`

## 0. Status

**LOCKED** (2026-10-06), after the consultant review (`m_652`, dispositions in section 8) and the pre-lock gate (section 9). Backlog B16; design input: consultant report `m_636`, probe `m_646`.

**Scope (proposed).** New files: `hooks/report.ts` (pure), `hooks/usageLog.ts` (read side, over a structural `fs`), `tests/report.test.ts`, `tests/usageLog.test.ts`. Edits: `hooks/usage.ts`, `hooks/register.ts`,
`tests/usage.test.ts`, `tests/register.test.ts`, `tests/fixtures/commandRunInput.ts` (optional `args` parameter), `README.md` (one sentence under the usage log). Does not touch: `hooks/trigger.ts`, `hooks/shake.ts`,
`hooks/artifacts.ts`, `hooks/recover.ts`, `hooks/config.ts`, `hooks/status.ts`, `.claude-plugin/plugin.json`, `docs/*` and `AGENTS.md` (the architect edits `docs/usage.md`, `docs/architecture.md`, `docs/backlog.md` and the
`AGENTS.md` module table at acceptance). No new option, no new dependency. No commit, stage, merge or push: leave the diff uncommitted.

**Location and branch:** main checkout `/home/zbalint/workspace/CTRSCM`, branch `develop`, at the commit that holds this spec. **Shared task `context_id`:** `ctrscm-report`.
**Public test seams:** `reportText` and `usageEventPath` (pure), `readUsageEvents` over a fake `fs`, and the registered hooks driven through `$` (`$.turn.complete`, `$.session.measure`, `$.command.run`, `$.fs` as an in-memory map).
The `/ctrscm` default output (no arguments) is unchanged.

## 1. Why

Nobody can say whether a Shake pass pays off. Each pass rewrites the prompt prefix, so the next request pays cache creation again; the saving is a smaller prompt on every later request. The live session of
2026-10-06 showed list-price cost rising from $2.62 to $6.81 while the mod saved about 98k estimated tokens, and `/usage` could not separate the two effects. Spec 5's `shake` events carry the estimated saving and the
context size before the pass, but no billed-token figure. The engine gives the mod exact per-turn counts: `turn.complete` carries `usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
`cache_read_input_tokens`, `model`; `types/claude-code.d.ts:10313`, `:10604`), summed over the turn's responses (`:10601`); the probe (`m_646`, CLI 2.1.291, headless) showed it is filled and equals the run's aggregate counts.
The session's list-price total `cost.usd` arrives on `session.measure` (`:8941`) and the measure that carries a turn's final cost comes AFTER `turn.complete` (0.0203 at turn end against a final 0.0242 in the probe). The session
`.jsonl` is not used: its schema is unverified and `$.fs.read` refuses files over 4 MiB (`:2741`).

## 2. Decisions

- **D1.** A new event kind `turn` is one JSON file per turn under the same `usage/` directory, with the same file-name scheme (`usageEventPath`) and the same failure rule as spec 5 D3 (a failed write logs
  `CTRSCM: usage log write failed: {message}` and nothing else). It is controlled by the existing `usageLog` option. Fields: `version: 1`, `at`, `sessionId`, `agentId` (`string | null`, `e.agentId ?? null`),
  `event: 'turn'`, `reason` (`e.reason`), `model` (`string | null`), `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens` (each `number | null`, null when `e.usage` is absent), `contextTokens`,
  `contextPercent` (the latest `session.measure` figures, as in spec 5 D7), `sessionCostUsd` (`number | null`: the latest `session.measure` `cost.usd`, cumulative for the session, which lags the turn by one measure,
  so it is never a turn's cost). Counts and ids only, never text.
- **D2.** The type is a separate exported `TurnUsageEvent` in `hooks/usage.ts`; `UsageEvent` (shake and advice) is unchanged and `writeUsageEvent` accepts `Omit<UsageEvent, ...> | Omit<TurnUsageEvent, ...>`. A reader
  ignores events whose `event` it does not know and does not count them as skipped.
- **D3.** There is NO second `turn.complete` hook. The turn event is written inside the existing `turn.complete` hook (`hooks/register.ts`, spec 6), right after `await next(e)` and BEFORE the guard line that returns early when nothing is deferred (`hooks/register.ts:201` at the base commit) and before the deferred retry, from values
  captured at the hook's entry (`lastContext`, `lastCostUsd`). `session.measure` additionally stores `lastCostUsd = e.cost?.usd ?? null`; nothing else in that hook changes. The write happens whatever the retry decides, for
  every turn the hook sees (any `reason`, main loop or subagent), and never throws out of the hook (`writeUsageEvent` already catches).
- **D4.** `/ctrscm report` (the `ctrscm` command with `e.args.trim() === 'report'`) answers `{ text }` for the CURRENT session: the events whose `sessionId` equals `$.session.id()`. Any other `args` keeps today's status text.
  The command hook becomes `($, e)`. Fixed texts, nothing throws out of `command.run`: no artifact root → `CTRSCM report: usage log unavailable`; `$.session.id()` rejects → `CTRSCM report: session id unavailable`;
  `fs.list` of the usage directory rejects (for example a missing directory) → `CTRSCM report: no usage events yet ({message})`.
- **D5.** The report is token counts and estimates, never money per pass, and prints no break-even (a cache-creation token and a cache-read token are priced very differently, so a 1:1 comparison would mislead). In order:
  a header line (`CTRSCM report, session {first 8 characters of the id}: {n} turn events, {k} shook passes`), a totals line (`totals, main loop: {turns} turns, {output} output tokens, {creation} cache creation tokens, {reads} cache read tokens`, summed over main-loop turn events with all four counts not null), then per shook pass (`event === 'shake'` and `outcome === 'shook'`) in time order one line:

  `pass {n} at {HH:MM:SS}, saved ~{estimatedSavings} estimated: prompt per turn {afterMedian} after vs {beforeMedian} before, cache creation {firstAfterCreation} in the first turn after vs {beforeCreationMedian} before ({b} turns before, {a} after); counts are per turn and turns differ in length`

  Definitions, over main-loop turn events only (`agentId === null`, all four counts not null), ordered by `at` (a stable sort of the read order): the prompt of a turn is `inputTokens + cacheCreationTokens + cacheReadTokens`
  (counts are summed over the turn's responses). A pass's WINDOW is bounded by its neighbours: let `prev` be the previous event in the session with `event === 'shake'` and `outcome` `shook` or `fallback`, `next` the next such
  event. `before` = the up to 3 latest turn events with `prev.at < at <= pass.at` (no lower bound without `prev`); `after` = the up to 3 earliest turn events with `pass.at < at <= next.at` (no upper bound without `next`).
  A turn event written in the same turn as the pass has `at <= pass.at` (D3), so ties on `at` fall into `before`. `afterMedian`/`beforeMedian` are medians of the prompt; `beforeCreationMedian` the median of the before events'
  `cacheCreationTokens`; `firstAfterCreation` the first `after` event's `cacheCreationTokens`. A median of an even count is the lower middle value. With no `before` or no `after` event the figures of that side print `n/a`.
  A last line prints `list-price cost this session: ~${latest - first}` where `first` is the first turn event with a non-null `sessionCostUsd` and `latest` is the live `lastCostUsd` (null → the last non-null in the events),
  rounded to 4 decimals, or `unknown` when fewer than two readings exist.
- **D6.** Reading: `readUsageEvents(fs, root, sessionId)` in `hooks/usageLog.ts` lists `{root}/usage` with `fs.list` (all sessions share it), reads each `.json` file with `fs.read`, parses it and keeps the events of the session in
  the order the files were listed. A file that cannot be read or parsed is skipped and counted; the report prints `skipped {k} unreadable files` only when k > 0, and never prints file text. `fs` is typed structurally:
  `{ list: (path: string) => Promise<FsEntry[]>; read: (path: string) => Promise<string> }` with `FsEntry` imported as a type from `claude-code`. `// shortcut: one file per turn, the whole usage directory (every session) is read on each report; move to one append file per session, or a start stamp, when it passes a few thousand files.`
- **D7.** The report is a snapshot of one session and no counterfactual: cache rebuilds also come from auto-compaction, the cache's time to live and idle gaps. Its text says `estimates`/`per turn` and never presents a figure as exact.

## 3. Mechanical changes

1. `hooks/usage.ts`: add `TurnUsageEvent` (D1). `hooks/report.ts`: `reportText(events: ReportEvent[], sessionId: string, skipped: number, latestCostUsd: number | null): string` and the `ReportEvent` union; pure.
2. `hooks/usageLog.ts`: `readUsageEvents` (D6). `hooks/register.ts`: `let lastCostUsd: number | null = null` and the D3 line in `session.measure`; the turn event write in the existing `turn.complete` hook; the D4 branch in the `ctrscm` hook.
3. `tests/fixtures/commandRunInput.ts`: `commandRunInput(command: string, args = '')`.
4. Tests, literal expected values:
   (a) `usage.test.ts`: a typed `TurnUsageEvent` literal with the field names of D1.
   (b) `report.test.ts` worked example with hand-built events: before turns (input, creation, read) `10/800/50000`, `10/900/52000`, `10/1000/51000` (prompts 50810, 52910, 52010; median 52010; creation median 900); a pass with `estimatedSavings` 15000;
   after turns `10/30000/5000`, `10/900/33000`, `10/800/34000` (prompts 35010, 33910, 34810; median 34810; first-after creation 30000): the pass line carries `34810 after vs 52010 before`, `30000 in the first turn after vs 900 before`, `(3 turns before, 3 after)`.
   Further cases: fewer than 3 per side prints the true counts; no before → `n/a`; two passes bound each other's windows; a tie of `at` between a turn and the pass falls into `before`; another session's events, subagent turns and null counts are ignored;
   `skipped 2 unreadable files`; an unknown event kind is ignored and not counted; the cost line (`unknown`, and a worked difference).
   (c) `usageLog.test.ts`: a fake `fs` with two valid files of the session, one of another session, one invalid JSON file, one non-`.json` name.
   (d) `register.test.ts`: a measure with `cost: { usd: 0.5 }` then `$.turn.complete` with a `usage` object writes one `turn` file with those literals and the measure's context figures; `turn.complete` without `usage` writes null counts; the turn file's `at` is not later than a shake
   file written by a deferred retry in the same `turn.complete`; `/ctrscm report` over an in-memory `$.fs` returns the header and totals, `/ctrscm` stays the status text, a rejecting `$.session.id()` and a rejecting `fs.list` give the D4 texts.
   The `usageLog: 'off'` case is NOT driven (the test API cannot inject `PluginOptions`, backlog B10).

## 4. Out of scope

Money per pass, price tables, a break-even, the response count of a turn, the session `.jsonl`, the category breakdown (`$.session.usage`), a history of earlier sessions, a report across sessions, B18, B19, any change to
`decideRequest`, the config options, the `/ctrscm` status text, or the `shake` and `advice` events.

## 5. Not verified

Interactive, aborted and subagent turns (the probe was one headless answered turn); whether `turn.complete` always carries `usage` when several responses ran (the probe had two); how large a long session's event count grows; whether
`$.fs.list` rejects on a missing directory (D4 covers either way).

## 6. Acceptance

```sh
. ~/.nvm/nvm.sh && npm ci && npx tsc -p tsconfig.json   # exit 0, no output
claude plugin validate . --strict          # exit 0, "Validation passed"
claude plugin test .                       # exit 0, 0 fail; baseline 70 pass at the base commit
rg -n "node:|: any\b|as any|eval\(|import\(|@ts-" hooks tests   # no output
git status --short   # only the files in section 0
```

Further bars: the existing `register.test.ts` cases for spec 5's `shake` and `advice` events pass unchanged; no second `turn.complete` registration (`rg -c "on\('turn.complete'" hooks/register.ts` prints 1); the report text never contains tool-result text.
Live check afterwards (a tester or the owner): one interactive session with two or more turns; `/ctrscm report` shows the turn counts, and a pass line appears after one proactive pass.

## 8. Consultant review dispositions (`m_652`)

F1 adopted (no break-even, D5). F2 adopted: prompt size instead of reads (the rebuild turn no longer biases it), windows bounded by neighbouring passes, "turns differ in length" in the line; the response count is out of scope. F3 adopted
(D3: one hook, event before the retry, ties into `before`). F4 adopted (counts per side printed, `n/a`, the live cost for the last reading). F5 adopted (D4 texts, `usageLog: 'off'` dropped from the tests, shortcut reworded). F6 adopted
(fixture in scope, structural `fs`, `AGENTS.md` rows at acceptance, numbering fixed). F7 adopted (D2: unknown kinds ignored, not counted).

## 9. Pre-lock gate

Step 5 and 10: `rg` over `hooks` and `tests` finds `UsageEvent` only in `hooks/usage.ts` and `hooks/register.ts` (type import line 13, `writeUsageEvent` line 33 and its three call sites at lines 169, 213, 294, the `outcome` type at 287); no test names it, so
widening `writeUsageEvent` to a union is source-compatible. Step 7: the report line, D5 and the worked example in section 3 agree (50810/52910/52010 median 52010; 35010/33910/34810 median 34810; creation 900 and 30000). Step 8: a pass whose
turn event was written in the same `turn.complete` (D3) sits in `before` by `at <= pass.at`; two passes bound each other (the window between them counts as `after` of the first and `before` of the second, by design). Step 9: the existing
`turn.complete` hook is at `hooks/register.ts:199`; the `ctrscm` command hook is `async ($)` at line 124 and needs `($, e)`; `commandRunInput` hard-codes `args: ''` (section 3 item 3). Baseline: `claude plugin test .` ran 70 pass 0 fail at `4e0493e`.
