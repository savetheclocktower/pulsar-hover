import { Disposable, DisposableLike, Point, TextEditor } from 'atom';
import type { DatatipProvider, SignatureHelpProvider } from "atom-ide-base";
import { SignatureHelp, SignatureHelpContext } from 'vscode-languageserver-protocol';

function isEditorSupported(editor: TextEditor, provider: BaseProvider) {
  return !provider.grammarScopes || provider.grammarScopes.includes(editor.getGrammar()?.scopeName);
}

type BaseProvider = {
  grammarScopes?: readonly string[],
  priority: number
}

export type AugmentedSignatureHelpProvider = SignatureHelpProvider & {
  retriggerCharacters?: Set<string>,
  getSignatureHelp: (editor: TextEditor, point: Point, context?: SignatureHelpContext) => Promise<SignatureHelp | null>
}

export type AugmentedSignatureHelpRegistry = (provider: AugmentedSignatureHelpProvider) => DisposableLike

export default class ProviderRegistry<TProvider extends BaseProvider = DatatipProvider> {

  public providers: TProvider[] = [];

  addProvider(provider: TProvider) {
    this.providers.push(provider);
    return new Disposable(() => this.removeProvider(provider));
  }

  removeProvider(provider: TProvider) {
    let index = this.providers.indexOf(provider);
    if (index === -1) return;
    this.providers.splice(index, 1);
  }

  getProviderForEditor(editor: TextEditor) {
    let all = this.getAllProvidersForEditor(editor);
    if (all.length === 0) return null;
    return all[0];
  }

  getAllProvidersForEditor(editor: TextEditor) {
    return this.providers.filter(provider => {
      let result = isEditorSupported(editor, provider);
      return result;
    }).sort((a, b) => a.priority - b.priority);
  }
}
