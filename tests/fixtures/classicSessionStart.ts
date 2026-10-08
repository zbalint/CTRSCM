import type { ClassicEventOf } from 'claude-code'
import type { Engine } from 'claude-code/testing'

type ClassicDispatch = { classic: { SessionStart: (e: ClassicEventOf['classic.SessionStart']) => Promise<unknown> } }

// the mock engine dispatches classic.* events though the public Engine type omits them
export function classicSessionStart($: Engine, e: ClassicEventOf['classic.SessionStart']): Promise<unknown> {
  return ($ as unknown as ClassicDispatch).classic.SessionStart(e)
}
