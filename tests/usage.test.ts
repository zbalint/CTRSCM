import { expect, test } from 'claude-code/testing'
import { usageEventPath } from '../hooks/usage'

test('usageEventPath strips the artifact root slash and stamps the event filename', () => {
  expect(
    usageEventPath(
      '/home/example/.ctrscm/artifacts/',
      '2026-10-05T00:00:00.000Z',
      'u-1',
    ),
  ).toBe(
    '/home/example/.ctrscm/artifacts/usage/2026-10-05T00-00-00-000Z-u-1.json',
  )
})
