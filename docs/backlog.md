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
| B14 | Remaining live gaps: L3 (a proactive request that skips: notice and cooldown), built-in Q4/Q5 and an equal-read repeat of the 100k comparison, a plain (non-fork) `--resume` of a shaken session with the diagnostic, how a person sets options persistently (the config file of spec 9 covers it; live check done 2026-10-06, see verification round 8), longer sessions on the usual model | reported |
| B18 | Turn-aware protection (owner idea, 2026-10-06): protect tool results by completed user turns (`protectTurns`) instead of only a token tail, optionally shaking finished turns eagerly to keep the context flat; measure cache churn (rewrite from N turns back), tool re-runs and recover loops, and answer quality in an A/B on real work; the owner confirmed tool calls (their inputs) are valuable and stay verbatim, so only tool-result text is in scope; prose blocks stay out unless the report's category breakdown shows they matter | owner request |
| B19 | Report additions: context per turn, time above the owner's ~150k zone, and a breakdown by category. The escalation option first listed here (ask for a built-in compaction when Shake cannot get under a second threshold) was **declined by the owner on 2026-10-06**: when Shake frees nothing more, the engine's own automatic compaction is the only backstop, by design | owner request |
| B17 | Persistent install: a local marketplace for the plugin so `claude plugin install` and `claude plugin configure` work; verify how options are stored | docs |
| B20 | `--settings` options not applied in the owner's session (2026-10-06). **Cause found:** the live process has two `--settings` flags (the options file, then `a2amx`'s inline hook JSON) and the second replaces the first, so `pluginConfigs` is lost and every option is a default. Tester run E (one haiku launch, Claude Code 2.1.290): `--settings <file> --settings '{"hooks":{}}'` gave only the declared defaults; runs A to C (one `--settings`, with and without `--setting-sources`) gave the file's values. Workarounds, untested for this launch path: put `pluginConfigs.ctrscm.options` into a persistent settings source (`~/.claude/settings.json` or a project `settings.local.json`), or make the `a2amx` launch pass one merged `--settings`. Mitigated by spec 9: the mod now reads `~/.ctrscm/config.json` when nothing is passed (confirmed live 2026-10-06 in the owner's session: 11 options from the file, none passed; whether that launch still carried the second `--settings` was not checked). Open: whether the engine documents this replace-not-merge behavior; report upstream or to `a2amx` | live use, owner report |
| B21 | Auto mode classifier gives "no verdict" for Edits of files inside a loaded plugin's own directory (2026-10-06 bisect: 5 of 5 in-plugin-dir Edits failed, 9 of 9 others passed; single samples). Workaround: load the plugin from a clone (`~/.mods/CTRSCM`) and edit the workspace repo. Not reported upstream; the clone needs a `git pull` before hook changes go live | manual |
| B23 | Friction seen in the architect session while Shake was live (2026-10-06, owner asked for these to be noted): (1) the recovery tool is deferred, so the first recover needs a ToolSearch load although the placeholder names it; (2) results of 2.5 KB (~600 tokens) are shaken, so small Bash and `get_memory` outputs vanish at once and cost a recover round trip (min result 200 is low for a session that works from them); (3) placeholders appeared before the first pass (`/ctrscm` showed 0 passes), cause not established; (4) each pass costs a prompt-cache rebuild (`/usage`: 2 expected rebuilds, 374k cache writes by pass 3) and the mod cannot say what a pass cost; (5) a shaken `get_memory` result can be cited from memory of the preview only, so a grounding rule that needs the body (SALTMDB rule 7) must recover first; the model gets no hint that a placeholder holds a decisive body. Items 2 and 5 closed by spec 7 and item 4 by spec 8's report; item 1 is upstream and item 3 still needs a probe | live use, owner report |
| B24 | Option UI after spec 9 (probed 2026-10-06 in the owner's session via `/plugin`, CTRSCM config, cancelled without saving): all 13 options render as empty free-text fields that accept any text, with no defaults, choice lists or validation hints. Spec 9 treats a blank value as unset, so saving blanks should leave the file in force. Open: save with blanks and confirm `/ctrscm` still reads `0 passed` in a new session; what the UI does with a typed-in invalid value | manual |

## Closed

| ID | Item | Closed by |
| --- | --- | --- |
| B9 | Typecheck gate (Node installed 2026-10-05; probe passed) | spec 1 amendment 1 (section 13) |
| B2 | Proactive compaction near a threshold (`session.measure`, marked `$.session.compact`) | spec 2 |
| B4 | `/shake` (queued, runs at the next turn end) and `/ctrscm` status commands | spec 2 |
| B12 | Steer recovery toward small pages (description wording, page limits 8000 default and 20000 maximum); live effect still to be measured | spec 3 |
| B15 | Persistent per-event usage log and context advice | spec 5 |
| B22 | A proactive request from `session.measure` can arrive while a turn is running and the host refuses the nested compaction; a refused request is now deferred to `turn.complete` and retried once | spec 6 |
| B16 | In-mod report that says whether a Shake pass pays off: per-turn usage events and `/ctrscm report` | spec 8 (category breakdown and history of old sessions still open: B19) |
