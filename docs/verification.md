# Live verification log

What was run against a real Claude Code session, how, and what came out. Results are evidence from a
tester who ran the commands and reported counts; the architect checked the repository state and the
artifact directories but did not rerun the testers' analysis scripts. Costs are list-price accounting
from the CLI, not subscription billing. Fixtures are synthetic text files; no real project data.

Environment for rounds 1 to 3: Claude Code 2.1.289, model Haiku 4.5, Linux (WSL2), Claude Pro account,
code at commit `620f059` (spec 1). Plugin options came from a temporary `--settings` file
(`pluginConfigs`), never from persistent settings. Artifacts went to a temporary directory.

## Common launch shape

```sh
claude --plugin-dir <repo> --settings <tmp>/settings.json --setting-sources '' \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' --model haiku \
  --tools Read --allowedTools Read,mcp__ctrscm__recover --add-dir <tmp>
```

The built-in comparison arm is the same command without `--plugin-dir`. Options used for low-threshold
tests: `protectTokens` 200, `minSavings` 100, `minResultTokens` 50, `fallback` builtin, a temporary
`artifactDir`. A fresh isolated config directory has no login, so runs used the default config. The
engine's native memory feature stays active even with `--tools Read` and can confound questions about
conversation facts.

## Round 1: V1 and V7 (shake and recover), V4 (resume)

Script: three `Read` calls of ~21 KB numbered files (240 rows), manual `/compact`, then a question about an
old row without naming the tool.

| Item | Result | Evidence |
| --- | --- | --- |
| V1 shake round trip | PASS | UI line `CTRSCM: shook 2 tool results (~10974 estimated tokens)`; two artifact directories, each `chunk-0000.txt` plus `manifest.json`, 22106 chars; a verifier showed each chunk equals the original `Read` text exactly and the manifest totals match |
| V7 recovery from the placeholder | PASS | the model called `mcp__ctrscm__recover` unprompted (`id`, `offset` 0, `maxChars` 100000); the returned page equalled the stored artifact; the row answer was correct |
| V4 `--resume`, recover by explicit id | PASS | tool registered after resume (stream-json init tool list), one call, first 300 chars equal to the artifact |
| V4 `--resume`, model sees placeholders | FAIL (observed) | a resumed `-p` run said it had no placeholder or artifact id visible and made no tool call, although the session file holds both rebuilt entries after the compact boundary; engine loss versus model perception is unresolved (backlog B11) |

Compaction boundary in round 1: 41181 before, 6545 after (tokens), hook 53 ms.

## Round 2: images

A 64x64 red PNG and a text file were read in the same assistant turn. The engine stored them as two
separate user messages (a string result and an image array), so no image inside a rebuilt message was
exercised. After `/compact` the text result was externalized, the image message was unchanged (block
content equal before and after), the model answered the colour correctly without rereading. V2 for a mixed
message is not run; spec 2 adds a conservative rule (`hasImage`) for that case.

## Round 3: Shake versus built-in compaction (one matched pair)

Same scripted session in both arms: a setup fact, three file reads, `/compact`, two exact-detail questions
about old rows, the setup fact, a targeted read, `/cost`. 22080-byte fixtures with random 8-character
values per row. Context at the plugin options above (very low protect window).

| Measure | Shake | Built-in |
| --- | --- | --- |
| Compact, tokens before to after | 36032 to 6937 | 36665 to 1637 |
| Compact duration | 52 ms | 27772 ms |
| Q1 exact value from an old result | correct (1 recover call) | lost, no fabrication |
| Q2 exact value from the newest file | correct (protected tail, 0 calls) | lost |
| Q3 setup fact | correct, confounded by engine memory | correct, confounded |
| Q4 targeted read | wrong adjacent row (1-based offset slip) | correct |
| First request after compact, cache create / read | 9617 / 9223 | 3675 / 7112 |
| Recover call cache creation | +9033 | not applicable |
| Session list-price cost | 0.1587 USD | 0.1505 USD |

Reading: Shake compacts in milliseconds without a summarizer call and kept exact detail the summary lost;
it is not cache-free and re-inflated context when the model recovered a whole 22k-char result with
`maxChars` 100000. On this fixture the cost was about 5% higher. One pair, Haiku, a shared account cache and
native memory active: directional only, no general cost or quality claim.

## Not run

V3 as a controlled cache experiment, V5 (does a `precompute` skip affect the compaction that follows), V6
(10 s hook budget with large artifact sets), image inside a rebuilt mixed message.

## Round 4: spec 2 live checks and 100k-token sessions

Code: commit `9210a02` (docs-only commits after it). Same environment as rounds 1 to 3. The first plan was held
for a few hours because the quota figures (percent left) were read as percent used; nothing else changed.
Launch shape as above, plus for the 100k runs the environment variable
`CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` on the launch command only (documented minimum window).
Fixtures: 21 files of 240 rows, 21840 bytes each, one unique 8-character fixture value per row, seed 533, truth map
kept outside the repository. Four CLI launches counted (one exited at the trust prompt before any model use);
three model-active sessions. The owner capped model launches at four; a fifth, to finish the built-in arm, was refused
by the tester's approval review and not run.

### Stage A: proactive trigger, `/shake`, `/ctrscm` (one interactive session)

Options: `triggerTokens` 45000, `triggerPercent` 90, `cooldownTurns` 2, `protectTokens` 3000, `minSavings` 1000,
`minResultTokens` 200, `aggressiveProtectTokens` 500, `autoShake` on, `fallback` builtin.

| Check | Result | Evidence |
| --- | --- | --- |
| L1 proactive request fires by itself | PASS | after the sixth file read (context 26% of the window): requested, shook 5 results (~28170 estimated tokens); compaction 51757 to 7060 tokens in 53 ms; the session file labels the boundary `manual`, the marker in `instructions` carries the request |
| `/ctrscm` | PASS | text matches the spec block; `last: none yet`, `pending: none` at start; after the pass `1 passes, 5 results, ~28170 saved` |
| L2 `/shake` queued, then run | PASS | exact queued text; `pending: aggressive shake`; the next turn requested an aggressive pass, which found nothing worth shaking (`last: aggressive skipped: nothing worth shaking`, pending cleared) |
| L3 notice on a skipped proactive pass, cooldown | NOT EXERCISED | context had fallen below the trigger; the aggressive skip showed no extra notice, only the request line and the `/ctrscm` reason |
| Recovery question after the shake | FAIL (observed) | asked for an exact value from the first file with five placeholders present; the model answered that the result was externalized and told the person to reread; zero tool calls. Not reproduced in Stage B |

No hook error, no broken conversation. Session cost 0.1653 USD (list price). Five artifacts, 113480 chars, all exact.

### Stage B: 100k window, Shake versus built-in (one pair, partial)

Both arms: engine auto-compact window 100000. Shake options: `triggerTokens` 70000, `triggerPercent` 90, `cooldownTurns`
3, `protectTokens` 16000, `minSavings` 4000, `minResultTokens` 200, `aggressiveProtectTokens` 4000, `fallback` builtin.
Built-in arm: same command without `--plugin-dir`. One file read per turn until two compactions had happened.
All four boundaries were the engine's own `auto` ones, so the Shake arm exercised the spec 1 path (the engine
compacted at about 71k, before the plugin's 70000 measurement could ask); no summarizer fallback occurred.

| Arm | Boundary | Turn | Pre (tokens) | Post (tokens) | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shake | 1 | 10 | 71253 | 18801 | 50 ms |
| Shake | 2 | 16 | 67064 | 19386 | 66 ms |
| Built-in | 1 | 10 | 71010 | 7543 | 23411 ms |
| Built-in | 2 | 18 | 67116 | 2342 | 27497 ms |

The Shake arm read 15 files, the built-in arm 18 (one extra read overlapped the second compaction). File 19 was never
read in either arm, so the planned Q3 tested nothing.

| Question | Shake | Built-in |
| --- | --- | --- |
| Q1 exact value, file 2 row 173 | PASS, one `recover` call | FAIL, lost in the summary, no tool call |
| Q2 exact value, file 9 row 173 | PASS, one `recover` call | FAIL, lost; the model tried to read its own session transcript (too-large error), a follow-up was blocked by the tester's approval review |
| Q3 file 19 | not exercised | not exercised (noisy submission) |
| Q4 files read, first and last | PASS (15, first, last) | NOT RUN |
| Q5 targeted read of another file | PASS | NOT RUN |

Recovery among many placeholders: with 11 placeholders present the model chose the correct id for each question
(file 2 and file 9), `maxChars` 100000, `offset` omitted; both returned bodies equal the stored 22696-char artifacts.
All 11 artifacts are exact copies of the original `Read` results, one chunk each, 249656 chars.

| CLI cost state | Shake | Built-in |
| --- | ---: | ---: |
| input tokens | 2142 | 11954 |
| cache creation tokens | 166988 | 144507 |
| cache read tokens | 1514357 | 1409704 |
| output tokens | 3923 | 9740 |
| list-price total | 0.5072 USD | 0.4905 USD |
| API time | 58.3 s | 125.1 s |

First request after a boundary, cache creation: Shake 24543 and 26075, built-in 10050 and 3608; the Shake arm
keeps a larger context after each boundary (about 19k against 2k to 8k), which it then reads from cache. Cache-read
share was about 90% in both arms in every phase.

Reading, with the limits stated: in this pair Shake kept exact detail that the summaries lost, compacted in tens of
milliseconds instead of ~25 seconds (the summarizer call), and spent about 3% more at list price while reading three
fewer files; the totals are not comparable enough to claim a cost difference either way. One pair, Haiku 4.5, a
shared account cache, the engine's native memory active, built-in Q3 to Q5 incomplete: directional evidence only.

Reproduction material (kept in a temporary directory outside the repository, not committed): fixture generator,
truth map, both settings files (non-secret, quoted above for Stage A and in the options above for Stage B), the
analysis scripts, the per-provider usage table.

## Round 5: E1, what a resumed shaken session holds (one forked launch)

Question (backlog B11): after resuming a session that Shake rewrote, are the placeholders still in the engine's transcript,
and does the model see them? Method: the round 4 Stage B Shake session resumed with `--fork-session` (the original
transcript hash is unchanged afterwards), the same plugin and settings, plus a throwaway diagnostic plugin (loaded as a
second `--plugin-dir`, kept outside the repository) that logs at each turn start how many tool results in
`$.session.messages()` begin with the placeholder prefix (counts only). Four prompts, no model tool calls expected:
T1 and T4 ask the model to quote the first 60 characters of every tool result beginning with `[CTRSCM`; T2 asks for an exact
value from a shaken file without naming the recovery tool; T3 asks for the first tool result it can see. The same
command shape as round 4 Stage B with the extra `--plugin-dir`, `--resume <session> --fork-session`.

| Turn | Engine view (messages / tool results / placeholder entries) | Model's literal placeholder quotes | Other result |
| --- | --- | ---: | --- |
| T1 | 235 / 41 / 17 | 0 | quoted two recovery-result headers (`CTRSCM artifact <id>`), no NONE |
| T2 | 475 / 82 / 54 | 0 | refused to recover (answered that the result was externalized); wrong answer, zero tool calls |
| T3 | 478 / 82 / 54 | 1 | quoted one 60-character placeholder prefix |
| T4 | 481 / 82 / 54 | 1 | quoted one 60-character placeholder prefix |

Between T1 and T2 the proactive trigger fired in the resumed session (context 64%): it shook 20 results (~112680
estimated tokens), 131447 to 21733 tokens in 153 ms, so T2 to T4 are not a pure resume test.

Structure (session file, counts only): the engine view holds the placeholders after a forked resume (17 entries, 11 distinct
artifacts), which rules out "the engine drops them" for this path. The fork carries no inherited compaction boundary records
(the original has 2) and replays the pre-compaction history, so the resumed context is large again (the proactive trigger
fired at once). Every placeholder row is a plain text tool-result block with no stored tool-result record; the 24 original
tool results in the same transcript all have typed records. All placeholders for the same size share the same first 60
characters, so quote counts cannot prove which ones the model saw. 20 artifacts were written by the new pass but only 14
are referenced afterwards (6 orphans, harmless inert files).

Reading: the placeholder rows survive in the engine view; whether the provider payload carries them is not established
(no outgoing payload capture), and a fork is not a plain resume. The recovery refusals (round 4 Stage A, round 5 T2)
have in common that several placeholders look identical except for the artifact id, while the successful recoveries
(rounds 1 and 3, Stage B twice) had distinguishable circumstances; spec 4 names the replaced tool call in the
placeholder to test that. Cost of the launch: 0.343 USD list-price incremental (the session cost state also carries the
inherited 0.507 USD of the original).

## Round 6: specs 3 and 4 together (labeled placeholders, smaller recovery pages)

Code: commit `9cd07d2`. Question: with several same-size placeholders present, does the model recover the right
artifact for a named file, in small pages? (Rounds 4 and 5 had two refusals with identical-looking placeholders and
`maxChars` 100000 in every call.) Two fresh interactive Haiku 4.5 launches (CLI 2.1.289), different fixture seeds
(61 and 62), eight files of 240 rows (21840 bytes) each, 1920 unique 8-character fixture values per seed, truth maps
kept outside the model's reach (deny-read rules for the truth directory and the private session directory in the
temporary settings; fixture files only in `--add-dir`); no engine compaction-window override.
Options: `autoShake` on, `triggerTokens` 45000, `triggerPercent` 90, `cooldownTurns` 2, `protectTokens` 3000,
`minSavings` 1000, `minResultTokens` 200, `aggressiveProtectTokens` 500, `fallback` builtin, a temporary
`artifactDir` per launch. Launch shape as above plus `--session-id <fresh uuid>`. Script per launch, one prompt per
turn: `/ctrscm`; read files 1 to 6 with one `Read` call each (reply only the row count); then three recall questions
that never name the tool ("exact fixture value on row R of <file>, do not reread, reply only the value"): file 2 row
12, file 4 row 173 (deep row), file 5 row 90; `/ctrscm`; `/cost`; `/exit`.

Both launches: the proactive request fired by itself after the sixth read (context 26%): 51346 to 7207 tokens in 73 ms
and 51595 to 7207 tokens in 58 ms; 5 results shaken each (~28170 estimated tokens); one compaction boundary each (the
session file labels it `manual`); no built-in summarization, no hook error. Each placeholder is 222 characters and names
the full read path.

| Launch | Question | Right artifact, right answer | recover calls | offset | maxChars | Chars returned |
| --- | --- | --- | ---: | --- | --- | ---: |
| 1 | file 2 row 12 | yes / yes | 1 | omitted | 8000 | 8000 |
| 1 | file 4 row 173 | yes / yes | 1 | 16000 | 8000 | 6696 |
| 1 | file 5 row 90 | yes / yes | 1 | 8000 | 8000 | 8000 |
| 2 | file 2 row 12 | yes / yes | 1 | omitted | omitted (default 8000) | 8000 |
| 2 | file 4 row 173 | yes / yes | 1 | 0 | 20000 | 20000 |
| 2 | file 5 row 90 | yes / yes | 1 | 0 | 20000 | 20000 |

Artifact ids were checked two ways (the label in the placeholder, and byte equality of the stored chunks with the
original `Read` result): 6 of 6 correct among five same-size placeholders; no refusal, no source `Read`, no tool error.
Four of six calls used pages of 8000 characters or less; launch 1 jumped straight to the right offset for deeper rows,
launch 2 asked for the 20000 maximum from offset 0 (about 88% of a 22696-character result). The 8000-first preference
in the description is therefore followed inconsistently.

| Launch | List-price total | API time | Cache read | Cache creation |
| --- | ---: | ---: | ---: | ---: |
| 1 | 0.1942 USD | 29.5 s | 423586 | 70015 |
| 2 | 0.1980 USD | 31.1 s | 441176 | 70719 |

Reading: the previous failure mode (refusal with identical-looking placeholders, whole-result pages) did not appear in six
questions. Both the label and the new description changed at once, the seeds, questions and contexts differ from earlier
rounds, and the sample is six questions on one model, so the effect of each change cannot be separated and no general
rate is claimed. The 20000 limit's deny path and resumed-session placeholder perception were not exercised.

## Round 7: spec 5 (usage log, advice) and the owner's settings file

Code: commit `7d0e79c`, Claude Code 2.1.290, Haiku 4.5. Two launches; the second made no model call.

Launch 1 (interactive, one session): `autoShake` on, `triggerTokens` 62000, `triggerPercent` 99, `adviseTokens` 40000, `cooldownTurns` 2,
`protectTokens` 3000, `minSavings` 1000, `minResultTokens` 200, `aggressiveProtectTokens` 500, `usageLog` on, `fallback` builtin, a temporary
`artifactDir`; ten fixture files (240 rows, 21840 bytes, 2400 unique fixture values, seed 71); explicit `--session-id`; one `Read` per turn.

| Observation | Result |
| --- | --- |
| Advice | one, after read 5: context 44456 tokens (22%) with `adviseTokens` 40000; none after reads 6 and 7 (cooldown) |
| Proactive shake | after read 8: context 65633 tokens (33%) at the 62000 trigger; 7 results, 158872 characters, ~39438 estimated tokens; boundary 65671 to 7483 tokens in 66 ms; no advice in that measurement, as specified |
| Usage files | 2, both valid JSON with exactly the 16 documented keys; names match `{timestamp}-{uuid}.json`; session id equals the launch's `--session-id`; timestamps ordered |
| Shake event vs artifacts | `results` 7, `chars` 158872, 7 artifact ids all match the manifests and chunk lengths (each 22696 characters, exact copies of the `Read` result) |
| Privacy | all 2400 truth values searched in every usage file: 0 matches; no fixture path or label |
| Placeholders | 7, each 203 characters, labeled with tool and path |
| Recovery | 2 of 2 correct, right artifact each time: row 12 (offset omitted, `maxChars` 8000 default) and row 173 (offset 15000, `maxChars` 7000); no source rereads |
| Errors | no hook error, no broken turn, no repeated skip notice |
| Cost | 0.2394 USD list price, 20 provider messages, API time 60.1 s |

Launch 2 (the owner's `docs/examples/ctrscm-150k.json`, `/ctrscm` then `/exit`, no model call): `auto: on (trigger 99% or 150000 tokens, 0 = off; cooldown 3
turns)`, `advice: at 250000 tokens, 0 = off`, protect 16000, aggressive protect 4000, min savings 4000, min result 200, usage log on under the default artifact root.

Caveats: one model-active session, two recall questions, Haiku only, native memory active, shared account cache. Defaults (120000 / 150000 / on) were checked in the code, not in a launch.
Not exercised: advice repeating after the cooldown, `adviseTokens` 0, `usageLog` off, an unwritable log, a rejected `HOME` lookup, contexts above 150k tokens, a proactive pass that skips.
Compaction replays informational messages under new ids, so the raw session file shows duplicate old advice and request lines; the usage files show a single advice event.

## Not run (after round 6)

Any model with a 1M-token window (all live runs used Haiku 4.5 with a 200k window), sessions near 150k tokens or more, V3 as a controlled cache experiment with equal reads, V5, V6, an image inside a rebuilt mixed message, a proactive
request that skips (L3), built-in Q4 and Q5, a plain (non-fork) `--resume` of a shaken session, a persistent install, advice repeating after cooldown,
`usageLog` off, an unwritable log.

## Round 8: spec 9 (config file), owner's session

Reported by the owner and read from `/ctrscm` output on 2026-10-06; not a scripted launch. The installed mod was updated, then a new session started with no options passed.

| Observation | Result |
| --- | --- |
| Option sources | `options: 0 passed, 11 from file, 2 default` |
| Config path | `/home/zbalint/.ctrscm/config.json` |
| Effective values | trigger 99% or 150000 tokens, cooldown 3 turns, advice at 300000, protect 20000, aggressive protect 4000, min savings 4000, min result 200, protected tools `Skill`, usage log on |

Caveats: the values were not compared with the file's contents (the file was not read), and no shake pass ran in this check. Not exercised: how the engine's option UI renders `fallback`, `autoShake` and `usageLog` now that the manifest defaults are gone (spec 9 removed them).

## Round 9: spec 10 and live proactive passes, owner's session

Reported by the owner and read from `/ctrscm` and `/ctrscm report` output on 2026-10-06; not a scripted launch. The mod was loaded from `~/.mods/CTRSCM` at `5174de1` (default model, 1M window, options from the config file: trigger 99% or 150000 tokens, cooldown 3 turns, advice 300000, protect 20000, min savings 4000).

| Observation | Result |
| --- | --- |
| Spec 10 | `context: 65207 tokens (7% of 1000000)` and `engine compaction: auto at 967000 tokens`; after a pass `context: not measured yet` until the next response |
| Proactive pass 1 | fired after the context passed 150k: 6 results, ~49811 estimated tokens saved; real median prompt per turn 194123 before, 114562 after (3 turns each side), ~79.6k real |
| Proactive pass 2 | 6 results, ~64615 estimated; real median prompt 335901 before, 115742 after (3 turns before, 1 after), ~220k real |
| Cache | first turn after: 88274 (pass 1) and 92272 (pass 2) cache-creation tokens against 4166 and 1945 on a normal turn before; session list-price cost ~1.29 USD before pass 2, ~2.20 after the turn that followed it |
| Break-even | at assumed list-price ratios (write 1.25x, read 0.1x, not checked for the model): ~11 turns for pass 1, ~5 for pass 2 |
| Session after passes | continued without a built-in summary and without a hook error; the status line read `2 passes, 12 results shaken` |

Findings: the estimate undercounts real tokens (1.6x and 3.4x, code and type declarations; B27). A single turn of large reads passed the trigger by ~190k tokens because the trigger runs at a turn's end (B26).
Caveats: one session, one model, medians over 1 to 3 turns, "before" medians may mix turns of different size, the pass cost is not separable from the turn it landed in, and the transcript notice lines were not checked.
Closes B25. Not exercised: L3 (a proactive request that skips), a plain `--resume` of a shaken session, advice at 300k, a prose-heavy session.
