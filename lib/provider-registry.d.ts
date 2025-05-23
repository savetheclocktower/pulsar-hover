import { Disposable, TextEditor } from 'atom';
import type { DatatipProvider } from "atom-ide-base";
type BaseProvider = {
    grammarScopes?: readonly string[];
    priority: number;
};
export default class ProviderRegistry<TProvider extends BaseProvider = DatatipProvider> {
    providers: TProvider[];
    addProvider(provider: TProvider): Disposable;
    removeProvider(provider: TProvider): void;
    getProviderForEditor(editor: TextEditor): TProvider | null;
    getAllProvidersForEditor(editor: TextEditor): TProvider[];
}
export {};
