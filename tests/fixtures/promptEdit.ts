import type { PromptEditInput, PromptEditResult } from 'claude-code'
import type { Engine } from 'claude-code/testing'

type PromptEditDispatch = { edit: (e: PromptEditInput) => Promise<PromptEditResult> }

// the mock engine raises prompt.edit though the public Engine type omits it
export function promptEdit($: Engine, e: PromptEditInput): Promise<PromptEditResult> {
  return ($.prompt as unknown as PromptEditDispatch).edit(e)
}
