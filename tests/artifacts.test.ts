import { expect, test } from 'claude-code/testing'
import {
  CHUNK_CHARS,
  isArtifactId,
  readPage,
  splitChunks,
  writeArtifact,
  type Fs,
  type Manifest,
} from '../hooks/artifacts'

function memoryFs(initial: Readonly<Record<string, string>> = {}) {
  const files = new Map(Object.entries(initial))
  const writes: string[] = []
  const reads: string[] = []
  const fs: Fs = {
    read: async (path) => {
      reads.push(path)
      const text = files.get(path)
      if (text === undefined) throw new Error(`missing ${path}`)
      return text
    },
    write: async (path, text) => {
      writes.push(path)
      files.set(path, text)
    },
  }
  return { fs, files, writes, reads }
}

const baseManifest = {
  version: 1 as const,
  id: '123e4567-e89b-12d3-a456-426614174000',
  agentId: null,
  toolUseId: 'tu1',
  toolName: 'Bash',
  createdAt: '2026-10-05T00:00:00.000Z',
}

test('artifact ids and chunks use the locked boundaries', () => {
  expect(isArtifactId(baseManifest.id)).toBe(true)
  expect(isArtifactId('not-an-id')).toBe(false)
  expect(splitChunks('')).toEqual([])
  expect(splitChunks('x'.repeat(CHUNK_CHARS))).toEqual(['x'.repeat(CHUNK_CHARS)])
  expect(splitChunks('x'.repeat(CHUNK_CHARS + 1))).toEqual([
    'x'.repeat(CHUNK_CHARS),
    'x',
  ])
  const pair = 'a'.repeat(CHUNK_CHARS - 1) + '😀' + 'b'
  const chunks = splitChunks(pair)
  expect(chunks.join('')).toBe(pair)
  expect(chunks[0]?.length).toBe(CHUNK_CHARS - 1)
  expect(splitChunks('\ud800')).toEqual(['\ud800'])
})

test('writeArtifact commits chunks before the manifest and readPage round-trips pages', async () => {
  const { fs, writes, reads } = memoryFs()
  const text = 'a'.repeat(CHUNK_CHARS + 20) + 'b'.repeat(30)
  await writeArtifact(fs, '/tmp/artifacts///', baseManifest, text)
  expect(writes).toEqual([
    '/tmp/artifacts/123e4567-e89b-12d3-a456-426614174000/chunk-0000.txt',
    '/tmp/artifacts/123e4567-e89b-12d3-a456-426614174000/chunk-0001.txt',
    '/tmp/artifacts/123e4567-e89b-12d3-a456-426614174000/manifest.json',
  ])
  const firstPage = await readPage(fs, '/tmp/artifacts', baseManifest.id, 0, 4)
  expect(firstPage).toEqual({
    ok: true,
    manifest: {
      ...baseManifest,
      totalChars: text.length,
      chunkChars: [CHUNK_CHARS, 50],
    },
    start: 0,
    end: 4,
    text: 'aaaa',
  })
  expect(reads).toEqual([
    '/tmp/artifacts/123e4567-e89b-12d3-a456-426614174000/manifest.json',
    '/tmp/artifacts/123e4567-e89b-12d3-a456-426614174000/chunk-0000.txt',
  ])
  reads.length = 0
  const page = await readPage(fs, '/tmp/artifacts', baseManifest.id, CHUNK_CHARS - 10, 60)
  expect(page).toEqual({
    ok: true,
    manifest: {
      ...baseManifest,
      totalChars: text.length,
      chunkChars: [CHUNK_CHARS, 50],
    },
    start: CHUNK_CHARS - 10,
    end: CHUNK_CHARS + 50,
    text: 'a'.repeat(30) + 'b'.repeat(30),
  })
  expect(reads).toEqual([
    '/tmp/artifacts/123e4567-e89b-12d3-a456-426614174000/manifest.json',
    '/tmp/artifacts/123e4567-e89b-12d3-a456-426614174000/chunk-0000.txt',
    '/tmp/artifacts/123e4567-e89b-12d3-a456-426614174000/chunk-0001.txt',
  ])
  reads.length = 0
  const last = await readPage(fs, '/tmp/artifacts', baseManifest.id, text.length - 4, 20000)
  expect(last).toEqual({
    ok: true,
    manifest: {
      ...baseManifest,
      totalChars: text.length,
      chunkChars: [CHUNK_CHARS, 50],
    },
    start: text.length - 4,
    end: text.length,
    text: 'bbbb',
  })
  expect(reads).toEqual([
    '/tmp/artifacts/123e4567-e89b-12d3-a456-426614174000/manifest.json',
    '/tmp/artifacts/123e4567-e89b-12d3-a456-426614174000/chunk-0001.txt',
  ])
})

test('a failed chunk write propagates and never writes the manifest', async () => {
  const writes: string[] = []
  const fs: Fs = {
    read: async () => '',
    write: async (path) => {
      writes.push(path)
      if (path.endsWith('chunk-0001.txt')) throw new Error('disk full')
    },
  }
  let error: unknown
  try {
    await writeArtifact(fs, '/tmp/artifacts', baseManifest, 'x'.repeat(CHUNK_CHARS + 1))
  } catch (caught) {
    error = caught
  }
  expect(error).toEqual(new Error('disk full'))
  expect(writes).toEqual([
    '/tmp/artifacts/123e4567-e89b-12d3-a456-426614174000/chunk-0000.txt',
    '/tmp/artifacts/123e4567-e89b-12d3-a456-426614174000/chunk-0001.txt',
  ])
})

test('readPage rejects incomplete or inconsistent artifacts and reports the exact end', async () => {
  const validManifest: Manifest = {
    ...baseManifest,
    totalChars: 3,
    chunkChars: [3],
  }
  const cases: Array<[string, string, string | undefined]> = [
    ['missing', '{"version":1}', undefined],
    ['bad-json', 'not json', undefined],
    ['id-mismatch', JSON.stringify({ ...validManifest, id: '123e4567-e89b-12d3-a456-426614174001' }), 'abc'],
    ['bad-total', JSON.stringify({ ...validManifest, totalChars: 2 }), 'abc'],
    ['wrong-length', JSON.stringify(validManifest), 'ab'],
    ['missing-chunk', JSON.stringify(validManifest), undefined],
  ]
  for (const [id, manifest, chunk] of cases) {
    const files: Record<string, string> = {
      [`/tmp/${baseManifest.id}/manifest.json`]: manifest,
    }
    if (chunk !== undefined) files[`/tmp/${baseManifest.id}/chunk-0000.txt`] = chunk
    const result = await readPage(
      memoryFs(files).fs,
      '/tmp',
      baseManifest.id,
      0,
      10,
    )
    expect(result).toEqual({ ok: false, reason: 'notFound' })
  }
  const fs = memoryFs({
    '/tmp/123e4567-e89b-12d3-a456-426614174000/manifest.json': JSON.stringify(validManifest),
    '/tmp/123e4567-e89b-12d3-a456-426614174000/chunk-0000.txt': 'abc',
  }).fs
  expect(await readPage(fs, '/tmp', baseManifest.id, 3, 10)).toEqual({
    ok: false,
    reason: 'pastEnd',
    total: 3,
  })
})
