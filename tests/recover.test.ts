import { expect, test } from 'claude-code/testing'
import { recoverResult, RECOVER_DESCRIPTION, RECOVER_NAME, RECOVER_SCHEMA } from '../hooks/recover'
import type { Fs } from '../hooks/artifacts'

const id = '123e4567-e89b-12d3-a456-426614174000'
function artifactFs(text = '0123456789'): Fs {
  const manifest = JSON.stringify({
    version: 1,
    id,
    agentId: null,
    toolUseId: 'tu1',
    toolName: 'Bash',
    createdAt: '2026-10-05T00:00:00.000Z',
    totalChars: text.length,
    chunkChars: [text.length],
  })
  return {
    read: async (path) => {
      if (path.endsWith('/manifest.json')) return manifest
      if (path.endsWith('/chunk-0000.txt')) return text
      throw new Error('missing')
    },
    write: async () => {},
  }
}

test('recovery defaults to an 8000-character page and accepts the 20000-character maximum', async () => {
  const text = 'x'.repeat(20001)
  const defaultPage = await recoverResult(artifactFs(text), '/tmp', { id })
  if (!('result' in defaultPage)) throw new Error('expected a default recovery page')
  expect(defaultPage.result.split('\n').slice(0, 4).join('\n')).toBe(
    'CTRSCM artifact 123e4567-e89b-12d3-a456-426614174000\ntool: Bash\nrange: 0..7999 of 20001 chars\nmore: true',
  )
  const maximumPage = await recoverResult(artifactFs(text), '/tmp', { id, maxChars: 20000 })
  if (!('result' in maximumPage)) throw new Error('expected a maximum recovery page')
  expect(maximumPage.result.split('\n').slice(0, 4).join('\n')).toBe(
    'CTRSCM artifact 123e4567-e89b-12d3-a456-426614174000\ntool: Bash\nrange: 0..19999 of 20001 chars\nmore: true',
  )
})

test('recovery registration constants expose the contract schema', () => {
  expect(RECOVER_NAME).toBe('recover')
  expect(RECOVER_DESCRIPTION).toBe('Read back the exact original text of a tool result that CTRSCM replaced with a placeholder of the form [CTRSCM shaken tool result: ... id="<id>"]. The text is not lost. When you need any detail from such a result, call this tool with that id instead of re-running the original tool, guessing, or asking the person to repeat it. Results are returned in pages: start with maxChars 8000 or less, and use offset to read further pages only when the header says more: true.')
  expect(RECOVER_SCHEMA).toEqual({
    type: 'object',
    properties: {
      id: { type: 'string' },
      offset: { type: 'integer', minimum: 0 },
      maxChars: { type: 'integer', minimum: 1, maximum: 20000 },
    },
    required: ['id'],
  })
})

test('recovery returns exact first, bounded and last pages', async () => {
  expect(await recoverResult(artifactFs(), '/tmp', { id })).toEqual({
    result: 'CTRSCM artifact 123e4567-e89b-12d3-a456-426614174000\ntool: Bash\nrange: 0..9 of 10 chars\nmore: false\n\n0123456789',
  })
  expect(await recoverResult(artifactFs(), '/tmp', { id, offset: 2, maxChars: 4 })).toEqual({
    result: 'CTRSCM artifact 123e4567-e89b-12d3-a456-426614174000\ntool: Bash\nrange: 2..5 of 10 chars\nmore: true\n\n2345',
  })
  expect(await recoverResult(artifactFs(), '/tmp', { id, offset: 8, maxChars: 20000 })).toEqual({
    result: 'CTRSCM artifact 123e4567-e89b-12d3-a456-426614174000\ntool: Bash\nrange: 8..9 of 10 chars\nmore: false\n\n89',
  })
})

test('recovery validates id, offset, maxChars and artifact state exactly', async () => {
  expect(await recoverResult(artifactFs(), '/tmp', {})).toEqual({ deny: 'invalid artifact id' })
  expect(await recoverResult(artifactFs(), '/tmp', { id: 'ABC' })).toEqual({ deny: 'invalid artifact id' })
  expect(await recoverResult(artifactFs(), '/tmp', { id, offset: '2' })).toEqual({ deny: 'invalid offset' })
  expect(await recoverResult(artifactFs(), '/tmp', { id, offset: -1 })).toEqual({ deny: 'invalid offset' })
  expect(await recoverResult(artifactFs(), '/tmp', { id, offset: 1.5 })).toEqual({ deny: 'invalid offset' })
  expect(await recoverResult(artifactFs(), '/tmp', { id, maxChars: '4' })).toEqual({ deny: 'invalid maxChars (1 to 20000)' })
  expect(await recoverResult(artifactFs(), '/tmp', { id, maxChars: 0 })).toEqual({ deny: 'invalid maxChars (1 to 20000)' })
  expect(await recoverResult(artifactFs(), '/tmp', { id, maxChars: 20001 })).toEqual({
    deny: 'invalid maxChars (1 to 20000)',
  })
  expect(await recoverResult(artifactFs(), '/tmp', { id, offset: 10 })).toEqual({ deny: 'offset 10 is past the end (10 chars)' })
  expect(await recoverResult(artifactFs(), '/tmp', { id: '123e4567-e89b-12d3-a456-426614174001' })).toEqual({ deny: 'artifact not found or incomplete' })
})
