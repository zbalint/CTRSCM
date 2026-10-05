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

## Not run (after round 4)

V3 as a controlled cache experiment with equal reads, V5, V6, an image inside a rebuilt mixed message, a proactive
request that skips (L3), built-in Q4 and Q5.
