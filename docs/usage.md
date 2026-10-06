# Using CTRSCM

How to switch the mod on, set its options and see what it did. Everything here was run in the live tests
(`docs/verification.md`) unless marked **not verified**.

## Enabling it

CTRSCM is a Claude Code plugin whose behavior lives in a hooks module (early access: it only loads where function hooks are
enabled, tested on Claude Code 2.1.289). The route that was run:

```sh
claude --plugin-dir /path/to/CTRSCM
```

This loads the plugin for that session only. Nothing is installed and no persistent setting changes.

**Not verified:** a persistent install. `claude plugin install` takes a plugin from a marketplace, and this repository
ships no marketplace; `claude plugin list` shows nothing for a `--plugin-dir` plugin, so `claude plugin configure ctrscm`
and `claude plugin enable` have nothing to act on today.

## Configuring it

Options are strings (defaults and meaning in the README options table). The route that was run: a settings file with
`pluginConfigs`, passed on the launch command line.

```json
{
  "pluginConfigs": {
    "ctrscm": {
      "options": {
        "autoShake": "on",
        "triggerPercent": "50",
        "triggerTokens": "0",
        "cooldownTurns": "3",
        "protectTokens": "16000",
        "minSavings": "4000",
        "minResultTokens": "200",
        "aggressiveProtectTokens": "4000",
        "protectedTools": "Skill",
        "fallback": "builtin",
        "artifactDir": ""
      }
    }
  }
}
```

```sh
claude --plugin-dir /path/to/CTRSCM --settings /path/to/ctrscm-settings.json
```

An option you leave out keeps its default. A value that does not parse (for example `triggerPercent` `150`) keeps the
default and one `CTRSCM: option ...` line is logged at session start. `/ctrscm` prints the values in effect.

What to tune first:

- `triggerPercent` is a percentage of the model's full context window (200k on Haiku 4.5, which the live tests used; 1M on the 1M-context models, where the default 50% means 500k tokens, so set `triggerTokens` instead). The engine's own automatic
  compaction can fire first when its window is smaller; Shake still runs for it, just not as a proactive request. To make
  the proactive request come first, set `triggerTokens` several thousand tokens (more than one turn's growth) below the
  engine's threshold.
- `protectTokens` is the newest part of the conversation Shake never touches (default 16000 estimated tokens). `/shake`
  uses `aggressiveProtectTokens` instead.
- `artifactDir` defaults to `$HOME/.ctrscm/artifacts`. Artifacts are plain copies of the shaken tool output (they can
  hold anything a tool printed, including secrets) and nothing deletes them; remove old directories by hand.

## Example configurations

Only the options you change need to be listed (see "Configuring it" for the file shape). **Run live** means the exact values
were used in a live test (`docs/verification.md`); the others are reasoned from the option meanings and not run.

| Goal | Options | Status |
| --- | --- | --- |
| Defaults (proactive at 50% of the model window, normal tail) | none | partly run: the defaults were exercised by the 100k comparison with `triggerTokens` added |
| Only shake when Claude Code compacts (no proactive requests) | `"autoShake": "off"` | not run; the compaction path itself was run |
| Proactive request just before the engine's own automatic compaction | `"triggerTokens": "<engine threshold minus several thousand>"` | run with `"70000"` against an engine window of 100k tokens; the engine still compacted first once (see below) |
| Heavy tool output, reclaim more per pass | `"protectTokens": "8000", "minSavings": "2000"` | not run |
| Careful: keep more of the recent conversation | `"protectTokens": "30000", "minSavings": "8000"` | not run |
| Never summarize unprompted, never fall back to the built-in summarizer on a failed pass | `"fallback": "skip"` | skip answer run in unit tests; not run live |
| Low-threshold test rig (fires after about six file reads) | `"triggerTokens": "45000", "triggerPercent": "90", "cooldownTurns": "2", "protectTokens": "3000", "minSavings": "1000", "aggressiveProtectTokens": "500"` | run live (rounds 4 and 6) |
| Long-session experiment with the engine window at its minimum | launch with `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` and `"triggerTokens": "70000", "triggerPercent": "90", "cooldownTurns": "3"` | run live (round 4 Stage B) |

## Claude Code's own threshold

What is known:

- The engine's automatic compaction window can be lowered with the environment variable `CLAUDE_CODE_AUTO_COMPACT_WINDOW`; the
  documented minimum is 100000 tokens (checked by the tester against the Claude Code documentation).
- Measured with the window set to 100000: the engine's automatic compaction ran at 71253 and 71010 tokens (first compaction)
  and 67064 and 67116 tokens (second) in two sessions. So with that setting it fires roughly 29k to 33k tokens below the window.
- For the default window (the model's own limit, for example 200k) the threshold was **not measured**; no test ran long enough.
- The engine reports the figure itself: `$.session.usage({ breakdown: "summary" })` returns `autoCompactThreshold` (the token count
  at which automatic compaction runs, absent when it is off) and `isAutoCompactEnabled` (declarations, `SessionContextBreakdown`).
  CTRSCM does not read them yet. Making the proactive trigger relative to that figure (for example "this many tokens below the
  engine's threshold") would remove the guesswork in the table above; it is a candidate for the next spec.

## Commands

- `/ctrscm` prints the configuration in effect, the artifact directory, this session's totals (passes, results shaken,
  estimated tokens saved) and the last outcome.
- `/shake` queues an aggressive pass; it runs when the next turn completes.
- `/compact` keeps its normal meaning; with custom instructions it always goes to the built-in summarizer.

## What it logs

- `$.ui.log` lines in the session (they show in the interface): `CTRSCM: requesting proactive shake (context N%)`,
  `CTRSCM: shook N tool results (~T estimated tokens)`, option problems and failures. Counts and ids only, never tool-result text.
- **Advice:** when the context is at or above `adviseTokens` (default 150000) and no Shake pass was requested in that measurement, a toast and a
  log line say `CTRSCM: context is N tokens (advice threshold M); consider /compact or a new session`, at most once per `cooldownTurns` measurements.
  It never compacts by itself. `adviseTokens` 0 turns it off.
- **Usage log (persistent):** one small JSON file per event under `{artifact root}/usage/` (default `~/.ctrscm/artifacts/usage/`), named
  `{timestamp}-{uuid}.json`. Fields: time, session id, `event` (`shake` or `advice`), `label` (`proactive`, `aggressive`, `manual`, `auto`, `plugin`),
  `outcome` (`shook`, `skipped`, `fallback`, `failed`), `reason`, number of results, characters externalized, estimated tokens saved, artifact ids, and the
  context tokens and percent from the last measurement before the pass. No tool-result text, no tool input, no paths other than the folder itself.
  `usageLog` `off` switches the shake events off. If the artifact root cannot be resolved nothing is written (a rejected `HOME` lookup is logged).
- `/ctrscm` totals (and the usage location) show the running session only; the usage files are the record across sessions.
- The artifact directories under `artifactDir` hold what was shaken: one directory per result (`manifest.json` with the tool name, time and
  sizes, plus the chunk files).

Not built yet: a report that sums the usage files per session and shows context over time and cache effects (backlog B16). Until then the
files can be read directly (for example with `jq`); the cache numbers in `docs/verification.md` came from analyzing the session files.
