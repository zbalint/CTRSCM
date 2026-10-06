export type UsageEvent = {
  version: 1
  at: string
  sessionId: string | null
  agentId: string | null
  event: 'shake' | 'advice'
  label: string | null
  outcome: 'shook' | 'skipped' | 'fallback' | 'failed' | null
  reason: string | null
  results: number
  chars: number
  estimatedSavings: number
  artifactIds: string[]
  contextTokens: number | null
  contextPercent: number | null
  adviseTokens: number | null
}

export type TurnUsageEvent = {
  version: 1
  at: string
  sessionId: string | null
  agentId: string | null
  event: 'turn'
  reason: string
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheCreationTokens: number | null
  cacheReadTokens: number | null
  contextTokens: number | null
  contextPercent: number | null
  sessionCostUsd: number | null
}

export function usageEventPath(root: string, at: string, uuid: string): string {
  const base = root.replace(/\/+$/, '')
  const stamp = at.replace(/[:.]/g, '-')
  return `${base}/usage/${stamp}-${uuid}.json`
}
