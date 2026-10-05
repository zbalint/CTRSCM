export type Fs = {
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
}

export type Manifest = {
  version: 1
  id: string
  agentId: string | null
  toolUseId: string
  toolName: string | null
  createdAt: string
  totalChars: number
  chunkChars: number[]
}

export const CHUNK_CHARS = 262144

function rootPath(root: string, id: string): string {
  const cleanRoot = root.replace(/\/+$/, '') || '/'
  return cleanRoot === '/' ? `/${id}` : `${cleanRoot}/${id}`
}

export function isArtifactId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
}

export function splitChunks(text: string): string[] {
  const chunks: string[] = []
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + CHUNK_CHARS, text.length)
    const last = text.charCodeAt(end - 1)
    const next = text.charCodeAt(end)
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1
    chunks.push(text.slice(start, end))
    start = end
  }
  return chunks
}

export async function writeArtifact(
  fs: Fs,
  root: string,
  manifest: Omit<Manifest, 'totalChars' | 'chunkChars'>,
  text: string,
): Promise<void> {
  const chunks = splitChunks(text)
  const directory = rootPath(root, manifest.id)
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    if (chunk === undefined) continue
    await fs.write(`${directory}/chunk-${String(index).padStart(4, '0')}.txt`, chunk)
  }
  const complete: Manifest = {
    ...manifest,
    version: 1,
    totalChars: chunks.reduce((total, chunk) => total + chunk.length, 0),
    chunkChars: chunks.map((chunk) => chunk.length),
  }
  await fs.write(`${directory}/manifest.json`, JSON.stringify(complete))
}

function property(value: object, name: string): unknown {
  return Object.getOwnPropertyDescriptor(value, name)?.value
}

function parseManifest(value: unknown, id: string): Manifest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const version = property(value, 'version')
  const manifestId = property(value, 'id')
  const agentId = property(value, 'agentId')
  const toolUseId = property(value, 'toolUseId')
  const toolName = property(value, 'toolName')
  const createdAt = property(value, 'createdAt')
  const totalChars = property(value, 'totalChars')
  const chunkChars = property(value, 'chunkChars')
  if (
    version !== 1 ||
    manifestId !== id ||
    (agentId !== null && typeof agentId !== 'string') ||
    typeof toolUseId !== 'string' ||
    (toolName !== null && typeof toolName !== 'string') ||
    typeof createdAt !== 'string' ||
    !Number.isInteger(totalChars) ||
    !Array.isArray(chunkChars) ||
    chunkChars.length === 0 ||
    !chunkChars.every((chunk): chunk is number => Number.isInteger(chunk) && chunk > 0) ||
    totalChars !== chunkChars.reduce((sum, chunk) => sum + chunk, 0)
  ) return undefined
  return {
    version: 1,
    id,
    agentId,
    toolUseId,
    toolName,
    createdAt,
    totalChars,
    chunkChars,
  }
}

export async function readPage(
  fs: Fs,
  root: string,
  id: string,
  offset: number,
  maxChars: number,
): Promise<
  | { ok: true; manifest: Manifest; start: number; end: number; text: string }
  | { ok: false; reason: 'notFound' | 'pastEnd'; total?: number }
> {
  if (!isArtifactId(id) || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(maxChars) || maxChars < 1) {
    return { ok: false, reason: 'notFound' }
  }
  const directory = rootPath(root, id)
  let manifest: Manifest | undefined
  try {
    manifest = parseManifest(JSON.parse(await fs.read(`${directory}/manifest.json`)), id)
  } catch {
    return { ok: false, reason: 'notFound' }
  }
  if (manifest === undefined) return { ok: false, reason: 'notFound' }
  if (offset >= manifest.totalChars) return { ok: false, reason: 'pastEnd', total: manifest.totalChars }
  const start = offset
  const end = Math.min(offset + maxChars, manifest.totalChars)
  const text: string[] = []
  let chunkStart = 0
  try {
    for (let index = 0; index < manifest.chunkChars.length; index += 1) {
      const chunkLength = manifest.chunkChars[index]
      if (chunkLength === undefined) return { ok: false, reason: 'notFound' }
      const chunkEnd = chunkStart + chunkLength
      if (chunkEnd > start && chunkStart < end) {
        const chunk = await fs.read(`${directory}/chunk-${String(index).padStart(4, '0')}.txt`)
        if (chunk.length !== chunkLength) return { ok: false, reason: 'notFound' }
        const localStart = Math.max(start - chunkStart, 0)
        const localEnd = Math.min(end - chunkStart, chunkLength)
        text.push(chunk.slice(localStart, localEnd))
      }
      chunkStart = chunkEnd
    }
  } catch {
    return { ok: false, reason: 'notFound' }
  }
  return { ok: true, manifest, start, end, text: text.join('') }
}
