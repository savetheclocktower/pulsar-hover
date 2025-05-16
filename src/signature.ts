import type {
  SignatureHelp,
  SignatureHelpContext
} from 'vscode-languageserver-protocol'
import { Point, TextEditor } from 'atom'

export type SignatureProvider = {
  name: string
  packageName: string
  priority: number
  grammarScopes: string[]
  triggerCharacters?: Set<string>
  retriggerCharacters?: Set<string>
  getSignature: (editor: TextEditor, point: Point, context?: SignatureHelpContext) => Promise<SignatureHelp | null>
}


/**
 * How a signature help was triggered.
 *
 * @since 3.15.0
 *
 * Vendored from https://github.com/microsoft/vscode-languageserver-node/blob/0ab5533f2effb0cf1b146beaa0a716bcfb9f10f4/protocol/src/common/protocol.ts#L2961
 * to avoid runtime dependency on its source package.
 *
 * Copyright (c) Microsoft Corporation (MIT Licensed)
 */
export const enum SignatureHelpTriggerKind {
  /**
   * Signature help was invoked manually by the user or by a command.
   */
  Invoked = 1,
  /**
   * Signature help was triggered by a trigger character.
   */
  TriggerCharacter = 2,
  /**
   * Signature help was triggered by the cursor moving or by the document content changing.
   */
  ContentChange = 3,
}
