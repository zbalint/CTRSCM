import type { Fs } from './artifacts'
import { isArtifactId, readPage } from './artifacts'

export const RECOVER_NAME = 'recover'
export const RECOVER_DESCRIPTION =
  'CTRSCM placeholders name an artifact id. Use this tool to recover the original tool-result text in bounded pages.'
export const RECOVER_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    offset: { type: 'integer', minimum: 0 },
    maxChars: { type: 'integer', minimum: 1, maximum: 100000 },
  },
  required: ['id'],
} as const
export const DEFAULT_PAGE_CHARS = 20000
export const MAX_PAGE_CHARS = 100000

type RecoverInput = {
  id?: unknown
  offset?: unknown
  maxChars?: unknown
}

export async function recoverResult(
  fs: Fs,
  root: string,
  input: RecoverInput,
): Promise<{ result: string } | { deny: string }> {
  if (typeof input.id !== 'string' || !isArtifactId(input.id)) return { deny: 'invalid artifact id' }
  if (
    input.offset !== undefined &&
    (typeof input.offset !== 'number' || !Number.isInteger(input.offset) || input.offset < 0)
  ) return { deny: 'invalid offset' }
  if (
    input.maxChars !== undefined &&
    (typeof input.maxChars !== 'number' ||
      !Number.isInteger(input.maxChars) ||
      input.maxChars < 1 ||
      input.maxChars > MAX_PAGE_CHARS)
  ) return { deny: 'invalid maxChars' }

  const offset = input.offset ?? 0
  const maxChars = input.maxChars ?? DEFAULT_PAGE_CHARS
  const page = await readPage(fs, root, input.id, offset, maxChars)
  if (!page.ok) {
    return page.reason === 'pastEnd'
      ? { deny: `offset ${offset} is past the end (${page.total} chars)` }
      : { deny: 'artifact not found or incomplete' }
  }
  return {
    result:
      `CTRSCM artifact ${page.manifest.id}\n` +
      `tool: ${page.manifest.toolName ?? 'unknown'}\n` +
      `range: ${page.start}..${page.end - 1} of ${page.manifest.totalChars} chars\n` +
      `more: ${page.end < page.manifest.totalChars}\n\n` +
      page.text,
  }
}
