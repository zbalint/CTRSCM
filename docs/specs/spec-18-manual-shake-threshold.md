# Spec 18: aggressive (manual) Shake ignores `minSavings`; warn on an unreachable `minSavings` (B36, B37)

## 0. Status

**LOCKED** (2026-10-09), revision 2 (consultant m_961 folded in). Source: owner decisions after the spec 17 analysis (context `ctrscm-manual-shake`): "a manual shake should work like the idle shake" (B36) and "good idea" (B37). Owner delegated the details.

**Scope.** Edits: `hooks/register.ts`, `hooks/config.ts`, `tests/register.test.ts`, `tests/config.test.ts`. The spec file itself is committed before the assignment. Does not touch: `hooks/shake.ts`, `hooks/trigger.ts`, `hooks/usage.ts`, `hooks/usageLog.ts`, `hooks/status.ts`, `hooks/report.ts`, `.claude-plugin/`, any doc or `README.md` (the architect edits `docs/usage.md`, `docs/backlog.md` after acceptance). No new file, dependency or option. No commit, stage, merge or push: leave the diff uncommitted.

**Location and branch:** main checkout `<repo>` = `/home/zbalint/workspace/CTRSCM`, branch `develop`, at the commit that holds this spec. **Shared task `context_id`:** `ctrscm-manual-shake`.
**Public test seams:** `parseConfig` (pure) and the registered hooks driven through `$` (existing `tests/register.test.ts` harness).

## 1. Why

Live evidence (owner session `69815b47`, 2026-10-09): `/shake` queued an aggressive pass, the turn-end retry ran it, and it ended `skipped: nothing worth shaking` with no UI line, because the aggressive settings keep `config.minSavings` (100000, `hooks/register.ts` ~line 607) while only `protectTokens` is lowered. The owner explicitly asked for a manual shake and got nothing, silently. The idle pass already ignores `minSavings` (`{ ...config, minSavings: 0 }`). Separately, the owner's file config (`triggerTokens` 100000, `protectTokens` 20000, `minSavings` 100000) can never qualify a proactive pass at the trigger (a pass saves at most context minus `protectTokens`), and nothing says so.

## 2. Decisions

- **D1. Aggressive ignores `minSavings`.** In `hooks/register.ts` (the `settings` choice, ~lines 606 to 611) the `aggressive` branch becomes `{ ...config, protectTokens: config.aggressiveProtectTokens, protectTurns: 0, minSavings: 0 }`. `'aggressive'` always means a user `/shake` (queued, or deferred and retried): `decideRequest` returns it only when `isPending` is set (`hooks/trigger.ts:31`), and `isPending` is set only by `/shake` (`register.ts` ~line 220) and by the deferred re-set of an already aggressive request (~line 315). A trigger hit is always `proactive`. So this decision covers exactly the manual shake. Side effect to expect: an aggressive `nothing worth shaking` usage event records `minSavings: 0` (spec 17 logs `settings.minSavings`), like idle. `protectTokens` (aggressive tail), `minResultTokens`, the image guard and protected tools still apply. Proactive and `auto`/`manual` triggers keep `config.minSavings`.
- **D2. A marked aggressive skip says so.** When the `nothing worth shaking` skip comes from an `aggressive` request, `register.ts` also logs `$.ui.log('CTRSCM: aggressive shake skipped: nothing worth shaking')` (the same reason text, no counts). Proactive and idle marked skips stay silent (B31 noise). The usage event and `stats.last` are unchanged. One log line, written next to the existing skip handling; no new helper.
- **D3. Unreachable `minSavings` warning.** In `hooks/config.ts` `parseConfig`, placed after the `autoShake` block (~lines 145 to 154, before the `usageLog` block; `config.autoShake` still holds the default until that block runs, so an earlier placement warns with `autoShake` off) and before the final `return`: when `autoShake` is on, `triggerTokens > 0` and `minSavings > triggerTokens - protectTokens`, push the problem `option minSavings: ${minSavings} is above triggerTokens minus protectTokens (${triggerTokens - protectTokens}), so a proactive pass at the trigger cannot qualify; manual /shake and idle ignore it`. When `protectTokens >= triggerTokens` the printed difference is zero or negative; that wording is accepted as is. Unlike the other problems this one keeps the value (no `using the default` suffix, no replacement); it only warns, once, through the existing problem logging. No warning when `autoShake` is off, `triggerTokens` is 0, or `minSavings` is not above the difference. The warning evaluates the final merged values (file over default, passed over file), so it appears in `parseConfig`'s result for whichever source set them.
- **D4. Add one `// shortcut:` comment** at the D3 check: the bound ignores later context growth (a pass at a larger context can still qualify) and a `triggerPercent` hit at a smaller context; upgrade to a percentage-aware rule if the owner wants it.

## 3. Tests (failing test first, one behavior at a time)

`tests/register.test.ts`: (a) a queued `/shake` with eligible savings below the configured `minSavings` shakes (outcome `shook`, results replaced, fixture results above the placeholder cost) instead of skipping; (b) an aggressive request with nothing eligible logs exactly `CTRSCM: aggressive shake skipped: nothing worth shaking` once, and its usage event has `eligibleSavings: 0` and `minSavings: 0`; a proactive skip logs nothing new; (c) the proactive request below `minSavings` still skips (existing tests stay green). The only existing assertion that changes is `tests/register.test.ts` ~2429 (test ~2414 to 2438, "a queued shake upgrades a deferred proactive request"): `h.logs` becomes `['CTRSCM: retrying aggressive shake at turn end', 'CTRSCM: aggressive shake skipped: nothing worth shaking']`. The marked skips for other reasons (`no transcript` ~1624, `artifact write failed` ~2135) must not gain the new line. About 25 idle tests load a file with `minSavings` '1000000' and the default trigger, so they now log the D3 warning at start; they use `toContain`/`not.toContain` and stay green; the `autoShake` 'off' idle cases (~1126, ~1302) must not warn. Do not weaken any assertion to `objectContaining`.
`tests/config.test.ts`: warning appears for `triggerTokens` 100000, `protectTokens` 20000, `minSavings` 100000 with the exact text of D3 and the value kept; no warning when `autoShake` off, `triggerTokens` 0, or `minSavings` 80000; the full `problems` list of existing cases is unchanged (run the suite; defaults 120000/16000/4000 never warn).

## 4. Out of scope

B30, B31, B32 (cadence and repeat requests), any new option, changing the aggressive protect tail, the idle path, `shake.ts` selection, `/ctrscm` status text, logging counts on skips (spec 17 did that in the usage file), percentage-aware bounds, Windows paths.

## 5. Probe result

Baseline: `develop` at the commit after spec 17 (`58a40da`); suite 151 pass, 0 fail. Read `hooks/register.ts` 606 to 618 (`settings` choice, empty-selection skip), `hooks/trigger.ts` (`AGGRESSIVE_MARK`, `isPending` returns `'aggressive'`), `hooks/config.ts` 118 to 135 (`problems.push` pattern). Acceptance commands require the new code and run after implementation.

## 6. Acceptance

```sh
. ~/.nvm/nvm.sh && npx tsc -p tsconfig.json
claude plugin validate . --strict
claude plugin test .
rg -n "aggressiveProtectTokens, protectTurns: 0, minSavings: 0" hooks/register.ts
rg -n "shortcut:.*protectTokens|above triggerTokens minus protectTokens" hooks/config.ts
git status --short   # only the four scope files, uncommitted (the spec is already committed)
```

Expected: tsc exit 0, validate passes (only the existing README marketplace-install advice), all tests pass, `hooks/shake.ts`, `hooks/trigger.ts`, `hooks/usage.ts` unchanged (`git diff --stat`). No known flaky test.
