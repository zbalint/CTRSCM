import { expect, test } from 'claude-code/testing'
import { DEFAULT_CONFIG, mergeOptions, parseConfig } from '../hooks/config'

test('empty options retain the contract defaults', () => {
  expect(parseConfig({})).toEqual({
    config: {
      protectTokens: 16000,
      protectTurns: 0,
      minSavings: 4000,
      minResultTokens: 1000,
      protectedTools: ['Skill'],
      artifactDir: undefined,
      fallback: 'builtin',
      autoShake: true,
      triggerPercent: 50,
      triggerTokens: 120000,
      adviseTokens: 150000,
      idleShakeMinutes: 0,
      usageLog: true,
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
      protectTurns: 0,
      minSavings: 99,
      minResultTokens: 7,
      protectedTools: ['Skill', 'Read', 'Bash'],
      artifactDir: '/tmp/ctrscm',
      fallback: 'skip',
      autoShake: true,
      triggerPercent: 50,
      triggerTokens: 120000,
      adviseTokens: 150000,
      idleShakeMinutes: 0,
      usageLog: true,
      cooldownTurns: 3,
      aggressiveProtectTokens: 4000,
    },
    problems: [],
  })
})

for (const artifactDir of ['ctrscm-artifacts', './x', '~/x']) {
  test(`relative artifactDir ${artifactDir} uses the default and reports a problem`, () => {
    expect(parseConfig({ artifactDir })).toEqual({
      config: { ...DEFAULT_CONFIG },
      problems: ['option artifactDir: must be an absolute path; using the default'],
    })
  })
}

test('whitespace-only artifactDir uses the default without a problem', () => {
  expect(parseConfig({ artifactDir: ' \t\n ' })).toEqual({
    config: { ...DEFAULT_CONFIG },
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

test('protectTurns parses nonnegative safe integers and reports invalid values', () => {
  expect(parseConfig({ protectTurns: '2' }).config.protectTurns).toBe(2)
  expect(parseConfig({ protectTurns: 'abc' })).toEqual({
    config: { ...DEFAULT_CONFIG },
    problems: ['option protectTurns: must be a safe integer at least 0; using the default'],
  })
  expect(parseConfig({ protectTurns: -1 })).toEqual({
    config: { ...DEFAULT_CONFIG },
    problems: ['option protectTurns: must be a safe integer at least 0; using the default'],
  })
  expect(parseConfig({ protectTurns: ' ' })).toEqual({ config: { ...DEFAULT_CONFIG }, problems: [] })
})

test('protected tool arrays are preserved and a blank string leaves Skill protected', () => {
  expect(parseConfig({ protectedTools: ['Read', 'Bash'] }).config.protectedTools).toEqual([
    'Read',
    'Bash',
  ])
  expect(parseConfig({ protectedTools: '' }).config.protectedTools).toEqual(['Skill'])
  expect(parseConfig({ protectedTools: 'none' }).config.protectedTools).toEqual([])
})

test('invalid numeric values keep defaults and report one problem each', () => {
  const parsed = parseConfig({
    protectTokens: 'abc',
    minSavings: -1,
    minResultTokens: 0,
  })
  expect(parsed.config).toEqual({
    protectTokens: 16000,
    protectTurns: 0,
    minSavings: 4000,
    minResultTokens: 1000,
    protectedTools: ['Skill'],
    artifactDir: undefined,
    fallback: 'builtin',
    autoShake: true,
    triggerPercent: 50,
    triggerTokens: 120000,
    adviseTokens: 150000,
    idleShakeMinutes: 0,
    usageLog: true,
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

test('advice and usage options parse their literal forms and problems', () => {
  expect(parseConfig({ adviseTokens: '0' }).config.adviseTokens).toBe(0)
  expect(parseConfig({ adviseTokens: '150000', usageLog: 'off' }).config).toMatchObject({
    adviseTokens: 150000,
    usageLog: false,
  })
  expect(parseConfig({ usageLog: 'ON ' }).config.usageLog).toBe(true)
  expect(parseConfig({ usageLog: false }).config.usageLog).toBe(false)
  expect(parseConfig({ adviseTokens: 'abc' })).toEqual({
    config: { ...DEFAULT_CONFIG },
    problems: ['option adviseTokens: must be a safe integer at least 0; using the default'],
  })
  expect(parseConfig({ adviseTokens: -1 })).toEqual({
    config: { ...DEFAULT_CONFIG },
    problems: ['option adviseTokens: must be a safe integer at least 0; using the default'],
  })
  expect(parseConfig({ usageLog: 'later' })).toEqual({
    config: { ...DEFAULT_CONFIG },
    problems: ['option usageLog: must be "on" or "off"; using the default'],
  })
})

test('idle Shake minutes accepts zero, positive integers, and reports invalid values', () => {
  expect(parseConfig({ idleShakeMinutes: '65' }).config.idleShakeMinutes).toBe(65)
  expect(parseConfig({ idleShakeMinutes: '0' }).config.idleShakeMinutes).toBe(0)
  expect(parseConfig({ idleShakeMinutes: 'abc' })).toEqual({
    config: { ...DEFAULT_CONFIG },
    problems: ['option idleShakeMinutes: must be a safe integer at least 0; using the default'],
  })
  expect(parseConfig({ idleShakeMinutes: -1 })).toEqual({
    config: { ...DEFAULT_CONFIG },
    problems: ['option idleShakeMinutes: must be a safe integer at least 0; using the default'],
  })
  expect(parseConfig({ idleShakeMinutes: ' ' })).toEqual({ config: { ...DEFAULT_CONFIG }, problems: [] })
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

test('blank options retain every built-in default without problems', () => {
  expect(parseConfig({
    protectTokens: '',
    minSavings: ' ',
    minResultTokens: '\t',
    protectedTools: ' \n ',
    artifactDir: '',
    protectTurns: ' ',
    fallback: ' ',
    autoShake: '',
    triggerPercent: ' ',
    triggerTokens: '',
    adviseTokens: '\n',
    idleShakeMinutes: ' ',
    aggressiveProtectTokens: ' ',
    usageLog: '\t',
  })).toEqual({ config: { ...DEFAULT_CONFIG }, problems: [] })
})

test('mergeOptions gives passed values priority and counts each source', () => {
  const merged = mergeOptions(
    { triggerTokens: '170000', adviseTokens: '', protectedTools: 'none' },
    { triggerTokens: '150000', adviseTokens: '250000', protectedTools: ['Read'], minSavings: 99, artifactDir: '', fallback: ' ' },
  )
  expect(merged).toEqual({
    options: {
      triggerTokens: '170000',
      adviseTokens: '250000',
      protectedTools: 'none',
      minSavings: 99,
    },
    passed: 2,
    fromFile: 2,
  })
  expect(parseConfig(merged.options).config).toMatchObject({
    triggerTokens: 170000,
    adviseTokens: 250000,
    protectedTools: [],
    minSavings: 99,
  })
})

test('an invalid passed value is not rescued by the file', () => {
  const merged = mergeOptions({ triggerTokens: 'later' }, { triggerTokens: '150000' })
  expect(parseConfig(merged.options)).toEqual({
    config: { ...DEFAULT_CONFIG },
    problems: ['option triggerTokens: must be a safe integer at least 0; using the default'],
  })
})
