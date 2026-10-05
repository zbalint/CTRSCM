import type { Config } from './config'

export const PROACTIVE_MARK = 'ctrscm:proactive'
export const AGGRESSIVE_MARK = 'ctrscm:aggressive'

export type Request = 'proactive' | 'aggressive'

export function markOf(request: Request): string {
  return request === 'proactive' ? PROACTIVE_MARK : AGGRESSIVE_MARK
}

export function requestOf(instructions: string | undefined): Request | undefined {
  if (instructions === PROACTIVE_MARK) return 'proactive'
  if (instructions === AGGRESSIVE_MARK) return 'aggressive'
  return undefined
}

export function decideRequest(
  context: { tokens?: number; percent?: number },
  config: Pick<Config, 'autoShake' | 'triggerPercent' | 'triggerTokens' | 'cooldownTurns'>,
  state: { cooldown: number; isPending: boolean },
): { request: Request | undefined; cooldown: number } {
  if (state.isPending) return { request: 'aggressive', cooldown: config.cooldownTurns }
  if (state.cooldown > 0) return { request: undefined, cooldown: state.cooldown - 1 }
  const tokenTrigger =
    config.triggerTokens > 0 && context.tokens !== undefined && context.tokens >= config.triggerTokens
  const percentTrigger = context.percent !== undefined && context.percent >= config.triggerPercent
  if (config.autoShake && (tokenTrigger || percentTrigger)) {
    return { request: 'proactive', cooldown: config.cooldownTurns }
  }
  return { request: undefined, cooldown: 0 }
}
