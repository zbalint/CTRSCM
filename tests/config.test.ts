import { expect, test } from 'claude-code/testing'
import { DEFAULT_CONFIG, parseConfig } from '../hooks/config'

test('empty options retain the contract defaults', () => {
  expect(parseConfig({})).toEqual({
    config: {
      protectTokens: 16000,
      minSavings: 4000,
      minResultTokens: 200,
      protectedTools: ['Skill'],
      artifactDir: undefined,
      fallback: 'builtin',
      autoShake: true,
      triggerPercent: 50,
      triggerTokens: 0,
      cooldownTurns: 3,
      aggressiveProtectTokens: 4000,
    },
    problems: [],
  })
})

test('numeric strings and option collections are parsed', () => {
  expect(
    parseConfig({
      protectTokens: ' 120 ',
      minSavings: 99,
      minResultTokens: '7',
      protectedTools: ' Skill, Read, ,Bash ',
      artifactDir: ' /tmp/ctrscm ',
      fallback: 'skip',
    }),
  ).toEqual({
    config: {
      protectTokens: 120,
      minSavings: 99,
      minResultTokens: 7,
      protectedTools: ['Skill', 'Read', 'Bash'],
      artifactDir: '/tmp/ctrscm',
      fallback: 'skip',
      autoShake: true,
      triggerPercent: 50,
      triggerTokens: 0,
      cooldownTurns: 3,
      aggressiveProtectTokens: 4000,
    },
    problems: [],
  })
})

test('safe integer numeric boundaries are accepted or rejected', () => {
  expect(parseConfig({ protectTokens: Number.MAX_SAFE_INTEGER }).config.protectTokens).toBe(
    Number.MAX_SAFE_INTEGER,
  )
  expect(parseConfig({ protectTokens: Number.MAX_SAFE_INTEGER + 1 })).toEqual({
    config: { ...DEFAULT_CONFIG },
    problems: [
      'option protectTokens: must be a safe integer at least 0; using the default',
    ],
  })
})

test('protected tool arrays and an empty string are preserved intentionally', () => {
  expect(parseConfig({ protectedTools: ['Read', 'Bash'] }).config.protectedTools).toEqual([
    'Read',
    'Bash',
  ])
  expect(parseConfig({ protectedTools: '' }).config.protectedTools).toEqual([])
})

test('invalid numeric values keep defaults and report one problem each', () => {
  const parsed = parseConfig({
    protectTokens: 'abc',
    minSavings: -1,
    minResultTokens: 0,
  })
  expect(parsed.config).toEqual({
    protectTokens: 16000,
    minSavings: 4000,
    minResultTokens: 200,
    protectedTools: ['Skill'],
    artifactDir: undefined,
    fallback: 'builtin',
    autoShake: true,
    triggerPercent: 50,
    triggerTokens: 0,
    cooldownTurns: 3,
    aggressiveProtectTokens: 4000,
  })
  expect(parsed.problems).toEqual([
    'option protectTokens: must be a safe integer at least 0; using the default',
    'option minSavings: must be a safe integer at least 0; using the default',
    'option minResultTokens: must be a safe integer at least 1; using the default',
  ])
})

test('autoShake accepts on/off strings and booleans', () => {
  expect(parseConfig({ autoShake: 'off' }).config.autoShake).toBe(false)
  expect(parseConfig({ autoShake: 'ON ' }).config.autoShake).toBe(true)
  expect(parseConfig({ autoShake: false }).config.autoShake).toBe(false)
  expect(parseConfig({ autoShake: 'later' })).toEqual({
    config: { ...DEFAULT_CONFIG },
    problems: ['option autoShake: must be "on" or "off"; using the default'],
  })
})

test('proactive numeric options enforce their contract ranges', () => {
  expect(
    parseConfig({
      triggerPercent: '99',
      triggerTokens: '40000',
      cooldownTurns: 0,
      aggressiveProtectTokens: 123,
    }).config,
  ).toMatchObject({
    triggerPercent: 99,
    triggerTokens: 40000,
    cooldownTurns: 0,
    aggressiveProtectTokens: 123,
  })
  expect(parseConfig({ triggerPercent: '0' }).problems).toEqual([
    'option triggerPercent: must be a safe integer from 1 to 99; using the default',
  ])
  expect(parseConfig({ triggerPercent: '100' }).problems).toEqual([
    'option triggerPercent: must be a safe integer from 1 to 99; using the default',
  ])
  expect(parseConfig({ triggerPercent: 'abc' }).problems).toEqual([
    'option triggerPercent: must be a safe integer from 1 to 99; using the default',
  ])
  expect(parseConfig({ cooldownTurns: '-1' }).problems).toEqual([
    'option cooldownTurns: must be a safe integer at least 0; using the default',
  ])
})


test('invalid fallback keeps builtin and reports one problem', () => {
  expect(parseConfig({ fallback: 'later' })).toEqual({
    config: { ...DEFAULT_CONFIG },
    problems: ['option fallback: must be "builtin" or "skip"; using the default'],
  })
})
