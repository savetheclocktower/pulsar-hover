import { Disposable, Grammar } from "atom";

// Extensions to the types defined in `@types/atom`.

declare module 'atom' {
  interface Cursor {
    editor: TextEditor
  }
  interface TextEditorElement {
    getWidth(): number
  }
  interface GrammarRegistry {
    grammarForId(id: string): Grammar
    languageModeForGrammarAndBuffer(g: Grammar, b: TextBuffer): LanguageMode
    treeSitterGrammarForLanguageString(s: string): Grammar | undefined
  }
  interface LanguageMode {
    readonly fullyTokenized?: boolean
    readonly tree?: boolean
    onDidTokenize(cb: () => void): Disposable
    buildHighlightIterator(): HighlightIterator
    classNameForScopeId(id: ScopeId): string
    startTokenizing?(): void
    onDidTokenize(x: () => void): Disposable
    rootLanguageLayer?: { tree?: unknown }
  }
  interface HighlightIterator {
    seek(pos: { row: number; column: number }, endRow?: number): void
    getPosition(): { row: number; column: number }
    getOpenScopeIds?(): number[]
    getCloseScopeIds?(): number[]
    moveToSuccessor(): void
  }
  // interface ScopeId {}
  interface TextBuffer {
    setLanguageMode(lm: LanguageMode): void
    getLanguageMode(): LanguageMode;
  }
  interface TextEditor {
    setVisible(value: boolean): void;
    getElement(): TextEditorElement;
    getDefaultCharWidth(): number;
  }
}
