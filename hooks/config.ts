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

export const CONFIG_OPTION_NAMES = {
  protectTokens: true,
  minSavings: true,
  minResultTokens: true,
  protectedTools: true,
  artifactDir: true,
  fallback: true,
  autoShake: true,
  triggerPercent: true,
  triggerTokens: true,
  adviseTokens: true,
  usageLog: true,
  cooldownTurns: true,
  aggressiveProtectTokens: true,
} as const

function isBlankOption(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === ''
}

function isFileOptionValue(value: unknown): value is string | number | boolean | readonly string[] {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

export function mergeOptions(
  passedOptions: PluginOptions,
  file: Record<string, unknown>,
): { options: PluginOptions; passed: number; fromFile: number } {
  const options: Record<string, string | number | boolean | readonly string[]> = {}
  let passed = 0
  let fromFile = 0
  for (const name of Object.keys(CONFIG_OPTION_NAMES)) {
    const passedValue = passedOptions[name]
    if (passedValue !== undefined && !isBlankOption(passedValue)) {
      options[name] = passedValue
      passed += 1
      continue
    }
    if (
      Object.prototype.hasOwnProperty.call(file, name) &&
      !isBlankOption(file[name]) &&
      isFileOptionValue(file[name])
    ) {
      options[name] = file[name]
      fromFile += 1
    }
  }
  return { options, passed, fromFile }
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
    if (raw === undefined || isBlankOption(raw)) return DEFAULT_CONFIG[name]
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
  if (isBlankOption(autoShake)) {
    config.autoShake = DEFAULT_CONFIG.autoShake
  } else if (typeof autoShake === 'boolean') {
    config.autoShake = autoShake
  } else if (typeof autoShake === 'string' && (autoShake.trim().toLowerCase() === 'on' || autoShake.trim().toLowerCase() === 'off')) {
    config.autoShake = autoShake.trim().toLowerCase() === 'on'
  } else if (autoShake !== undefined) {
    problems.push('option autoShake: must be "on" or "off"; using the default')
  }

  const usageLog = options.usageLog
  if (isBlankOption(usageLog)) {
    config.usageLog = DEFAULT_CONFIG.usageLog
  } else if (typeof usageLog === 'boolean') {
    config.usageLog = usageLog
  } else if (typeof usageLog === 'string' && (usageLog.trim().toLowerCase() === 'on' || usageLog.trim().toLowerCase() === 'off')) {
    config.usageLog = usageLog.trim().toLowerCase() === 'on'
  } else if (usageLog !== undefined) {
    problems.push('option usageLog: must be "on" or "off"; using the default')
  }

  const protectedTools = options.protectedTools
  if (isBlankOption(protectedTools)) {
    config.protectedTools = DEFAULT_CONFIG.protectedTools
  } else if (typeof protectedTools === 'string') {
    const normalized = protectedTools.trim()
    config.protectedTools =
      normalized.toLowerCase() === 'none'
        ? []
        : normalized
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
  if (isBlankOption(fallback)) {
    config.fallback = DEFAULT_CONFIG.fallback
  } else if (fallback === 'builtin' || fallback === 'skip') {
    config.fallback = fallback
  } else if (fallback !== undefined) {
    problems.push('option fallback: must be "builtin" or "skip"; using the default')
  }

  return { config, problems }
}
