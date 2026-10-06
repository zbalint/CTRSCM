# Backlog

Status: the running list of open items. It is a tracker, not a design: a decision belongs in
[architecture](architecture.md), and an implementation slice gets a locked spec under
`docs/specs/`. Check an item against the code before acting on it, because entries can lag the code.

## How to use this file

- One row per item, newest at the bottom of its section. Give each item a stable ID.
- Evidence column: how the state was learned (`code`, `docs`, `manual`, `reported`).
  `reported` means the owner said so and it was not re-run.
- When an item is done, move it to Closed with the commit or spec that closed it.
- `// shortcut:` comments in the code are the ledger of deliberate corners; this file lists only
  the ones worth scheduling.

## Open

| ID | Item | Evidence |
| --- | --- | --- |
| B1 | Live verification V1 to V7 from [architecture](architecture.md); needs a tester running `claude --plugin-dir .` | docs |
| B3 | Orphaned artifact cleanup: no delete primitive in `$.fs`; a `$.process.run`-based sweep or a documented manual `rm` | docs |
| B5 | OMP-style elision of large fenced and XML blocks in prose (excluded from v1 by the product invariants; needs an owner decision) | docs |
| B6 | Windows path behavior in `$.fs` (v1 targets Linux and WSL) | docs |
| B7 | Image or mixed-content safety if V2 shows a rebuilt user message loses non-text blocks | docs |
| B8 | Exact token counts if the engine ever exposes a counter | docs |
| B10 | Registered-hook tests cannot inject custom `PluginOptions` (test API has no userConfig injection; inline wrappers fail the hook analyzer), so invalid parsed options and `fallback: skip` are covered only by pure `parseConfig` tests; revisit when the engine adds options injection to `claude plugin test` | code |
| B11 | Live V4 and round 5 E1 (CLI 2.1.289, Haiku): the engine view of a forked, resumed shaken session still holds the placeholders (17 entries, 11 distinct ids) and recover by explicit id works, but the model quoted none in the first turn; the fork has no inherited compaction boundaries and replays the pre-compaction history, so the resumed context is large again; placeholder rows have no stored tool-result record. Open: a plain (non-fork) resume with the diagnostic, and an outgoing-payload capture; a string `result` on rebuilt entries is a candidate only after a live check | reported |
| B13 | `/shake` runs at the next turn end, not at once (the host refuses compaction from a command hook); revisit if the engine allows it | code |
| B14 | Remaining live gaps: L3 (a proactive request that skips: notice and cooldown), built-in Q4/Q5 and an equal-read repeat of the 100k comparison, a plain (non-fork) `--resume` of a shaken session with the diagnostic, how a person sets options persistently (only the temporary `--settings` route was run), longer sessions on the usual model | reported |
| B16 | Report tool that joins the usage log with the session files (compaction tokens before and after, cache creation and read around each boundary) and prints per-session tokens reclaimed and the cache effect | owner request |
| B18 | Turn-aware protection (owner idea, 2026-10-06): protect tool results by completed user turns (`protectTurns`) instead of only a token tail, optionally shaking finished turns eagerly to keep the context flat; measure cache churn (rewrite from N turns back), tool re-runs and recover loops, and answer quality in an A/B on real work; the owner confirmed tool calls (their inputs) are valuable and stay verbatim, so only tool-result text is in scope; prose blocks stay out unless the report's category breakdown shows they matter | owner request |
| B19 | Escalation option: when a Shake pass cannot get the context under a second threshold (for example 250k) ask for a built-in compaction (opt-in, default off); report tool shows context per turn, time above the owner's ~150k zone and a breakdown by category | owner request |
| B17 | Persistent install: a local marketplace for the plugin so `claude plugin install` and `claude plugin configure` work; verify how options are stored | docs |

## Closed

| ID | Item | Closed by |
| --- | --- | --- |
| B9 | Typecheck gate (Node installed 2026-10-05; probe passed) | spec 1 amendment 1 (section 13) |
| B2 | Proactive compaction near a threshold (`session.measure`, marked `$.session.compact`) | spec 2 |
| B4 | `/shake` (queued, runs at the next turn end) and `/ctrscm` status commands | spec 2 |
| B12 | Steer recovery toward small pages (description wording, page limits 8000 default and 20000 maximum); live effect still to be measured | spec 3 |
| B15 | Persistent per-event usage log and context advice | spec 5 |
