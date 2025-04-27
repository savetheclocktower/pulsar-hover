import { Disposable, Grammar } from 'atom';
declare module "atom" {
    interface GrammarRegistry {
        grammarForId(id: string): Grammar;
        languageModeForGrammarAndBuffer(g: Grammar, b: TextBuffer): LanguageMode;
        treeSitterGrammarForLanguageString(s: string): Grammar | undefined;
    }
    interface LanguageMode {
        readonly fullyTokenized?: boolean;
        readonly tree?: boolean;
        onDidTokenize(cb: () => void): Disposable;
        buildHighlightIterator(): HighlightIterator;
        classNameForScopeId(id: ScopeId): string;
        startTokenizing?(): void;
        onDidTokenize(x: () => void): Disposable;
        rootLanguageLayer?: {
            tree?: unknown;
        };
    }
    interface HighlightIterator {
        seek(pos: {
            row: number;
            column: number;
        }, endRow?: number): void;
        getPosition(): {
            row: number;
            column: number;
        };
        getOpenScopeIds?(): ScopeId[];
        getCloseScopeIds?(): ScopeId[];
        moveToSuccessor(): void;
    }
    interface ScopeId {
    }
    interface TextBuffer {
        setLanguageMode(lm: LanguageMode): void;
        getLanguageMode(): LanguageMode;
    }
    interface TextEditor {
        setVisible(value: boolean): void;
    }
}
export type DOMPurifyConfig = Omit<DOMPurify.Config, "RETURN_DOM" | "RETURN_DOM_FRAGMENT" | "RETURN_TRUSTED_TYPE"> & {
    PARSER_MEDIA_TYPE: DOMParserSupportedType | null;
};
type StringPropertyNames<T> = {
    [K in keyof T]: T[K] extends string ? K : never;
}[keyof T];
type WritablePropertyNames<T> = {
    [K in keyof T]: T extends {
        readonly [P in K]: T[K];
    } ? never : K;
}[keyof T];
type WritableStringCSSProperties = Pick<CSSStyleDeclaration, StringPropertyNames<CSSStyleDeclaration> & WritablePropertyNames<CSSStyleDeclaration>>;
export type RenderMarkdownFragmentOptions = {
    markdown: string;
    containerClassName: string;
    contentClassName: string;
    editorStyles?: Partial<WritableStringCSSProperties>;
};
export declare function renderOverlayContent({ markdown, containerClassName, contentClassName, editorStyles }: RenderMarkdownFragmentOptions): Promise<DocumentFragment>;
export declare function renderMarkdown(markdownText: string, domPurifyConfig?: DOMPurifyConfig): Promise<string>;
export {};
