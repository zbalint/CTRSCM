import { CONFIG_OPTION_NAMES, type Config } from './config'

export type Stats = {
  passes: number
  results: number
  savings: number
  last: string
}
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
): string {
  const normalizedRoot = root?.replace(/\/+$/, '')
  return [
    'CTRSCM status',
    `auto: ${config.autoShake ? 'on' : 'off'} (trigger ${config.triggerPercent}% or ${config.triggerTokens} tokens, 0 = off; cooldown ${config.cooldownTurns} turns)`,
    `advice: at ${config.adviseTokens} tokens, 0 = off`,
    `shake: protect ${config.protectTokens}, aggressive protect ${config.aggressiveProtectTokens}, min savings ${config.minSavings}, min result ${config.minResultTokens} (estimated tokens)`,
    `protected tools: ${config.protectedTools.length === 0 ? 'none' : config.protectedTools.join(', ')}`,
    `artifacts: ${normalizedRoot ?? 'unavailable (no HOME)'}`,
    `usage log: ${config.usageLog ? 'on' : 'off'} (${normalizedRoot === undefined ? 'unavailable (no HOME)' : `${normalizedRoot}/usage`})`,
    `options: ${sources.passed} passed, ${sources.fromFile} from file, ${Object.keys(CONFIG_OPTION_NAMES).length - sources.passed - sources.fromFile} default`,
    `config file: ${sources.path ?? 'none'}`,
    `this session: ${stats.passes} passes, ${stats.results} results shaken, ~${stats.savings} estimated tokens saved`,
    `last: ${stats.last}`,
    `pending: ${isPending ? 'aggressive shake' : 'none'}`,
  ].join('\n')
}
