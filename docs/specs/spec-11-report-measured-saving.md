# Spec 11: measured saving and pay-back in `/ctrscm report`, and a one-time report hint

## 0. Status

**LOCKED** (2026-10-06), revision 3. Consultant reviews `m_686`, `m_689`, `m_692` applied; revision 2 fixed a flaw the first review did not see (D1: per-turn prompt sums). Owner decisions: D3 option 1 (fixed constants, write 2x, read 0.1x), D4 the one-time log line (recommended, advice `m_692`). Closes the report half of backlog B27; the estimate calibration half stays open. The architect runs the spec-writing pre-lock gate before locking.

**Scope.** Edits: `hooks/report.ts`, `hooks/register.ts`, `tests/report.test.ts`, `tests/register.test.ts`. Does not touch: every other `hooks/*.ts`, other `tests/*`, `.claude-plugin/plugin.json`, `README.md`, `docs/*`, `AGENTS.md` (the architect edits `docs/usage.md`, `docs/backlog.md`, `docs/verification.md` after acceptance). No new dependency, no new file, no new config key. No commit, stage, merge or push: leave the diff uncommitted.

**Location and branch:** main checkout `<repo>`, branch `develop`, at the commit that holds this spec. **Shared task `context_id`:** `ctrscm-report-measured`.
**Public test seams:** `reportText` (pure), and the registered shook pass driven through `$` (the hint line in `logs`).

## 1. Why

Round 9 (`docs/verification.md`) read three live passes by hand. The mod's `~N estimated tokens saved` is a chars/4 estimate, and the report leaves the real saving and the pay-back to the reader. A pass costs one cache rebuild of about 90k to 100k tokens (88274, 92272, 99624 cache-creation tokens in the first turn after, against 4166, 1945, 3532 before), which pays back only after some turns, and nothing tells a person who has just had a pass that a report exists.

**Why the existing figure cannot be the saving.** `turn.complete` carries `usage` as "its responses' token counts summed" (`types/claude-code.d.ts` lines 10601 to 10603). A turn that makes several tool calls makes several API responses, and each re-reads the whole prompt, so `promptOf` (input + creation + read, `hooks/report.ts:72`) is roughly the context size times the number of responses in the turn. Round 9 shows it: pass 3 reads `600964 before` while the engine's own single-response figure was about 123k after. The report's `prompt per turn` line is therefore not a context size, and a saving derived from it (the 220k and 3.4x read by hand in round 9) is overstated. The per-turn event also carries `contextTokens`, the last single-response fill before the turn ended (`hooks/register.ts:289` and `343`), which is the comparable figure.

## 2. Decisions

- **D1. A `measured:` line after each pass line, from `contextTokens`, not from `promptOf`.** `hooks/report.ts` only; no `$`. Reuse the windows `passLine` already computes (the same `before` and `after` turns, no second window rule); only turns whose `contextTokens` is a number count, in both windows. `contextTokens` is lagged (`m_689`): a turn event carries the fill after the turn's second-to-last response, so a one-response turn carries the previous turn's fill, and the first turn after a pass can carry the stale pre-pass value. Therefore the `measured:` line needs at least 1 such turn before and at least 2 after; the lower-middle median then absorbs one stale value. State this in a code comment.
  - `medianBefore` and `medianAfter` are the medians (the existing `median`) of `contextTokens` over those turns; `saved = medianBefore - medianAfter`.
  - With the turn counts above and `saved > 0`:
    `  measured: context ~{saved} tokens lower (median {medianBefore} before, {medianAfter} after); first turn after wrote ~{extra} more cache tokens than usual; pays back in ~{turns} later turns at assumed list-price ratios (cache write {W/100}x, cache read 0.1x)`
    `W/100` is printed as a plain number (`2x`, `1.25x`). Exact expected line for the D2 worked example at the recommended `W`: `  measured: context ~45000 tokens lower (median 160000 before, 115000 after); first turn after wrote ~87000 more cache tokens than usual; pays back in ~37 later turns at assumed list-price ratios (cache write 2x, cache read 0.1x)`.
  - `extra = firstAfterCreation - median(beforeCreation)` (the existing values; the cache-creation figures are turn sums too, but a rebuild lands in the turn's first response, so the first turn after is read as an approximation, labeled `~`). When `extra <= 0`, drop the second and third clause: `  measured: context ~{saved} tokens lower (median {medianBefore} before, {medianAfter} after); no extra cache write in the first turn after`.
  - `saved <= 0`: `  measured: no drop in context (median {medianBefore} before, {medianAfter} after)`.
  - Fewer such turns than that on either side: no `measured:` line.
- **D2. Pay-back, integer form.** `turns = ceil(extra * (W - 10) / (saved * 10))` with the ratios held as integer hundredths (`W` is the write ratio times 100, 10 is the read ratio times 100), so a whole quotient never rounds up by a float error. Name them `CACHE_WRITE_RATIO` and `CACHE_READ_RATIO` (hundredths: 200 and 10 at the recommendation) so the acceptance `rg` is deterministic. The extra write is billed at the write rate instead of the read rate it would have paid, and each later turn saves `saved` tokens of read. Hidden assumption, stated in a code comment: later turns hit the cache; if the cache expires between turns, both arms rewrite and a pass pays back at once.
  Worked example (literals for the test), with `W` 200: before turns have `contextTokens` 150000, 160000, 170000 (median 160000) and cache creation 2000, 3000, 4000 (median 3000); after turns have `contextTokens` 110000, 115000, 120000 (median 115000) and the first after has cache creation 90000; `saved` 45000, `extra` 87000; `87000 * 190 / (45000 * 10)` = 36.73, `turns` 37. With `W` 125: `87000 * 115 / 450000` = 22.23, 23 (a spec arithmetic check only; the committed test covers the committed constant). Worked example needs 2 or 3 after turns with `contextTokens`: use the three above.
  Test-author caveat: the turn literals' `inputTokens`, `cacheCreationTokens` and `cacheReadTokens` are what `passLine`'s existing text sums; set `contextTokens` separately and do not copy a prompt value into `inputTokens`.
- **D3. (Owner decision) The ratio constants in `hooks/report.ts`.** Recommended: write ratio 200 (the 1-hour cache), read 10, as named constants with a `// shortcut:` comment: not read from the engine; upgrade when the engine exposes the model's rates, or if the owner's sessions use the 5-minute cache (write 125). The consultant's grounding: the round 6 cost state reconciled with a 1-hour write at 2x on the owner's account (Haiku, CLI 2.1.289), not checked for other models. The line prints the ratio it used. Owner chose this fixed-constant option (2026-10-06) over a per-model read ratio and over omitting `pays back`. The `// shortcut:` comment must also say: cache writes are 1.25x (5 minutes) or 2x (1 hour) of base input on every model, but the read ratio is per model (0.1x for Sonnet 5.5, Sonnet 5, Opus 5 and Haiku 4.5; 0.05x for Opus 5.5; 0.025x for Fable 5.1 and Mythos 5.1, per the prompt-caching pricing page on 2026-10-06), so on the cheaper-read models the pay-back is too short; upgrade to a per-model read ratio keyed on the turn event's `model` if the owner mostly uses them.
- **D4. (Owner decision) A one-time hint.** The first time `stats.passes` is bumped in a registration, `register.ts` logs `$.ui.log('CTRSCM: a pass just ran; after a few more turns /ctrscm report shows what it saved')`, inside the existing `if (request !== undefined || trackedTrigger)` block, after the bump. Not for a `precompute` pass (it installs nothing and may never apply), not for a skipped, failed or fallback pass (those return before the `shook` log). Once per registration (a `let` beside `cooldown`, inside `register()`), not persisted. No toast. `// shortcut:` once per registration; make it periodic or per session if a cadence is wanted.
- **D5. The existing pass line is relabeled, text otherwise unchanged:** `prompt per turn` becomes `prompt tokens summed over each turn's responses`. The rest of that line (`saved ~N estimated`, `cache creation ... in the first turn after vs ... before`, `counts are per turn and turns differ in length`) stays, so a reader no longer takes the sum for a context size. The `~N estimated` figure stays labeled estimated.
- **D6. Honest figures.** `saved` and `extra` are medians of measured counts, not exact savings; the pay-back is labeled with its assumed ratios and the line carries `~`. Do not call any of it exact. Never print tool bodies or option values: the new text carries token counts only.

## 3. Mechanical changes

1. `hooks/report.ts`: extend `passLine` to return the pass line and, when D1 applies, the `measured:` line (return an array; both lines use the same `before` and `after`); apply the D5 wording to the pass line; add the two ratio constants (D3). `reportText` pushes the lines in order. No other line changes.
2. `hooks/register.ts`: add the one-time hint (D4) inside the existing `if (request !== undefined || trackedTrigger)` block (current lines 510 to 516), after `stats.passes += 1`. The `shook` log line does not change.
3. `tests/report.test.ts`, literals only: the D2 worked example (the exact line in D1); `saved <= 0` (`no drop in context`); `extra <= 0`; fewer than 2 after turns with `contextTokens` (no `measured:` line); two passes (each its own line). The `turn()` helper (`tests/report.test.ts:5`, `contextTokens` fixed at null) gains a `contextTokens` parameter; extending it is in scope. Every assertion containing the old wording `prompt per turn` (`tests/report.test.ts` lines 64, 87, 91, 112, 113) takes the D5 wording; with `contextTokens` null in those fixtures none gains a `measured:` line.
4. `tests/register.test.ts`: (a) a proactive shook pass logs the D4 line once, after the `shook` line; (b) a second pass in the same registration does not log it again; (c) a skipped pass, and a `precompute` shook pass, log no hint. The whole-logs assertions at `:129` and `:210` to `213` (shook passes whose trigger bumps `stats.passes`) gain the one line; assertions at `:314`, `:617`, `:713`, `:1112`, `:1265`, `:1313` have no shook line and stay.

## 4. Out of scope

Calibrating the estimate (`chars/4`) or gating `minSavings` in real tokens (B27's other half: wait for a prose-heavy session). Changing the per-turn event shape, any trigger, threshold, cooldown or the recover tool. A report for old sessions (B19). Reading prices from the engine. A toast, a persisted flag, a periodic reminder, any new config key. The `/ctrscm` status text.

## 5. Probe result

Pre-lock baseline (2026-10-06, tree clean at `aa4ff28`): tsc pass, `claude plugin validate . --strict` pass, `claude plugin test .` 101 pass, 0 fail. `rg -n "prompt per turn"` hits as listed below. The architect ran: `. ~/.nvm/nvm.sh && npx tsc -p tsconfig.json`, `claude plugin validate . --strict`, `claude plugin test .` for the baseline count; `rg -n "prompt per turn" hooks tests docs README.md`: hits are `hooks/report.ts:109`, `tests/report.test.ts` (five lines above), `docs/specs/spec-8-turn-usage-report.md:43` (a locked historical spec, left alone) and `docs/verification.md` round 9 (the architect annotates it after acceptance); and that the D2 arithmetic matches (consultant checked an earlier example in node).

## 6. Acceptance

```sh
. ~/.nvm/nvm.sh && npx tsc -p tsconfig.json
claude plugin validate . --strict
claude plugin test .
rg -n "shortcut:|RATIO" hooks/report.ts
git diff --check
git status --short
```

Expected: tsc and validate pass with no warnings; `claude plugin test .` all pass (baseline plus the new tests); the `rg` lists the two named ratio constants and their `// shortcut:` comment in `hooks/report.ts`; `git status --short` lists only the four paths in section 0.
