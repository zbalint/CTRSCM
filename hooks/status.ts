import { CONFIG_OPTION_NAMES, type Config } from './config'

export type Stats = {
  passes: number
  results: number
  savings: number
  last: string
}
export type EngineStatus =
  | {
      kind: 'ok'
      window: number
      tokens?: number
      percent?: number
      autoCompact?: { isEnabled: boolean; threshold?: number }
    }
  | { kind: 'unavailable'; reason: string }

export type OptionSources = {
  passed: number
  fromFile: number
  path: string | undefined
}

export function statusText(
  config: Config,
  root: string | undefined,
  stats: Stats,
  isPending: boolean,
  sources: OptionSources,
  engine: EngineStatus,
): string {
  const normalizedRoot = root?.replace(/\/+$/, '')
  const contextLine =
    engine.kind === 'unavailable'
      ? `context: unavailable (${engine.reason})`
      : engine.tokens === undefined
        ? `context: not measured yet (window ${engine.window})`
        : engine.percent === undefined
          ? `context: ${engine.tokens} tokens (window ${engine.window})`
          : `context: ${engine.tokens} tokens (${engine.percent}% of ${engine.window})`
  const engineLine =
    engine.kind === 'unavailable'
      ? 'engine compaction: unavailable'
      : engine.autoCompact === undefined
        ? 'engine compaction: unknown'
        : !engine.autoCompact.isEnabled
          ? 'engine compaction: auto off'
          : typeof engine.autoCompact.threshold !== 'number'
            ? 'engine compaction: unknown'
            : `engine compaction: auto at ${engine.autoCompact.threshold} tokens`
  // shortcut: compare only token thresholds; the trigger percent and engine threshold use different counters.
  const noteLine =
    engine.kind === 'ok' &&
    config.triggerTokens > 0 &&
    typeof engine.autoCompact?.threshold === 'number' &&
    config.triggerTokens >= engine.autoCompact.threshold
      ? `note: trigger tokens (${config.triggerTokens}) are at or above the engine threshold (${engine.autoCompact.threshold}); the engine may compact first`
      : undefined
  const statusLines = [
    'CTRSCM status',
    `auto: ${config.autoShake ? 'on' : 'off'} (trigger ${config.triggerPercent}% or ${config.triggerTokens} tokens, 0 = off; cooldown ${config.cooldownTurns} turns)`,
    `advice: at ${config.adviseTokens} tokens, 0 = off`,
    `idle shake: after ${config.idleShakeMinutes} min idle, 0 = off`,
    contextLine,
    engineLine,
    ...(noteLine === undefined ? [] : [noteLine]),
    `shake: protect ${config.protectTokens}, aggressive protect ${config.aggressiveProtectTokens}, min savings ${config.minSavings}, min result ${config.minResultTokens} (estimated tokens)`,
    `protected tools: ${config.protectedTools.length === 0 ? 'none' : config.protectedTools.join(', ')}`,
    `artifacts: ${normalizedRoot ?? 'unavailable (no HOME)'}`,
    `usage log: ${config.usageLog ? 'on' : 'off'} (${normalizedRoot === undefined ? 'unavailable (no HOME)' : `${normalizedRoot}/usage`})`,
    `options: ${sources.passed} passed, ${sources.fromFile} from file, ${Object.keys(CONFIG_OPTION_NAMES).length - sources.passed - sources.fromFile} default`,
    `config file: ${sources.path ?? 'none'}`,
    `this session: ${stats.passes} passes, ${stats.results} results shaken, ~${stats.savings} estimated tokens saved`,
    `last: ${stats.last}`,
    `pending: ${isPending ? 'aggressive shake' : 'none'}`,
  ]
  return statusLines.join('\n')
}
