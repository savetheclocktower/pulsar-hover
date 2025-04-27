import { Point, Range, TextEditor } from "atom";
type HoverMarkupContent = {
    kind: 'markdown' | 'plaintext';
    value: string;
};
export type HoverInformation = {
    range?: Range;
    contents: HoverMarkupContent;
};
export type HoverProvider = {
    name: string;
    packageName: string;
    priority: number;
    grammarScopes?: readonly string[];
    validForScope?: (scopeName: string) => boolean;
    hover: (editor: TextEditor, point: Point) => Promise<HoverInformation | null>;
};
export {};
