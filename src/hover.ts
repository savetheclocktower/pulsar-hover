import { Point, Range, TextEditor } from "atom"

// Like LSP’s `MarkupContent`, but abstracts away the difference between it and
// the deprecated `MarkedString` type.
type HoverMarkupContent = {
  kind: 'markdown' | 'plaintext',
  value: string
}

// The Datatip interface allows for both `MarkedStringDatatip` _and_
// `ReactComponentDatatip`… and the latter is too much. Not even part of LSP
// and I don't know of anyone that uses it.
//
// It also has a needless distinction between “Markdown” strings and “snippet”
// strings, whereas LSP envisions the former containing the latter and
// representing them as fenced code blocks. It tries a bad heuristic to match
// up fenced code blocks with grammars, but it's probably best to let the
// consumer pick the right grammar for a fenced code block like we do with
// `markdown-preview`.
//
// All of this is to say that we are keeping this one simple. The Hover service
// aims to remove all the YAGNI stuff from Datatip and fix the strange
// inversion-of-control thing where provider and consumer are flipped.
export type HoverInformation = {
  range?: Range,
  contents: HoverMarkupContent
}

export type HoverProvider = {
  name: string,
  packageName: string,
  priority: number,
  grammarScopes?: readonly string[],
  validForScope?: (scopeName: string) => boolean,
  hover: (editor: TextEditor, point: Point) => Promise<HoverInformation | null>
}
