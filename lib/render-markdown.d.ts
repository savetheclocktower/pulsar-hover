import { Grammar } from 'atom';
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
    grammar?: Grammar;
    editorStyles?: Partial<WritableStringCSSProperties>;
};
export declare function renderOverlayContent({ markdown, containerClassName, contentClassName, editorStyles }: RenderMarkdownFragmentOptions): Promise<DocumentFragment>;
export declare function renderMarkdown(markdownText: string, domPurifyConfig?: DOMPurifyConfig): Promise<string>;
export {};
