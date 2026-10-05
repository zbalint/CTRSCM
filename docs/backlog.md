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
| B11 | Live V4 (2026-10-05, CLI 2.1.289, Haiku): after `--resume` of a shaken session the model reported it could not see the placeholders (no recovery call), although the session JSONL holds both rebuilt placeholder entries after the compact boundary. Engine context loss vs model perception unresolved. V1 and V7 passed live (artifacts byte-equal, model called recover unprompted). Next: a resumed run whose prompt includes a recovery request naming the id, or inspect the provider-bound context; V2, V3, V5, V6 not run | reported |
| B12 | Steer recovery toward small pages: in the round 3 measurement the model asked for `maxChars` 100000 and re-inflated context by a whole result (+9033 cache-write tokens); consider description wording or a lower page ceiling, then re-measure | reported |
| B13 | `/shake` runs at the next turn end, not at once (the host refuses compaction from a command hook); revisit if the engine allows it | code |
| B14 | Live checks L1 to L4 from spec 2 section 11, and the 100k-token Shake versus built-in comparison (docs/verification.md round 4) | docs |

## Closed

| ID | Item | Closed by |
| --- | --- | --- |
| B9 | Typecheck gate (Node installed 2026-10-05; probe passed) | spec 1 amendment 1 (section 13) |
| B2 | Proactive compaction near a threshold (`session.measure`, marked `$.session.compact`) | spec 2 |
| B4 | `/shake` (queued, runs at the next turn end) and `/ctrscm` status commands | spec 2 |
