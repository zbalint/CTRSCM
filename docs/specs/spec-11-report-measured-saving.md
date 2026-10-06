# Spec 11: measured saving and pay-back in `/ctrscm report`, and a one-time report hint

## 0. Status

**DRAFT** (2026-10-06), not locked: waiting for the owner's answer on D3 (hard-coded price ratios) and D4 (hint wording and where it appears). Closes the report half of backlog B27; the estimate calibration half stays open. The architect runs the spec-writing pre-lock gate before locking.

**Scope.** Edits: `hooks/report.ts`, `hooks/register.ts`, `tests/report.test.ts`, `tests/register.test.ts`. Does not touch: every other `hooks/*.ts`, other `tests/*`, `.claude-plugin/plugin.json`, `README.md`, `docs/*`, `AGENTS.md` (the architect edits `docs/usage.md`, `docs/backlog.md`, `docs/architecture.md` after acceptance). No new dependency, no new file, no new config key. No commit, stage, merge or push: leave the diff uncommitted.

**Location and branch:** main checkout `/home/zbalint/workspace/CTRSCM`, branch `develop`, at the commit that holds this spec. **Shared task `context_id`:** `ctrscm-report-measured` (to be set at lock).
**Public test seams:** `reportText` (pure), and the registered proactive pass driven through `$` (the hint lines in `logs`).

## 1. Why

Round 9 (`docs/verification.md`) read two live passes by hand: the mod's `~N estimated tokens saved` was 1.6x and 3.4x below the real drop in prompt size, and a pass cost one cache rebuild of about 90k tokens that pays back in roughly 5 to 11 turns. The report already holds the inputs (median prompt before and after, first-turn cache creation) but leaves the subtraction and the pay-back to the reader, and nothing tells a person who has just had a pass that a report exists. Both are report text and one log line; no trigger, threshold or shake behavior changes.

## 2. Decisions

- **D1. A `measured:` line after each pass line in `reportText`.** Computed from the same `before` and `after` turn windows and the same medians that `passLine` already uses (so no second window rule). `hooks/report.ts` only; no `$`.
  - With at least one turn before and one after, and `saved = medianBefore - medianAfter > 0`:
    `  measured: ~{saved} tokens less per turn (median prompt {medianBefore} before, {medianAfter} after); the first turn after wrote ~{extra} more cache tokens than usual; pays back in ~{turns} turns at assumed list-price ratios (cache write 1.25x, cache read 0.1x)`
  - `extra = firstAfterCreation - medianBeforeCreation`. When `extra <= 0`, replace the second and third clause with `no extra cache write in the first turn after`.
  - When `saved <= 0`: `  measured: no drop (median prompt {medianBefore} before, {medianAfter} after)`.
  - With no turn before or none after: no `measured:` line (the pass line already says `n/a`).
- **D2. Pay-back formula.** `turns = ceil(extra * (1.25 - 0.1) / (saved * 0.1))`: the extra write is billed at the write rate instead of the read rate it would otherwise have paid, and each later turn saves `saved` tokens of read. Worked example (literals for the test): before prompts 200000, 210000, 220000 (median 210000), after 110000, 115000, 120000 (median 115000), `saved` 95000; creation before 2000, 3000, 4000 (median 3000), first after 90000, `extra` 87000; `87000 * 1.15 / (95000 * 0.1)` = 10.53, `turns` 11.
- **D3. (Owner decision) The ratios are constants in `hooks/report.ts`.** Recommended: two named constants with a `// shortcut:` comment saying they are the 5-minute-cache list-price ratios, not read from the engine, and to upgrade when the engine exposes the model's rates (`PostModelSwitchHookInput` carries `estimated_cache_write_usd` for a switch, nothing per turn) or when the owner uses the 1-hour cache (write 2x). Alternative: leave the pay-back out and print only `saved` and `extra`; no pricing assumption, the reader divides. The text always says the ratios are assumed.
- **D4. (Owner decision) A one-time hint.** After the FIRST shook pass in a process, `register.ts` logs one more line with `$.ui.log`: `CTRSCM: a pass just ran; after a few more turns /ctrscm report shows what it saved`. Once per process (a `let` beside `cooldown`), not per session, not persisted; no toast (the pass runs inside `session.compact`; the existing toast is used from `session.measure` only, and nothing here says a toast is allowed there). No pass, no hint; a skipped or failed pass does not count. `// shortcut:` once per process, make it periodic or per session if the owner wants a reminder cadence.
- **D5. Honest figures.** `saved` and `extra` are medians of per-turn provider counts, not exact savings: the existing sentence `counts are per turn and turns differ in length` stays on the pass line and covers the new line. The pay-back is labeled with its assumed ratios; do not call any of it exact.
- **D6. Never print tool bodies or option values**: unchanged; the new text carries token counts only.

## 3. Mechanical changes

1. `hooks/report.ts`: have `passLine` return the pass line and, when D1 applies, the `measured:` line (return an array, or split the shared window computation into one function both lines use; extend the existing function, do not duplicate the window rules). Add the two ratio constants (D3). `reportText` pushes the lines in order. No other line changes.
2. `hooks/register.ts`: in the shake path where the existing `CTRSCM: shook N tool results` line is logged (current line 509), after it, and only for the first shook pass in the process, log the D4 line. The existing line's text does not change.
3. `tests/report.test.ts`: add tests, literals only: the D2 worked example (full expected `measured:` line); `saved <= 0` (`no drop`); `extra <= 0`; no turns after (no `measured:` line); two passes (each gets its own `measured:` line, windows as for the pass lines). Existing expectations stay as they are: the pass line text is unchanged and a `measured:` line follows it, so a full-text expectation that already contains a pass with turns before and after gains the new line.
4. `tests/register.test.ts`: (a) a proactive pass that shakes logs the D4 line once, after the `shook` line; (b) a second pass in the same registration does not log it again; (c) a skipped pass logs no hint. Existing log assertions that compare the whole `logs` array after a first shook pass gain the one line.

## 4. Out of scope

Calibrating the estimate (`chars/4`) or gating `minSavings` in real tokens (B27's other half: wait for a prose-heavy session). Changing any trigger, threshold, cooldown or the recover tool. A report for old sessions (B19). Reading prices from the engine. A toast, a persisted "report seen" flag, a periodic reminder, any new config key. The `/ctrscm` status text.

## 5. Probe result

Not run yet. Before lock the architect runs: `. ~/.nvm/nvm.sh && npx tsc -p tsconfig.json`, `claude plugin validate . --strict`, `claude plugin test .` for the baseline count; `rg -n "passLine|reportText" hooks tests` for the call sites; `rg -n "shook \$\{" hooks/register.ts` for the log site; and checks that the D2 arithmetic matches the live round 9 figures (pass 2: saved 220159 against 115742 and 335901; extra 90327).

## 6. Acceptance

```sh
. ~/.nvm/nvm.sh && npx tsc -p tsconfig.json
claude plugin validate . --strict
claude plugin test .
rg -n "ratio|1\.25" hooks/report.ts
git diff --check
git status --short
```

Expected: tsc and validate pass with no warnings; `claude plugin test .` all pass (baseline plus the new tests); the `rg` lists the named ratio constants and their `// shortcut:` comment in `hooks/report.ts` only; `git status --short` lists only the four paths in section 0.
