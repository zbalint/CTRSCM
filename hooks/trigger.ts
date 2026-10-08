import type { Config } from './config'

export const PROACTIVE_MARK = 'ctrscm:proactive'
export const AGGRESSIVE_MARK = 'ctrscm:aggressive'
export const IDLE_MARK = 'ctrscm:idle'

export type Request = 'proactive' | 'aggressive' | 'idle'

const REQUEST_MARKS: Record<Request, string> = {
  proactive: PROACTIVE_MARK,
  aggressive: AGGRESSIVE_MARK,
  idle: IDLE_MARK,
}

export function markOf(request: Request): string {
  return REQUEST_MARKS[request]
}

export function requestOf(instructions: string | undefined): Request | undefined {
  if (instructions === PROACTIVE_MARK) return 'proactive'
  if (instructions === AGGRESSIVE_MARK) return 'aggressive'
  if (instructions === IDLE_MARK) return 'idle'
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

export function decideAdvice(
  context: { tokens?: number },
  config: Pick<Config, 'adviseTokens' | 'cooldownTurns'>,
  state: { cooldown: number },
): { advise: boolean; cooldown: number } {
  if (config.adviseTokens === 0 || context.tokens === undefined) return { advise: false, cooldown: 0 }
  if (state.cooldown > 0) return { advise: false, cooldown: state.cooldown - 1 }
  if (context.tokens >= config.adviseTokens) return { advise: true, cooldown: config.cooldownTurns }
  return { advise: false, cooldown: 0 }
}
