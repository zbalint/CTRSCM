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

## Quick start with the 150k example

```sh
cd <repo>   # <repo> is your clone of this repository; use absolute paths below
claude --plugin-dir <repo> --settings <repo>/docs/examples/ctrscm-150k.json
```

The example (`docs/examples/ctrscm-150k.json`) requests a proactive Shake pass at 150000 tokens (`triggerPercent` 99 so the percentage trigger never
comes first), advice at 250000 tokens, the usual 16000-token protected tail and the usage log on. Type `/ctrscm` first: it must show
`auto: on (trigger 99% or 150000 tokens, ...)` and `advice: at 250000 tokens`. The live tests ran this file with `--setting-sources ''`
(isolation); combining `--settings` with your normal settings was not run, so if `/ctrscm` shows other numbers, the file was not picked up.

## Configuring it

Two routes. **Config file (spec 9):** put a flat JSON object in `~/.ctrscm/config.json` (`{"triggerTokens": 150000, "usageLog": "on"}`; strings,
numbers and booleans; README section "Config file"). It is read once per session and survives launches that lose `--settings`
(backlog B20). `/ctrscm` shows `options: N passed, M from file, K default` and the path. **Settings file:** options are strings
(defaults and meaning in the README options table); a settings file with `pluginConfigs`, passed on the launch command line. A passed
option wins over the config file per key. The settings route, which was run live:

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
        "minResultTokens": "1000",
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
- `protectTurns` (spec 14, default 0 = off) additionally protects everything from the Nth-from-last typed prompt onward, however large those turns are, so a turn that read a lot is not shaken
  and recovered minutes later. A typed prompt is a user message with text and no tool results; injected user text (hook reminders, channel messages) counts too. Either rule protects a result.
  `/shake` ignores `protectTurns`.
- `artifactDir` defaults to `$HOME/.ctrscm/artifacts`; a value must be an absolute path (spec 16: a relative one would resolve against each session's working directory and make placeholders unrecoverable after a resume elsewhere), otherwise it is ignored with a logged problem. Artifacts are plain copies of the shaken tool output (they can
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
  Since spec 10, `/ctrscm` reads them (a local estimate, no request) and prints `context:` and `engine compaction:` lines, plus a
  note when `triggerTokens` is at or above the threshold. Whether the live engine answers from a command hook, and the real threshold
  for the default window, are still to be read from a live `/ctrscm` (backlog B25). Making the proactive trigger relative to that
  figure (for example "this many tokens below the engine's threshold") is a candidate for a later spec, once the figure is known.

## Commands

- `/ctrscm` prints the configuration in effect, the context size and the engine's compaction threshold, the artifact directory, this session's totals (passes, results shaken,
  estimated tokens saved) and the last outcome.
- `/ctrscm report` prints the session's turn counts and the estimated cache effect of each Shake pass (spec 8). Since spec 11 each pass line is followed by a `measured:` line (context drop from the turn events' `contextTokens`, the extra cache write of the first turn after, and a pay-back in turns at assumed list-price ratios, write 2x and read 0.1x), shown once at least one turn before and two after carry a context figure. The first shook pass after the mod loads also logs a one-line hint that the report exists.
- `/shake` queues an aggressive pass; it runs when the next turn completes and ignores `minSavings` (spec 18).
- **Idle Shake (spec 12, off by default):** with `idleShakeMinutes` above 0, the first edit of the prompt box (a typed key or a paste) after that many minutes since the last answer, with no turn running, requests one Shake that ignores `minSavings` (`minResultTokens` and `protectTokens` still apply, and a context under 30000 tokens is left alone). The idea: after the prompt cache's lifetime (1 hour on the owner's account; the option is a number you set, for example 65) the next request rewrites the whole prefix anyway, so a smaller prefix is free. It runs while you are still typing; a rejection is logged and dropped, and the keystroke always goes through. Not covered: messages that arrive without any typing (phone, SDK, a2amx channel; a live probe showed an a2amx delivery reaches only `prompt.submit`, which refuses compaction, so nothing inside the mod can act on it), and non-composer origins (backlog B29). A resumed or forked session (spec 13) is seeded at start from the engine's own resume data (`classic.SessionStart`: seconds since the last response, context size, and whether the cache is likely expired), so the first edit after a long gap can idle-shake; whether the real host delivers that start event to a mod is unverified. The marked compaction from the prompt-box hook has run live in the real host (three passes in two sessions, `docs/verification.md` rounds 10 and 11); enable it in `~/.ctrscm/config.json` to try it.
- `/compact` keeps its normal meaning; with custom instructions it always goes to the built-in summarizer.

## Known limits

- **A turn can overshoot the trigger (backlog B26).** The proactive trigger, the advice and the idle pass act between turns. No hook inside a running turn can both see the
  context size and compact (a compaction requested from `session.measure` mid-turn is rejected by the host), so one turn of large reads can pass the trigger by a wide margin
  (round 9: ~111k to ~336k against a 150k trigger). The pass runs at the end of that turn. On a 1M window the engine's own compaction (967k) stays the backstop. Keep
  `protectTokens` and the trigger in mind when a task reads many large files in one turn.

## What it logs

- `$.ui.log` lines in the session (they show in the interface): `CTRSCM: requesting proactive shake (context N%)`,
  `CTRSCM: shook N tool results (~T estimated tokens)`, option problems and failures. Counts and ids only, never tool-result text.
- **Advice:** when the context is at or above `adviseTokens` (default 150000) and no Shake pass was requested in that measurement, a toast and a
  log line say `CTRSCM: context is N tokens (advice threshold M); consider /compact or a new session`, at most once per `cooldownTurns` measurements.
  It never compacts by itself. `adviseTokens` 0 turns it off.
- **Usage log (persistent):** one small JSON file per event under `{artifact root}/usage/` (default `~/.ctrscm/artifacts/usage/`), named
  `{timestamp}-{uuid}.json`. Fields: time, session id, `event` (`shake`, `advice` or `turn`; a `turn` event holds per-turn token counts, spec 8), `label` (`proactive`, `aggressive`, `idle`, `manual`, `auto`, `plugin`),
  `outcome` (`shook`, `skipped`, `fallback`, `failed`), `reason`, number of results, characters externalized, estimated tokens saved, artifact ids, and the
  context tokens and percent from the last measurement before the pass. Since spec 17: a `nothing worth shaking` skip also holds `eligibleSavings` (estimated tokens a pass could save; `0` means nothing was eligible, a positive value below `minSavings` means eligible but too small) and the `minSavings` it was tested against; a failed compaction holds `error` (the engine's message, at most 200 characters); and a refused request from `session.measure` writes a `defer` event (`kind`, `error`, `trackedTurns`, context) before the turn-end retry. A manual `/shake` is an aggressive pass: it ignores `minSavings` (spec 18; `protectTokens` becomes `aggressiveProtectTokens`, `minResultTokens` still applies) and logs one line when nothing is eligible. No tool-result text, no tool input, no paths other than the folder itself.
  `usageLog` `off` switches the shake events off. If the artifact root cannot be resolved nothing is written (a rejected `HOME` lookup is logged).
- `/ctrscm` totals (and the usage location) show the running session only (counted from when the mod was registered, so a resumed or continued session
  starts at 0 passes even when its transcript already holds placeholders from an earlier process); the usage files are the record across sessions.
- The artifact directories under `artifactDir` hold what was shaken: one directory per result (`manifest.json` with the tool name, time and
  sizes, plus the chunk files).
- **Cleaning up (manual, backlog B3):** the mod never deletes artifacts, because `$.fs` has no delete. Removing a directory makes every placeholder that names
  its id unrecoverable, so delete only artifacts older than any session you may still resume. List the candidates first, then remove them:
  `find ~/.ctrscm/artifacts -mindepth 1 -maxdepth 1 -type d -not -name usage -mtime +30` and add `-exec rm -rf {} +` once the list looks right
  (replace `~/.ctrscm/artifacts` with your `artifactDir` if you set one). Leave `usage/`, it is the record across sessions.

`/ctrscm report` (spec 8) sums the current session's events. Context over time and a category breakdown are not built (backlog B16, B19); older sessions can be read
directly from the files (for example with `jq`).
