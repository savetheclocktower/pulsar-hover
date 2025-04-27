import { Disposable, TextEditor } from 'atom';
import type { DatatipProvider } from "atom-ide-base";

function isEditorSupported(editor: TextEditor, provider: BaseProvider) {
  return !provider.grammarScopes || provider.grammarScopes.includes(editor.getGrammar()?.scopeName);
}

type BaseProvider = {
  grammarScopes?: readonly string[]
}

export default class ProviderRegistry<TProvider extends BaseProvider = DatatipProvider> {

  public providers: TProvider[] = [];

  addProvider (provider: TProvider) {
    this.providers.push(provider);
    return new Disposable(() => this.removeProvider(provider));
  }

  removeProvider (provider: TProvider) {
    let index = this.providers.indexOf(provider);
    if (index === -1) return;
    this.providers.splice(index, 1);
  }

  getAllProvidersForEditor (editor: TextEditor) {
    return this.providers.filter(provider => {
      let result = isEditorSupported(editor, provider);
      return result;
    });
  }
}
