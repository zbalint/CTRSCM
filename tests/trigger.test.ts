import { expect, test } from 'claude-code/testing'
import { DEFAULT_CONFIG } from '../hooks/config'
import { AGGRESSIVE_MARK, PROACTIVE_MARK, decideRequest, markOf, requestOf } from '../hooks/trigger'

test('request marks round-trip exactly', () => {
  expect(PROACTIVE_MARK).toBe('ctrscm:proactive')
  expect(AGGRESSIVE_MARK).toBe('ctrscm:aggressive')
  expect(markOf('proactive')).toBe(PROACTIVE_MARK)
  expect(markOf('aggressive')).toBe(AGGRESSIVE_MARK)
  expect(requestOf(PROACTIVE_MARK)).toBe('proactive')
  expect(requestOf(AGGRESSIVE_MARK)).toBe('aggressive')
  expect(requestOf('')).toBeUndefined()
  expect(requestOf('ctrscm:proactive ')).toBeUndefined()
  expect(requestOf(undefined)).toBeUndefined()
})

test('pending requests aggressive and resets cooldown', () => {
  expect(decideRequest({ percent: 1 }, DEFAULT_CONFIG, { cooldown: 2, isPending: true })).toEqual({
    request: 'aggressive',
    cooldown: 3,
  })
})

test('cooldown decrements before thresholds are considered', () => {
  expect(decideRequest({ percent: 99 }, DEFAULT_CONFIG, { cooldown: 2, isPending: false })).toEqual({
    request: undefined,
    cooldown: 1,
  })
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

test('autoShake off suppresses threshold requests', () => {
  expect(
    decideRequest(
      { percent: 99, tokens: 40000 },
      { ...DEFAULT_CONFIG, autoShake: false, triggerTokens: 40000 },
      { cooldown: 0, isPending: false },
    ),
  ).toEqual({ request: undefined, cooldown: 0 })
})
