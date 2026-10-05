import type { PluginOptions } from 'claude-code'

export type Config = {
  protectTokens: number
  minSavings: number
  minResultTokens: number
  protectedTools: readonly string[]
  artifactDir: string | undefined
  fallback: 'builtin' | 'skip'
}

export const DEFAULT_CONFIG: Config = {
  protectTokens: 16000,
  minSavings: 4000,
  minResultTokens: 200,
  protectedTools: ['Skill'],
  artifactDir: undefined,
  fallback: 'builtin',
}

export function parseConfig(options: PluginOptions): { config: Config; problems: string[] } {
  const config: Config = { ...DEFAULT_CONFIG }
  const problems: string[] = []

  const numericOption = (
    name: 'protectTokens' | 'minSavings' | 'minResultTokens',
    minimum: number,
  ): number => {
    const raw = options[name]
    if (raw === undefined) return DEFAULT_CONFIG[name]
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw.trim())
          : Number.NaN
    if (Number.isSafeInteger(value) && value >= minimum) return value
    const minimumText = minimum === 0 ? '0' : '1'
    problems.push(
      `option ${name}: must be a safe integer at least ${minimumText}; using the default`,
    )
    return DEFAULT_CONFIG[name]
  }

  config.protectTokens = numericOption('protectTokens', 0)
  config.minSavings = numericOption('minSavings', 0)
  config.minResultTokens = numericOption('minResultTokens', 1)

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
