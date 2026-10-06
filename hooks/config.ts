import type { PluginOptions } from 'claude-code'

export type Config = {
  protectTokens: number
  minSavings: number
  minResultTokens: number
  protectedTools: readonly string[]
  artifactDir: string | undefined
  fallback: 'builtin' | 'skip'
  autoShake: boolean
  triggerPercent: number
  triggerTokens: number
  adviseTokens: number
  cooldownTurns: number
  aggressiveProtectTokens: number
  usageLog: boolean
}

export const DEFAULT_CONFIG: Config = {
  protectTokens: 16000,
  minSavings: 4000,
  minResultTokens: 1000,
  protectedTools: ['Skill'],
  artifactDir: undefined,
  fallback: 'builtin',
  autoShake: true,
  triggerPercent: 50,
  triggerTokens: 120000,
  adviseTokens: 150000,
  cooldownTurns: 3,
  aggressiveProtectTokens: 4000,
  usageLog: true,
}

export function parseConfig(options: PluginOptions): { config: Config; problems: string[] } {
  const config: Config = { ...DEFAULT_CONFIG }
  const problems: string[] = []

  const numericOption = (
    name:
      | 'protectTokens'
      | 'minSavings'
      | 'minResultTokens'
      | 'triggerPercent'
      | 'triggerTokens'
      | 'cooldownTurns'
      | 'adviseTokens'
      | 'aggressiveProtectTokens',
    minimum: number,
    maximum: number | undefined,
    reason: string,
  ): number => {
    const raw = options[name]
    if (raw === undefined) return DEFAULT_CONFIG[name]
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw.trim())
          : Number.NaN
    if (
      Number.isSafeInteger(value) &&
      value >= minimum &&
      (maximum === undefined || value <= maximum)
    ) return value
    problems.push(`option ${name}: ${reason}; using the default`)
    return DEFAULT_CONFIG[name]
  }

  config.protectTokens = numericOption('protectTokens', 0, undefined, 'must be a safe integer at least 0')
  config.minSavings = numericOption('minSavings', 0, undefined, 'must be a safe integer at least 0')
  config.minResultTokens = numericOption('minResultTokens', 1, undefined, 'must be a safe integer at least 1')
  config.triggerPercent = numericOption('triggerPercent', 1, 99, 'must be a safe integer from 1 to 99')
  config.triggerTokens = numericOption('triggerTokens', 0, undefined, 'must be a safe integer at least 0')
  config.adviseTokens = numericOption('adviseTokens', 0, undefined, 'must be a safe integer at least 0')
  config.cooldownTurns = numericOption('cooldownTurns', 0, undefined, 'must be a safe integer at least 0')
  config.aggressiveProtectTokens = numericOption(
    'aggressiveProtectTokens',
    0,
    undefined,
    'must be a safe integer at least 0',
  )

  const autoShake = options.autoShake
  if (typeof autoShake === 'boolean') {
    config.autoShake = autoShake
  } else if (typeof autoShake === 'string' && (autoShake.trim().toLowerCase() === 'on' || autoShake.trim().toLowerCase() === 'off')) {
    config.autoShake = autoShake.trim().toLowerCase() === 'on'
  } else if (autoShake !== undefined) {
    problems.push('option autoShake: must be "on" or "off"; using the default')
  }

  const usageLog = options.usageLog
  if (typeof usageLog === 'boolean') {
    config.usageLog = usageLog
  } else if (typeof usageLog === 'string' && (usageLog.trim().toLowerCase() === 'on' || usageLog.trim().toLowerCase() === 'off')) {
    config.usageLog = usageLog.trim().toLowerCase() === 'on'
  } else if (usageLog !== undefined) {
    problems.push('option usageLog: must be "on" or "off"; using the default')
  }

  const protectedTools = options.protectedTools
  if (typeof protectedTools === 'string') {
    config.protectedTools = protectedTools
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
  } else if (Array.isArray(protectedTools)) {
    config.protectedTools = protectedTools.slice()
  }

  const artifactDir = options.artifactDir
  config.artifactDir =
    typeof artifactDir === 'string' && artifactDir.trim() !== ''
      ? artifactDir.trim()
      : undefined

  const fallback = options.fallback
  if (fallback === 'builtin' || fallback === 'skip') {
    config.fallback = fallback
  } else if (fallback !== undefined) {
    problems.push('option fallback: must be "builtin" or "skip"; using the default')
  }

  return { config, problems }
}
