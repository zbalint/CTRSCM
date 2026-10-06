import { expect, test } from 'claude-code/testing'
import { readConfigFile } from '../hooks/configFile'

const path = '/home/example/.ctrscm/config.json'

test('a missing config file is silent', async () => {
  const result = await readConfigFile(
    {
      stat: async () => {
        throw new Error('missing')
      },
      read: async () => '{}',
    },
    '/home/example',
  )
  expect(result).toEqual({ logs: [] })
})

test('a directory or unreadable config file is ignored without details', async () => {
  const directory = await readConfigFile(
    {
      stat: async (candidate) => {
        expect(candidate).toBe(path)
        return { kind: 'dir' }
      },
      read: async () => '{}',
    },
    '/home/example',
  )
  expect(directory).toEqual({ logs: ['CTRSCM: config file ignored: unreadable'] })

  const unreadable = await readConfigFile(
    {
      stat: async () => ({ kind: 'file' }),
      read: async () => {
        throw new Error('secret details must not escape')
      },
    },
    '/home/example',
  )
  expect(unreadable).toEqual({ logs: ['CTRSCM: config file ignored: unreadable'] })
})

test('invalid JSON and non-object JSON are ignored', async () => {
  const notJson = await readConfigFile(
    { stat: async () => ({ kind: 'file' }), read: async () => 'not json' },
    '/home/example',
  )
  expect(notJson).toEqual({ logs: ['CTRSCM: config file ignored: not JSON'] })

  const array = await readConfigFile(
    { stat: async () => ({ kind: 'file' }), read: async () => '[]' },
    '/home/example',
  )
  expect(array).toEqual({ logs: ['CTRSCM: config file ignored: not an object'] })
})

test('known values are normalized and unknown keys are logged', async () => {
  const result = await readConfigFile(
    {
      stat: async () => ({ kind: 'file' }),
      read: async () => JSON.stringify({ unknown: 'secret', triggerTokens: 150000, protectedTools: [] }),
    },
    '/home/example',
  )
  expect(result).toEqual({
    file: { triggerTokens: '150000', protectedTools: [] },
    logs: ['CTRSCM: config file option unknown: unknown'],
  })
})

test('HOME unavailable is reported without reading a path', async () => {
  let read = false
  const result = await readConfigFile(
    {
      stat: async () => ({ kind: 'file' }),
      read: async () => {
        read = true
        return '{}'
      },
    },
    undefined,
  )
  expect(result).toEqual({ logs: ['CTRSCM: config file skipped: HOME unavailable'] })
  expect(read).toBe(false)
})

test('invalid config value types are skipped and named without values', async () => {
  const result = await readConfigFile(
    {
      stat: async () => ({ kind: 'file' }),
      read: async () => JSON.stringify({ triggerTokens: null, protectedTools: ['Read', 3] }),
    },
    '/home/example',
  )
  expect(result).toEqual({
    file: {},
    logs: [
      'CTRSCM: config file option triggerTokens: invalid',
      'CTRSCM: config file option protectedTools: invalid',
    ],
  })
})
