import * as marked from 'marked';
import DOMPurify from 'dompurify';
import { Grammar, TextBuffer } from 'atom';

marked.setOptions({ breaks: false })

export type DOMPurifyConfig = Omit<DOMPurify.Config, "RETURN_DOM" | "RETURN_DOM_FRAGMENT" | "RETURN_TRUSTED_TYPE"> & { PARSER_MEDIA_TYPE: DOMParserSupportedType | null }

function grammarForLanguageString (languageString: string) {
  if (languageString.includes('.')) {
    return atom.grammars.grammarForScopeName(languageString);
  }
  return (
    atom.grammars.treeSitterGrammarForLanguageString(languageString) ??
    atom.grammars.grammarForScopeName(`source.${languageString}`)
  );
}

type LanguageMode = ReturnType<TextBuffer['getLanguageMode']>

async function tokenized(lm: LanguageMode) {
  if (lm.startTokenizing) lm.startTokenizing();
  return new Promise((resolve) => {
    if (lm.fullyTokenized || lm.rootLanguageLayer?.tree) {
      resolve(undefined)
    } else if (lm.onDidTokenize) {
      const disp = lm.onDidTokenize(() => {
        disp.dispose()
        resolve(undefined)
      })
    } else {
      resolve(undefined) // null language mode
    }
  })
}

async function highlightCode(source: string, grammar: Grammar) {
  let buffer = new TextBuffer();
  try {
    let languageMode = atom.grammars.languageModeForGrammarAndBuffer(grammar, buffer);
    buffer.setLanguageMode(languageMode);
    buffer.setText(source);
    let end = buffer.getEndPosition();
    languageMode.startTokenizing?.();
    await tokenized(languageMode);

    let iter = languageMode.buildHighlightIterator();
    if (!(iter.getOpenScopeIds && iter.getCloseScopeIds)) return source;
    let pos = { row: 0, column: 0 };
    iter.seek(pos, end.row);
    let output = [];
    while (pos.row < end.row || (pos.row === end.row && pos.column <= end.column)) {
      output.push(
        ...iter.getCloseScopeIds().map(() => '</span>'),
        ...iter.getOpenScopeIds().map(id => `<span class="${languageMode.classNameForScopeId(id)}">`)
      );
      iter.moveToSuccessor();
      let nextPos = iter.getPosition();
      output.push(escapeHTML(buffer.getTextInRange([pos, nextPos])));
      // TODO: Yield?
      pos = nextPos;
    }
    return output.join('');
  } finally {
    buffer.destroy();
  }
}

function escapeHTML(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function unescapeHTML(str: string) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

/**
 * All the properties in `T` whose values are strings.
 */
type StringPropertyNames<T> = {
  [K in keyof T]: T[K] extends string ? K : never
}[keyof T];

/**
 * All the properties in `T` whose values aren't readonly.
 */
type WritablePropertyNames<T> = {
  [K in keyof T]: T extends { readonly [P in K]: T[K] } ? never : K
}[keyof T];

/**
 * All the writable string properties in `CSSStyleDeclaration`.
 */
type WritableStringCSSProperties = Pick<
  CSSStyleDeclaration,
  StringPropertyNames<CSSStyleDeclaration> & WritablePropertyNames<CSSStyleDeclaration>
>;

export type RenderMarkdownFragmentOptions = {
  markdown: string,
  containerClassName: string,
  contentClassName: string,
  grammar?: Grammar,
  editorStyles?: Partial<WritableStringCSSProperties>
};

const RANGE = document.createRange();
RANGE.selectNode(document.body);

export async function renderOverlayContent({
  markdown,
  // grammar = undefined,
  containerClassName,
  contentClassName,
  editorStyles
}: RenderMarkdownFragmentOptions) {
  let html = await renderMarkdown(markdown);
  let fragment = RANGE.createContextualFragment(`
    <atom-panel class="${containerClassName}">
      <div class="inset-panel padded ${contentClassName}">
        ${html}
      </div>
    </atom-panel>
  `);

  // Apply style overrides to make the `pre` elements look more like the user’s
  // editor.
  if (editorStyles) {
    let codeElementsInsidePres = fragment.querySelectorAll('pre > code');
    for (let code of Array.from(codeElementsInsidePres)) {
      let pre = code.parentNode as HTMLPreElement;
      for (let property in editorStyles) {
        pre.style[property as keyof WritableStringCSSProperties] = editorStyles[property as keyof WritableStringCSSProperties];
      }
    }
  }

  return fragment;
}

export async function renderMarkdown(
  markdownText: string,
  domPurifyConfig?: DOMPurifyConfig
) {
  return new Promise<string>((resolve, reject) => {
    marked.parse(
      // Why are we escaping this markup? Because of the weird notion that some
      // folks have about HTML not being valid Markdown.
      //
      // From the definition of `MarkupContent` in the LSP spec:
      //
      //   Please note that clients might sanitize the return Markdown. A
      //   client could decide to remove HTML from the Markdown to avoid script
      //   execution.
      //
      // Fair enough. This is why we run DOMPurify on the returned HTML.
      //
      // But the (deprecated) `MarkedString` definition muddies the waters:
      //
      //   Note that Markdown strings will be sanitized — that means HTML will
      //   be escaped.
      //
      // It’s not clear in context who’s doing the escaping — whether it’s the
      // language server’s job or the consumer’s job. But in practice, I’ve
      // routinely encountered unescaped HTML in contexts that are clearly
      // _use_ rather than _mention_. (For instance, prose that makes reference
      // to a <pre> element rather than actually wanting to render a `pre`.)
      //
      // Those are bog-standard examples of situations where you _must_ escape
      // HTML. The only reason you’d neglect to do so as a language server
      // author is if you thought it was the consumer’s job. So I guess that
      // answers that question.
      //
      // Microsoft themselves are apparently confused about this. Because
      // `typescript-language-server` is an offender here, as is the CSS
      // language server that ships with VS Code. Both include unescaped markup
      // in prose. With a minimum of effort — `<pre>` instead of <pre> — this
      // could be avoided. Maybe I’ll file some bugs.
      //
      // In the meantime, it appears to be _mandatory_ in practice to escape
      // HTML in `MarkupContent` values before rendering Markdown, even though
      // Markdown is a superset of HTML.
      escapeHTML(markdownText),
      {
        highlight: async (code, lang, callback) => {
          let grammar = grammarForLanguageString(lang) ?? atom.grammars.grammarForScopeName('text.plain.null-grammar')!;
          // When we escaped everything above, that was wrong — code within
          // backticks shouldn't need to be escaped. So before we invoke syntax
          // highlighting on them, we'll unescape them.
          //
          // TODO: Sadly, this callback only seems to run against code fences,
          // not inline code spans. But `marked` probably offers a way for me
          // to intervene in the parsing process; just have to track it down
          // and unescape HTML inside of inline code spans.
          let result = await highlightCode(unescapeHTML(code), grammar);
          callback(null, result);
        }
      },
      (error, html) => {
        if (error) {
          reject(error);
        }
        html = domPurifyConfig ?
          DOMPurify.sanitize(html, domPurifyConfig) :
          DOMPurify.sanitize(html);
        resolve(html);
      }
    )
  });
}
