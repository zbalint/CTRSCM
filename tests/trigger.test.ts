import { expect, test } from 'claude-code/testing'
import { DEFAULT_CONFIG } from '../hooks/config'
import { AGGRESSIVE_MARK, ESCALATE_MARK, PROACTIVE_MARK, decideAdvice, decideRequest, isOverTrigger, markOf, requestOf } from '../hooks/trigger'

test('request marks round-trip exactly', () => {
  expect(PROACTIVE_MARK).toBe('ctrscm:proactive')
  expect(AGGRESSIVE_MARK).toBe('ctrscm:aggressive')
  expect(ESCALATE_MARK).toBe('ctrscm:escalate')
  expect(markOf('proactive')).toBe(PROACTIVE_MARK)
  expect(markOf('aggressive')).toBe(AGGRESSIVE_MARK)
  expect(markOf('escalate')).toBe(ESCALATE_MARK)
  expect(requestOf(PROACTIVE_MARK)).toBe('proactive')
  expect(requestOf(AGGRESSIVE_MARK)).toBe('aggressive')
  expect(requestOf(ESCALATE_MARK)).toBe('escalate')
  expect(requestOf('')).toBeUndefined()
  expect(requestOf('ctrscm:proactive ')).toBeUndefined()
  expect(requestOf(undefined)).toBeUndefined()
})

test('idle request marks round-trip exactly', () => {
  expect(markOf('idle')).toBe('ctrscm:idle')
  expect(requestOf('ctrscm:idle')).toBe('idle')
})

test('trigger predicate respects measured edges, disabled tokens, and autoShake', () => {
  const config = { autoShake: true, triggerTokens: 40000, triggerPercent: 90 }
  expect(isOverTrigger({}, config)).toBe(false)
  expect(isOverTrigger({ tokens: 39999, percent: 89 }, config)).toBe(false)
  expect(isOverTrigger({ tokens: 40000, percent: 89 }, config)).toBe(true)
  expect(isOverTrigger({ tokens: 39999, percent: 90 }, config)).toBe(true)
  expect(isOverTrigger({ tokens: 40000 }, { ...config, triggerTokens: 0 })).toBe(false)
  expect(isOverTrigger({ tokens: 40000, percent: 90 }, { ...config, autoShake: false })).toBe(false)
})

test('pending requests aggressive and resets cooldown', () => {
  expect(decideRequest({ percent: 1 }, DEFAULT_CONFIG, { cooldown: 2, isPending: true })).toEqual({
    request: 'aggressive',
    cooldown: 3,
  })
})

test('cooldown stays unchanged before thresholds are considered', () => {
  expect(decideRequest({ percent: 99 }, DEFAULT_CONFIG, { cooldown: 2, isPending: false })).toEqual({
    request: undefined,
    cooldown: 2,
  })
})

test('request decision order keeps pending, escalation, gate, and proactive branches distinct', () => {
  const config = { ...DEFAULT_CONFIG, triggerPercent: 50, triggerTokens: 40000 }
  expect(decideRequest({ percent: 60, tokens: 50000 }, config, {
    cooldown: 2,
    isPending: true,
    escalate: true,
    minTokens: 90000,
  })).toEqual({ request: 'aggressive', cooldown: 3 })
  expect(decideRequest({ percent: 60, tokens: 50000 }, config, {
    cooldown: 2,
    isPending: false,
    escalate: true,
    minTokens: 90000,
  })).toEqual({ request: 'escalate', cooldown: 3 })
  expect(decideRequest({ percent: 40, tokens: 30000 }, config, {
    cooldown: 0,
    isPending: false,
    escalate: true,
  })).toEqual({ request: undefined, cooldown: 0 })
  expect(decideRequest({ percent: 60, tokens: 50000 }, config, {
    cooldown: 0,
    isPending: false,
    minTokens: 50001,
  })).toEqual({ request: undefined, cooldown: 0 })
  expect(decideRequest({ percent: 60, tokens: 50001 }, config, {
    cooldown: 0,
    isPending: false,
    minTokens: 50001,
  })).toEqual({ request: 'proactive', cooldown: 3 })
  expect(decideRequest({ percent: 60, tokens: 50000 }, config, {
    cooldown: 0,
    isPending: false,
  })).toEqual({ request: 'proactive', cooldown: 3 })
})

test('percent and token thresholds trigger only when figures are reported', () => {
  expect(decideRequest({ percent: 49 }, DEFAULT_CONFIG, { cooldown: 0, isPending: false })).toEqual({
    request: undefined,
    cooldown: 0,
  })
  expect(decideRequest({ percent: 50 }, DEFAULT_CONFIG, { cooldown: 0, isPending: false })).toEqual({
    request: 'proactive',
    cooldown: 3,
  })
  expect(
    decideRequest(
      { tokens: 40000 },
      { ...DEFAULT_CONFIG, triggerPercent: 99, triggerTokens: 40000 },
      { cooldown: 0, isPending: false },
    ),
  ).toEqual({ request: 'proactive', cooldown: 3 })
  expect(
    decideRequest(
      { tokens: 40000 },
      { ...DEFAULT_CONFIG, triggerPercent: 99, triggerTokens: 0 },
      { cooldown: 0, isPending: false },
    ),
  ).toEqual({ request: undefined, cooldown: 0 })
  expect(
    decideRequest(
      {},
      { ...DEFAULT_CONFIG, triggerPercent: 50, triggerTokens: 40000 },
      { cooldown: 0, isPending: false },
    ),
  ).toEqual({ request: undefined, cooldown: 0 })
})

test('advice thresholds and cooldowns follow the literal sequence', () => {
  const config = { adviseTokens: 150000, cooldownTurns: 3 }
  expect(decideAdvice({ tokens: undefined }, config, { cooldown: 0 })).toEqual({ advise: false, cooldown: 0 })
  expect(decideAdvice({ tokens: 149999 }, config, { cooldown: 0 })).toEqual({ advise: false, cooldown: 0 })
  expect(decideAdvice({ tokens: 150000 }, config, { cooldown: 0 })).toEqual({ advise: true, cooldown: 3 })
  expect(decideAdvice({ tokens: 160000 }, config, { cooldown: 3 })).toEqual({ advise: false, cooldown: 3 })
  expect(decideAdvice({ tokens: 160000 }, config, { cooldown: 2 })).toEqual({ advise: false, cooldown: 2 })
  expect(decideAdvice({ tokens: 160000 }, config, { cooldown: 1 })).toEqual({ advise: false, cooldown: 1 })
  expect(decideAdvice({ tokens: 160000 }, config, { cooldown: 0 })).toEqual({ advise: true, cooldown: 3 })
  expect(decideAdvice({ tokens: 160000 }, { adviseTokens: 0, cooldownTurns: 3 }, { cooldown: 2 })).toEqual({
    advise: false,
    cooldown: 0,
  })
})

test('autoShake off suppresses threshold requests', () => {
  expect(
    decideRequest(
      { percent: 99, tokens: 40000 },
      { ...DEFAULT_CONFIG, autoShake: false, triggerTokens: 40000 },
      { cooldown: 0, isPending: false },
    ),
  ).toEqual({ request: undefined, cooldown: 0 })
})
