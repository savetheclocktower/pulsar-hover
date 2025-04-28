import { Disposable, DisposableLike, Point, TextEditor } from 'atom';
import type { DatatipProvider, SignatureHelpProvider } from "atom-ide-base";
import { SignatureHelp, SignatureHelpContext } from 'vscode-languageserver-protocol';
type BaseProvider = {
    grammarScopes?: readonly string[];
    priority: number;
};
export type AugmentedSignatureHelpProvider = SignatureHelpProvider & {
    retriggerCharacters?: Set<string>;
    getSignatureHelp: (editor: TextEditor, point: Point, context?: SignatureHelpContext) => Promise<SignatureHelp | null>;
};
export type AugmentedSignatureHelpRegistry = (provider: AugmentedSignatureHelpProvider) => DisposableLike;
export default class ProviderRegistry<TProvider extends BaseProvider = DatatipProvider> {
    providers: TProvider[];
    addProvider(provider: TProvider): Disposable;
    removeProvider(provider: TProvider): void;
    getProviderForEditor(editor: TextEditor): TProvider | null;
    getAllProvidersForEditor(editor: TextEditor): TProvider[];
}
export {};
