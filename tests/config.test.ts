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
  })
  expect(parsed.problems).toEqual([
    'option protectTokens: must be a safe integer at least 0; using the default',
    'option minSavings: must be a safe integer at least 0; using the default',
    'option minResultTokens: must be a safe integer at least 1; using the default',
  ])
})

test('invalid fallback keeps builtin and reports one problem', () => {
  expect(parseConfig({ fallback: 'later' })).toEqual({
    config: { ...DEFAULT_CONFIG },
    problems: ['option fallback: must be "builtin" or "skip"; using the default'],
  })
})
