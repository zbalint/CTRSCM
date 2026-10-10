import type { Config } from './config'

export const PROACTIVE_MARK = 'ctrscm:proactive'
export const AGGRESSIVE_MARK = 'ctrscm:aggressive'
export const IDLE_MARK = 'ctrscm:idle'
export const ESCALATE_MARK = 'ctrscm:escalate'

export type Request = 'proactive' | 'aggressive' | 'idle' | 'escalate'

const REQUEST_MARKS: Record<Request, string> = {
  proactive: PROACTIVE_MARK,
  aggressive: AGGRESSIVE_MARK,
  idle: IDLE_MARK,
  escalate: ESCALATE_MARK,
}

export function markOf(request: Request): string {
  return REQUEST_MARKS[request]
}

export function requestOf(instructions: string | undefined): Request | undefined {
  if (instructions === PROACTIVE_MARK) return 'proactive'
  if (instructions === AGGRESSIVE_MARK) return 'aggressive'
  if (instructions === IDLE_MARK) return 'idle'
  if (instructions === ESCALATE_MARK) return 'escalate'
  return undefined
}

export function isOverTrigger(
  context: { tokens?: number; percent?: number },
  config: Pick<Config, 'autoShake' | 'triggerPercent' | 'triggerTokens'>,
): boolean {
  const tokenTrigger =
    config.triggerTokens > 0 && context.tokens !== undefined && context.tokens >= config.triggerTokens
  const percentTrigger = context.percent !== undefined && context.percent >= config.triggerPercent
  return config.autoShake && (tokenTrigger || percentTrigger)
}

export function decideRequest(
  context: { tokens?: number; percent?: number },
  config: Pick<Config, 'autoShake' | 'triggerPercent' | 'triggerTokens' | 'cooldownTurns'>,
  state: { cooldown: number; isPending: boolean; escalate?: boolean; minTokens?: number },
): { request: Request | undefined; cooldown: number } {
  if (state.isPending) return { request: 'aggressive', cooldown: config.cooldownTurns }
  if (state.escalate === true && isOverTrigger(context, config)) {
    return { request: 'escalate', cooldown: config.cooldownTurns }
  }
  if (state.cooldown > 0) return { request: undefined, cooldown: state.cooldown }
  if (isOverTrigger(context, config)) {
    if (state.minTokens !== undefined && context.tokens !== undefined && context.tokens < state.minTokens) {
      return { request: undefined, cooldown: 0 }
    }
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
  if (state.cooldown > 0) return { advise: false, cooldown: state.cooldown }
  if (context.tokens >= config.adviseTokens) return { advise: true, cooldown: config.cooldownTurns }
  return { advise: false, cooldown: 0 }
}
