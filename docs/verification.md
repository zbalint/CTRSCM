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

## Round 4 (planned, not yet run): spec 2 live checks and 100k-token sessions

Status: deferred on 2026-10-05. The shared Claude five-hour quota was 96% used, so the tester stopped before any
model launch (per its brief). The brief (tester assignment `m_526`, code commit `9210a02`) is unchanged and
reusable: Stage A checks the proactive trigger at a low `triggerTokens`, `/shake` queued then run, `/ctrscm`, and
what the person sees when a pass skips; Stage B is the comparison below.

Both arms run with the engine auto-compact window at its documented minimum (100k tokens). The Shake arm
adds the proactive trigger (`triggerTokens` about 70000, spec 2) so Shake fires before the engine does; the
built-in arm relies on the engine's own automatic compaction. About 18 files of ~22k characters build up the
tool output, then exact-detail questions about early files (with a fact native memory cannot answer), a
targeted read, and `/cost`. One launch per arm, a repeat only if budget allows. Results will be added here
with the commands, counts and caveats.
