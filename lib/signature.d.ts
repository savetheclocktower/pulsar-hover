import { SignatureHelp, SignatureHelpContext } from 'vscode-languageserver-protocol';
import { Point, TextEditor } from 'atom';
export type SignatureProvider = {
    name: string;
    packageName: string;
    priority: number;
    grammarScopes: string[];
    triggerCharacters?: Set<string>;
    retriggerCharacters?: Set<string>;
    getSignature: (editor: TextEditor, point: Point, context?: SignatureHelpContext) => Promise<SignatureHelp | null>;
};
