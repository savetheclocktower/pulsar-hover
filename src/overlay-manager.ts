import {
  CompositeDisposable,
  Disposable,
  Emitter,
  Range,
  Point,
  TextEditor,
  TextEditorElement,
  CommandEvent,
  CursorPositionChangedEvent,
  Decoration,
  BufferStoppedChangingEvent,
  TextChange
} from 'atom';

import type { SignatureHelpContext } from 'vscode-languageserver-protocol';

import type { Datatip, DatatipProvider, MarkedString, Signature, SignatureHelpProvider, SignatureParameter } from 'atom-ide-base';

import ProviderRegistry from './provider-registry';
import { Timer } from './util';
import { HoverInformation, HoverProvider } from './hover';
import { SignatureProvider, SignatureHelpTriggerKind } from './signature';
import { renderOverlayContent } from './render-markdown';

// Distinguishes `Datatip` from `HoverInformation`.
function isDatatip(value: Datatip | HoverInformation | null): value is Datatip {
  if (value === null) return false;
  return 'markedStrings' in value || 'component' in value;
}

function inferLanguageFromScopeName(scopeName: string) {
  let m = scopeName.match(/^source\.(.*?)/);
  return m ? m[1] : '';
}

// Converts `MarkedString` values to Markdown code blocks.
function convertMarkedString(str: MarkedString): string {
  if (str.type === 'markdown') return str.value;
  let language = inferLanguageFromScopeName(str.grammar.scopeName);
  return `\`\`\`${language}\n${str}\n\`\`\``;
}

// Converts the `Datatip` type from the Atom IDE service to the format we want.
// Ignores any `Datatip` types that aren’t derived from the LSP spec.
function convertDatatip(value: Datatip): HoverInformation | null {
  if ('component' in value) {
    // We can't convert React component datatips.
    return null;
  }

  let markdown: string[] = [];
  for (let markedString of value.markedStrings) {
    markdown.push(convertMarkedString(markedString))
  }
  return {
    range: value.range,
    contents: {
      kind: 'markdown',
      value: markdown.join('\n\n')
    }
  };
}

const NEW_EXTENT = new Point(0, 1).freeze();
const OLD_EXTENT = new Point(0, 0).freeze();

type MountOverlayWithMarkerOptions = {
  type: OverlayType,
  highlight?: boolean,
  markerInvalidate?: 'never' | 'surround' | 'overlap' | 'inside' | 'touch',
  markerPosition?: 'head' | 'tail'
};

type OverlayType = 'signature-help' | 'hover';

export default class OverlayManager {
  #emitter: Emitter = new Emitter();
  #subscriptions: CompositeDisposable = new CompositeDisposable();

  #datatipRegistry= new ProviderRegistry<DatatipProvider>();
  #signatureHelpRegistry = new ProviderRegistry<SignatureHelpProvider>();

  #hoverRegistry = new ProviderRegistry<HoverProvider>();
  #signatureRegistry = new ProviderRegistry<SignatureProvider>();

  #watchedEditors = new WeakSet<TextEditor>();

  editor: TextEditor | null = null;
  editorView: TextEditorElement | null = null;

  editorSubscriptions: CompositeDisposable | null = null;
  overlayMarkerDisposables: CompositeDisposable | null = null;

  showHoverOnCursorMove = false;
  showHoverOnMouseMove = true;
  showSignatureHelpWhileTyping = true;
  hoverTime = atom.config.get("pulsar-hover.hover.hoverTime") as number;

  currentMarkerRange: Range | null = null;
  currentOverlayType?: OverlayType;

  #cursorMoveTimer?: Timer;
  #mouseMoveTimer?: Timer;

  _onMouseMove: (event: MouseEvent) => void;
  _onMouseRemain: (event: MouseEvent) => void;
  _onCursorMove: (event: CursorPositionChangedEvent) => void;
  _onCursorRemain: (event: CursorPositionChangedEvent) => void;

  _resizeObserver: ResizeObserver

  constructor() {
    this.#createTimers();
    this._onMouseMove = this.onMouseMove.bind(this);
    this._onMouseRemain = this.onMouseRemain.bind(this);
    this._onCursorMove = this.onCursorMove.bind(this);
    this._onCursorRemain = this.onCursorRemain.bind(this);

    // Detect when overlays are initially visible.
    this._resizeObserver = new ResizeObserver((entries) => {
      let [entry] = entries;
      requestAnimationFrame(() => {
        this.#emitter.emit('overlay-did-show', entry.target);
        this._resizeObserver.unobserve(entry.target);
      });
    });

    this.initialize();
  }

  #createTimers() {
    this.#mouseMoveTimer?.unschedule();
    this.#mouseMoveTimer = new Timer(this._onMouseRemain, this.hoverTime);
    this.#cursorMoveTimer?.unschedule();
    this.#cursorMoveTimer = new Timer(this._onCursorRemain, this.hoverTime);
  }

  initialize() {
    this.#subscriptions.add(
      atom.config.observe("pulsar-hover.hover.hoverTime", (value) => {
        this.hoverTime = value;
        this.#createTimers();
      }),
      atom.workspace.observeTextEditors((editor) => {
        let disposable = this.watchEditor(editor);
        editor.onDidDestroy(() => disposable?.dispose());
      }),
      atom.commands.add('atom-text-editor', {
        'pulsar-hover:toggle': event => this.onHoverToggleCommand(event),
        'pulsar-hover:toggle-signature-help': event => this.onSignatureHelpToggleCommand(event)
      }),
      atom.config.observe('pulsar-hover.hover.showOnCursorMove', (value) => {
        this.showHoverOnCursorMove = value;
        // Forces update of internal editor tracking.
        let editor = this.editor;
        this.editor = null;
        this.updateCurrentEditor(editor);
      }),
      atom.config.observe('pulsar-hover.hover.showOnMouseMove', (value) => {
        this.showHoverOnMouseMove = value;
        // Forces update of internal editor tracking.
        let editor = this.editor;
        this.editor = null;
        this.updateCurrentEditor(editor);
      }),
      atom.config.observe('pulsar-hover.signatureHelp.showOverlayWhileTyping', (value) => {
        this.showSignatureHelpWhileTyping = value;
        // Forces update of internal editor tracking.
        let editor = this.editor;
        this.editor = null;
        this.updateCurrentEditor(editor);
      })
    )
  }

  get datatipService() {
    return this.#datatipRegistry;
  }

  get signatureHelpService () {
    return this.#signatureHelpRegistry;
  }

  get hoverRegistry() {
    return this.#hoverRegistry;
  }

  get signatureRegistry() {
    return this.#signatureRegistry;
  }

  watchEditor(editor: TextEditor) {
    if (this.#watchedEditors.has(editor)) return;

    let editorView = atom.views.getView(editor);
    if (editorView.hasFocus()) {
      this.updateCurrentEditor(editor);
    }

    let focusListener = () => this.updateCurrentEditor(editor);
    let blurListener = this.unmountOverlay.bind(this);

    editorView.addEventListener('focus', focusListener);
    editorView.removeEventListener('blur', blurListener);

    let disposable = new Disposable(() => {
      editorView.removeEventListener('focus', focusListener);
      editorView.removeEventListener('blur', blurListener);
      if (this.editor === editor) {
        this.updateCurrentEditor(null);
      }
    });

    this.#watchedEditors.add(editor);
    this.#subscriptions.add(disposable);

    return new Disposable(() => {
      disposable.dispose();
      this.#subscriptions.remove(disposable);
      this.#watchedEditors.delete(editor);
    });
  }

  updateCurrentEditor(editor: TextEditor | null) {
    if (editor === this.editor) return;
    this.editorSubscriptions?.dispose();
    this.editorSubscriptions = null;

    this.unmountOverlay();
    this.editor = this.editorView = null;

    if (editor === null || !atom.workspace.isTextEditor(editor)) {
      return;
    }

    this.editor = editor;
    this.editorView = atom.views.getView(this.editor);

    this.editorSubscriptions = new CompositeDisposable();

    if (this.showHoverOnMouseMove) {
      this.editorView.addEventListener('mousemove', this._onMouseMove);
    }

    this.editorSubscriptions.add(
      this.editor.onDidChangeCursorPosition(this._onCursorMove),
      this.editor.getBuffer().onDidChangeText((event) => {
        if (event.changes.length === 0) return;
        if (this.currentOverlayType === 'hover') {
          this.unmountOverlay();
        }
      }),
      new Disposable(() => {
        this.editorView?.removeEventListener('mousemove', this._onMouseMove);
      })
    );

    if (this.showSignatureHelpWhileTyping) {
      this.editorSubscriptions.add(
        this.editor.getBuffer().onDidChangeText((event) => {
          this.onTextDidChangeSignatureHelp(event, editor);
        }),
        this.editor.onDidChangeCursorPosition((event) => {
          this.onCursorDidChangeSignatureHelp(event);
        })
      );
    }
  }

  dispose() {
    this.overlayMarkerDisposables?.dispose();
    this.overlayMarkerDisposables = null;

    this.editorSubscriptions?.dispose();
    this.editorSubscriptions = null;

    this.#subscriptions.dispose();
  }

  unmountOverlay() {
    this.currentMarkerRange = null;
    this.currentOverlayType = undefined;
    this.overlayMarkerDisposables?.dispose();
    this.overlayMarkerDisposables = null;
  }

  async onCursorDidChangeSignatureHelp(event: CursorPositionChangedEvent) {
    if (event.textChanged) return;
    if (!isTypingPairSkip(event)) {
      if (event.newScreenPosition.row !== event.oldScreenPosition.row) {
        // Unmount signature help if the cursor moves up or down (fairly strong
        // indicator the user is leaving the bounds of an argument list) but
        // not left or right (far more ambiguous).
        this.unmountOverlay();
      }
      return;
    }

    let {
      newBufferPosition: newPos,
      oldBufferPosition: oldPos
    } = event;

    let newRange = new Range(oldPos, newPos);
    let oldRange = new Range(oldPos, oldPos);
    let newText = event.cursor.editor.getTextInBufferRange(newRange);

    // Act like this is an event that inserted a character. Build a dummy
    // `TextChange` object.
    let textChange: TextChange = {
      newRange,
      oldRange,
      oldText: '',
      newText,
      newExtent: NEW_EXTENT,
      oldExtent: OLD_EXTENT,
      start: newRange.start
    };

    // When `bracket-matcher` detects that you’re trying to type a paired
    // character that was inserted earlier, it instead just moves your cursor
    // over by one column. This is handy in general… but inconvenient for us,
    // since we’d like to handle that as a text-change event, even though the
    // text didn’t technically change.
    //
    // This is important because `)` is a common “retrigger” character. It’s a
    // hint that the signature help should be re-queried because it’s likely to
    // have changed (in this case to _no_ signature help, meaning the overlay
    // should disappear).
    //
    // So this handler exists to detect those events by analyzing cursor
    // position changes. It will also catch some false positives, like when you
    // put your cursor on the left side of a `)` and press Right, but that’s
    // OK.
    this.onTextDidChangeSignatureHelp(
      { changes: [textChange] },
      event.cursor.editor
    );
  }

  /**
   * Called when text changes and we think we might be typing arguments within
   * a function. Certain trigger characters will cause us to ask the language
   * server for an update.
   */
  async onTextDidChangeSignatureHelp(
    event: BufferStoppedChangingEvent,
    editor: TextEditor
  ) {
    let changes = filterTextChanges(event.changes);
    if (changes.length !== 1) return;
    let [change] = changes;

    // Use the start of the current selection as the cursor position.
    // (Autocomplete often inserts a placeholder and puts the cursor at
    // the end.)
    let cursorPosition = editor.getSelectedBufferRange().start;

    if (
      // Bail on deletions…
      change.newText.length === 0 ||
      // …multi-line changes…
      change.newRange.start.row !== change.newRange.end.row ||
      // …and changes that don’t cover the current cursor
      // position.
      !change.newRange.containsPoint(cursorPosition)
    ) {
      return this.unmountOverlay();
    }

    // The language client tells the language server about certain
    // “trigger” characters that should automatically trigger signature
    // help, so let’s use the character before the cursor as our trigger
    // character.
    let index = Math.max(
      0,
      cursorPosition.column - change.newRange.start.column - 1
    );

    let provider = this.#signatureRegistry.getProviderForEditor(editor) ??
      this.#signatureHelpRegistry.getProviderForEditor(editor);

    if (!provider) return;

    let potentialTriggerCharacter = change.newText[index];

    let alreadyOpen = this.currentOverlayType === 'signature-help';

    if (
      // Make a new signature help request if we just typed a trigger
      // character…
      provider.triggerCharacters?.has(potentialTriggerCharacter) === true ||
      // …or if we just typed a retrigger character _and_ the overlay was
      // already open.
      (
        isSignatureProvider(provider) &&
        provider.retriggerCharacters?.has(potentialTriggerCharacter) &&
        alreadyOpen
      )
    ) {
      let context = buildSignatureHelpContext('triggered', {
        character: potentialTriggerCharacter,
        isRetrigger: this.currentOverlayType === 'signature-help'
      });
      await this.showSignatureHelp(provider, editor, cursorPosition, context);
    }
  }

  onMouseMove(event: MouseEvent) {
    this.#mouseMoveTimer!.schedule(event);
  }

  /**
   * Called after the mouse pointer has remained in the exact same place for at
   * least the configured interval.
   */
  async onMouseRemain(event: MouseEvent) {
    if (this.editorView === null || this.editor === null) return;

    let component = this.editorView.getComponent();
    let screenPosition = component.screenPositionForMouseEvent(event);
    let coordinates = {
      mouse: component.pixelPositionForMouseEvent(event),
      screen: component.pixelPositionForScreenPosition(screenPosition)
    };
    let distance = Math.abs(coordinates.mouse.left - coordinates.screen.left);

    // If the distance between the pointer coordinates and the intended
    // overlay origin is greater than the default character width, it means
    // the mouse event occurred quite far away from where the text ends on
    // that row. Don't show the overlay in such situations, and hide any
    // existing overlays.
    if (distance >= this.editor.getDefaultCharWidth()) {
      if (this.currentOverlayType === 'hover') {
        return this.unmountOverlay();
      }
    }

    let point = this.editor.bufferPositionForScreenPosition(screenPosition);
    if (this.currentMarkerRange === null || !this.currentMarkerRange.containsPoint(point)) {
      await this.showHoverOverlay(this.editor, point);
    }
  }

  onCursorMove(event: CursorPositionChangedEvent) {
    this.#cursorMoveTimer!.schedule(event);
  }

  /**
   * Called after a cursor has stayed in one place for at least the configured
   * interval.
   */
  async onCursorRemain(event: CursorPositionChangedEvent) {
    if (event.textChanged) return;

    // When a hover overlay is open (or no overlays are open), the
    // `hover.showOnCursorMove` setting should be consulted.
    if (!this.showHoverOnCursorMove && this.currentOverlayType !== 'signature-help') {
      return;
    }

    // When a signature help overlay is open, the
    // `signatureHelp.showSignatureHelpWhileTyping` setting should govern
    // whether we keep it open on cursor move.
    if (!this.showSignatureHelpWhileTyping && this.currentOverlayType === 'signature-help') {
      return;
    }

    let editor = event.cursor.editor as TextEditor;
    let position = event.cursor.getBufferPosition();

    if (!this.currentMarkerRange?.containsPoint(position) && this.showHoverOnCursorMove) {
      await this.showHoverOverlay(editor, position);
    }
  }

  /**
   * Attempt to show hover information at the given buffer position. Identifies
   * a provider, asks it for information, and displays what it gets in return,
   * if anything.
   */
  async showHoverOverlay(editor: TextEditor, position: Point) {
    try {
      // Grab the background color of the editor so we can match it when
      // rendering code blocks in the overlay.
      let editorBackgroundColor = this.#getEditorBackgroundColor(editor);
      let result: Datatip | HoverInformation | null = null;

      // Prefer `hover` providers…
      for (let provider of this.#hoverRegistry.getAllProvidersForEditor(editor)) {
        let hoverInformation = await provider.hover(editor, position);
        if (hoverInformation) {
          result = hoverInformation;
          break;
        }
      }

      if (!result) {
        // …then fall back to `datatip` providers.
        for (let provider of this.#datatipRegistry.getAllProvidersForEditor(editor)) {
          const providerTip = await provider.datatip(editor, position);
          if (providerTip) {
            result = providerTip;
            break;
          }
        }
      }

      let element: HTMLElement | null = null;

      if (!result) {
        if (this.currentOverlayType === 'hover') {
          this.unmountOverlay();
        }
      } else {
        if (this.currentMarkerRange && result.range?.intersectsWith(this.currentMarkerRange)) {
          // No UI update is needed.
          return;
        }

        if (result.range && !result.range.containsPoint(position)) {
          return;
        }

        this.unmountOverlay();
        this.currentMarkerRange = result.range ?? new Range(position, position);

        if (isDatatip(result)) {
          result = convertDatatip(result);
        }

        if (result) {
          let { contents } = result;
          element = await renderOverlayContent({
            markdown: contents.value,
            containerClassName: 'hover-overlay-view-container',
            contentClassName: 'hover-overlay-view',
            editorStyles: {
              backgroundColor: editorBackgroundColor,
              fontFamily: atom.config.get('editor.fontFamily'),
              fontSize: `${atom.config.get('editor.fontSize')}px`
            }
          });
        }
      }

      let width = (editor.getElement() as TextEditorElement).getWidth();

      if (element) {
        element.style.setProperty('--text-editor-width', `${width}px`);
        this.overlayMarkerDisposables = this.mountOverlayWithMarker(
          editor,
          this.currentMarkerRange!,
          position,
          element,
          { type: 'hover' }
        );
      }
    } catch (err) {
      this.unmountOverlay();
      console.error(err);
    }
  }

  async onHoverToggleCommand(event: CommandEvent<TextEditorElement>) {
    let editor = event.currentTarget.getModel();
    if (!atom.workspace.isTextEditor(editor)) return;

    let position = editor.getCursorBufferPosition();
    let isTooltipOpenForPosition = this.currentMarkerRange?.containsPoint(position);
    if (isTooltipOpenForPosition === true) {
      return this.unmountOverlay();
    }

    await this.showHoverOverlay(editor, position);
  }

  async onSignatureHelpToggleCommand (event: CommandEvent<TextEditorElement>) {
    let editor = event.currentTarget.getModel();
    if (!atom.workspace.isTextEditor(editor)) return;

    // Since we don't get a range from the language server when we first show
    // the signature help overlay, it's tricker to figure out whether we should
    // open a new one or close one that may already be open.
    //
    // Instead we'll make it so that invoking this command while a signature
    // help overlay is open _always_ closes it; the user would then have to
    // invoke it again in order to show a new signature help overlay at their
    // current position. This feels like a pretty rare use case, so I'm OK with
    // this.
    if (this.currentOverlayType === 'signature-help') {
      return this.unmountOverlay();
    }

    // Otherwise let's ask the provider for a new signature help overlay.
    let position = editor.getCursorBufferPosition();
    let provider = this.#signatureHelpRegistry.getProviderForEditor(editor);
    if (!provider) return;

    let context = buildSignatureHelpContext('invoked', { isRetrigger: false });
    await this.showSignatureHelp(provider, editor, position, context);
  }

  mountOverlayWithMarker(
    editor: TextEditor,
    range: Range | null | undefined,
    position: Point,
    element: HTMLElement,
    {
      type,
      highlight = true,
      markerInvalidate = 'never',
      markerPosition = 'tail'
    }: MountOverlayWithMarkerOptions
  ) {
    let disposables = new CompositeDisposable();
    let highlightDecoration: Decoration | undefined = undefined;
    let overlayDecoration: Decoration | undefined = undefined;

    if (highlight) {
      let highlightMarker = editor.markBufferRange(
        range ?? new Range(position, position),
        { invalidate: 'never' }
      );

      let decorations = editor.getOverlayDecorations().filter((decoration) => {
        return (
          decoration.isType('highlight') &&
          decoration.getMarker().compare(highlightMarker) === 1
        );
      });

      if (decorations.length > 0) {
        highlightMarker.destroy();
      } else {
        highlightDecoration = editor.decorateMarker(highlightMarker, {
          type: 'highlight',
          class: 'hover-highlight-region'
        });
        disposables.add(
          new Disposable(() => {
            highlightMarker.destroy();
            highlightDecoration?.destroy();
          })
        );
      }
    }

    // The actual overlay should appear at the trigger position.
    let overlayMarker = editor.markBufferRange(
      new Range(position, position),
      { invalidate: markerInvalidate }
    );

    overlayDecoration = editor.decorateMarker(overlayMarker, {
      type: 'overlay',
      class: 'hover-overlay',
      position: markerPosition,
      item: element
    });

    disposables.add(
      new Disposable(() => {
        overlayMarker.destroy();
        overlayDecoration.destroy();
      })
    );

    this.currentOverlayType = type;

    if (this.showHoverOnMouseMove) {
      element.addEventListener('mouseenter', () => {
        // Mouse movement within the overlay should not trigger the editor’s
        // mousemove logic.
        this.editorView?.removeEventListener('mousemove', this._onMouseMove);
      });

      element.addEventListener('mouseleave', () => {
        this.editorView?.addEventListener('mousemove', this._onMouseMove);
      });

      disposables.add(
        new Disposable(() => {
          this.editorView?.addEventListener('mousemove', this._onMouseMove)
        })
      );
    }

    // HACK: It's disruptive if you're scrolling through the buffer and
    // everything stops just because your cursor hits an overlay. But if we
    // ignore mouse scroll events on the overlay altogether, it becomes much
    // harder for the user to scroll through an overlay if it's got a vertical
    // scrollbar.
    //
    // This is an imperfect hack, but it works for now. The idea is to prevent
    // the event from propagating if the overlay has a vertical scrollbar, but
    // otherwise pass it along.
    //
    // The ideal fix would be something like this but with a bit more nuance,
    // like the scroll behavior you get while swiping through a scrollport
    // within a viewport. But that can wait for now.
    element.addEventListener(
      'wheel',
      (e) => {
        // We apply `overflow: auto` to this container in our stylesheet, so
        // this also assumes that the user hasn't overridden that property for
        // whatever reason. I can live with that.
        let overflowContainer = element.querySelector('.hover-overlay-view-container') as HTMLElement | null;
        if (!overflowContainer) return;
        // Allow the overlay to scroll without scrolling the editor, but only
        // if its content overflows.
        if (overflowContainer.scrollHeight > overflowContainer.offsetHeight) {
          e.stopPropagation();
        }
      },
      { passive: true }
    );

    return disposables;
  }

  /**
   * Ask for signature help from a given provider and, if it is supplied, display it.
   *
   * @param provider The provider to query.
   * @param editor The current text editor.
   * @param position The position of the cursor in the buffer.
   * @param context The context data to pass to the language server.
   */
  async showSignatureHelp (
    provider: SignatureHelpProvider | SignatureProvider,
    editor: TextEditor,
    position: Point,
    context?: SignatureHelpContext
  ) {
    try {
      let signatureHelp = isSignatureProvider(provider) ?
        await provider.getSignature(editor, position, context) :
        await provider.getSignatureHelp(editor, position);

      this.unmountOverlay();

      if (!signatureHelp || signatureHelp.signatures.length === 0) {
        return;
      }

      let grammarName = editor.getGrammar().scopeName.toLowerCase();

      let index = signatureHelp.activeSignature ?? 0;
      let signature = signatureHelp.signatures[index];
      let paramIndex = signatureHelp.activeParameter ?? 0;
      let parameter = signature.parameters?.[paramIndex] ?? null;

      let markdown = ``;
      let highlight: [number, number] | null = null;

      if (parameter) {
        let result = buildParameterDocumentation(parameter, signature, grammarName, {
          includeSignatureDocumentation: atom.config.get(`pulsar-hover.signatureHelp.includeSignatureDocumentation`)
        });
        markdown = result.markdown;
        highlight = result.highlight;
      } else if (signature.documentation != null) {
        markdown = buildSignatureDocumentation(signature, grammarName);
      }

      if (!markdown) return;

      let element = await renderOverlayContent({
        markdown,
        containerClassName: 'hover-overlay-view-container',
        contentClassName: 'hover-overlay-view',
        editorStyles: {
          backgroundColor: this.#getEditorBackgroundColor(editor),
          fontFamily: atom.config.get('editor.fontFamily'),
          fontSize: `${atom.config.get('editor.fontSize')}px`
        }
      });

      let width = (editor.getElement() as TextEditorElement).getWidth();
      element.style.setProperty('--text-editor-width', `${width}px`);

      this.currentMarkerRange = new Range(position, position);
      this.overlayMarkerDisposables = this.mountOverlayWithMarker(
        editor, null, position, element,
        {
          type: 'signature-help',
          highlight: false,
          markerInvalidate: 'overlap',
          markerPosition: 'tail'
        }
      );

      if (highlight) {
        this._resizeObserver.observe(element);
        // We can't draw the highlights on screen until the overlay is
        // rendered, so we'll wait.
        this.onOverlayVisible(() => {
          this.#drawHighlight(element, highlight);
        });
      }
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * Fires a callback once the next time any overlay is visible.
   */
  onOverlayVisible (callback: () => void) {
    return this.#emitter.once('overlay-did-show', callback);
  }

  /**
   * Grab the background color of the editor so we can match it when rendering
   * code blocks in the overlay.
   */
  #getEditorBackgroundColor (editor: TextEditor) {
    let el = editor.getElement();
    let editorStyles = getComputedStyle(el);
    return editorStyles.backgroundColor;
  }

  /**
   * Highlight a substring of a method signature.
   */
  #drawHighlight (element: HTMLElement, highlight: [number, number]) {
    // TODO: Ugly. Refactor.
    let code = element.querySelector('pre > code') as HTMLPreElement | null;
    if (!code) return;

    let textNodes = collectTextNodes(element);
    if (textNodes.length === 0) return;
    while (!textNodes[0]?.textContent?.match(/\S/)) {
      textNodes.shift();
    }

    let [start, end] = highlight;

    // Borrow a technique from `TextEditorComponent`: collect all the text
    // nodes in order, then step through them until you find the bounds of what
    // you want to highlight. Turn that into a set of `DOMRect`s via
    // `Range::getClientRects()` (DOM `Range`, not Atom `Range`), then turn
    // those `DOMRect`s into `span`s.
    let startIndex = 0;
    let endIndex = 0;
    let startDelta = 0;
    let endDelta = 0;
    let targetStartNode: Text | null = null;
    let targetEndNode: Text | null = null;

    let i = 0;
    // Find our starting text node and offset.
    for (; i < textNodes.length; i++) {
      let textNode = textNodes[i];
      let len = textNode.textContent?.length ?? 0;
      if (startIndex + len >= start) {
        startDelta = start - startIndex;
        targetStartNode = textNode;
        break;
      }
      startIndex += len;
    }

    endIndex = startIndex;
    // Continuing where we left off, find our ending text node and offset.
    for (; i < textNodes.length; i++) {
      let textNode = textNodes[i];
      let len = textNode.textContent?.length ?? 0;
      if (endIndex + len >= end) {
        endDelta = end - endIndex;
        targetEndNode = textNode;
        break;
      }
      endIndex += len;
    }

    if (!targetStartNode || !targetEndNode) return;

    // Set the range bounds…
    let range = document.createRange();
    range.setStart(targetStartNode, startDelta);
    range.setEnd(targetEndNode, endDelta);

    // …then turn them into `DOMRect`s.
    let rects = range.getClientRects();
    if (!rects.length) return;

    // All these `DOMRect`s give coordinates relative to the viewport. But we
    // want to position them relative to the containing `pre` element, so we
    // grab its `DOMRect` in order to calculate relative offsets.
    if (!code.parentNode) return;
    let pre = code.parentNode as HTMLPreElement;
    let preRect = pre.getBoundingClientRect();

    // Since there are lots of `span`s involved due to all the syntax
    // highlighting, we might get lots of `DOMRect`s. So we'll consolidate and
    // merge overlapping `DOMRect`s to minimize the number of `spans` we
    // create.
    let consolidatedRects = consolidateClientRects(Array.from(rects));

    // `DOMRect`s for text are too stubby; we want to use the height of the
    // line rather than the actual height of the drawn text.
    let codeLineHeight = getComputedStyle(code).lineHeight;
    let lineHeight = parseFloat(codeLineHeight);
    if (isNaN(lineHeight)) {
      // But we'll fall back to the height of the drawn text if `line-height`
      // is somehow invalid.
      lineHeight = rects[0].height;
    }

    let highlightElements = consolidatedRects.map((rect) => {
      let style = {
        // Relative to the top-left corner of the `pre`, but adjust for border
        // width/height (which is accounted for in `getBoundingClientRect` but
        // not in the positioning context)… and compensate for line height.
        top: rect.top - pre.clientTop - preRect.top + rect.height - lineHeight,
        left: rect.left - pre.clientLeft - preRect.left,
        height: lineHeight,
        width: rect.width
      };

      let span = document.createElement('span');
      span.classList.add('highlight');
      span.style.top = `${style.top}px`;
      span.style.left = `${style.left}px`;
      span.style.width = `${style.width}px`;
      span.style.height = `${style.height}px`;

      return span;
    });

    for (let highlightElement of highlightElements) {
      code.parentNode?.appendChild(highlightElement)
    }
  }
}

/**
 * Given an element, collects all its individual text nodes regardless of depth
 * and returns them in document order.
 */
function collectTextNodes (element: HTMLElement) {
  function collect(element: HTMLElement, existingResult: Text[]) {
    for (let i = 0; i < element.childNodes.length; i++) {
      let node = element.childNodes[i];
      if (node.nodeType === Node.TEXT_NODE) {
        existingResult.push(node as Text);
      } else if (node.childNodes) {
        collect(node as HTMLElement, existingResult);
      }
    }
  }

  let result: Text[] = [];
  collect(element, result);
  return result;
}


/**
 * Indicates whether two `DOMRect`s overlap.
 */
function rectsOverlap(rectA: DOMRectLike, rectB: DOMRectLike) {
  if (rectA.right < rectB.left) return false;
  if (rectA.left > rectB.right) return false;
  if (rectA.top > rectB.bottom) return false;
  if (rectA.bottom < rectB.top) return false;
  return true;
}

type DOMRectLike = {
  x: number,
  y: number,
  width: number,
  height: number,
  top: number,
  left: number,
  bottom: number,
  right: number
};

/**
 * Given two `DOMRect`s that overlap, merge them into a pseudo-`DOMRect` that
 * represents the larger area.
 */
function mergeOverlappingRects(rectA: DOMRectLike, rectB: DOMRectLike): DOMRectLike {
  let x = Math.min(rectA.x, rectB.x);
  let y = Math.min(rectA.top, rectB.top);
  let left = Math.min(rectA.left, rectB.left);
  let right = Math.max(rectA.right, rectB.right);
  let width = right - left;
  let top = Math.min(rectA.top, rectB.top);
  let bottom = Math.max(rectA.bottom, rectB.bottom);
  let height = bottom - top;

  return { x, y, left, right, width, top, bottom, height };
}

/**
 * Given any number of `DOMRect`s that might overlap, consolidate them into a
 * discrete number of `DOMRect`s that do not overlap.
 */
function consolidateClientRects(clientRects: DOMRectLike[]): DOMRectLike[] {
  let results: DOMRectLike[] = [];
  // This technique only works if the rects are sorted such that any two rects
  // that overlap are adjacent in the list.
  clientRects.sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    if (a.left !== b.left) return a.left - b.left;
    return 0;
  })
  for (let i = 0; i < clientRects.length; i++) {
    let rect = clientRects[i];
    let previousRect = results[results.length - 1];
    if (previousRect && rectsOverlap(previousRect, rect)) {
      results[results.length - 1] = mergeOverlappingRects(previousRect, rect);
    } else {
      results.push(rect);
    }
  }
  return results;
}

/**
 * Determine a parameter’s description by either using the string given
 * or taking the specified substring from the signature.
 */
function interpretParameterLabel (label: SignatureParameter['label'], signature: Signature): { label: string, highlight: [number, number] | null } {
  if (typeof label === 'string') {
    if (signature.label && signature.label.includes(label)) {
      let start = signature.label.indexOf(label);
      let end = start + label.length;
      // Return the whole signature's label and the bounds of the highlight.
      return { label: signature.label, highlight: [start, end] };
    }
    // Return only the parameter label.
    return { label, highlight: null };
  }
  return { label: signature.label, highlight: label };
}

function buildFencedCodeBlock (value: string, grammarName?: string) {
  return `\`\`\`${grammarName ?? ''}\n${value}\n\`\`\`\n`
}

function buildParameterDocumentation (parameter: SignatureParameter, signature: Signature, grammarName: string = '', {
  includeSignatureDocumentation = false
}: { includeSignatureDocumentation?: boolean } = {}) {
  let doc;
  if (parameter.documentation == null) {
    doc = '';
  } else if (typeof parameter.documentation === 'string') {
    doc = parameter.documentation;
  } else {
    doc = parameter.documentation.value;
  }

  let { label, highlight } = interpretParameterLabel(parameter.label, signature);

  let signatureLabel = buildSignatureDocumentation(signature) ?? '';

  // When the signature has its own documentation, we can place it below the
  // parameter’s documentation with a horizontal rule as a separator.
  if (signatureLabel && includeSignatureDocumentation) {
    signatureLabel = `\n\n---\n\n${signatureLabel}`;
  } else {
    signatureLabel = '';
  }

  return {
    markdown: `${buildFencedCodeBlock(label, grammarName)}\n${doc}${signatureLabel}`,
    highlight
  }
}

function buildSignatureDocumentation (signature: Signature, _grammarName?: string) {
  let doc;
  if (signature.documentation == null) {
    doc = '';
  } else if (typeof signature.documentation === 'string') {
    doc = signature.documentation;
  } else {
    doc = signature.documentation.value;
  }
  return doc;
}

/**
 * Informal type corresponding to the three ways signature help can be
 * triggered.
 */
// TODO: Investigate `content-changed`; not clear on that one and we don’t use
// it yet.
type TriggerKind = 'triggered' | 'invoked' | 'content-changed';

/**
 * Build a `SignatureHelpContext` as described by the LSP spec.
 */
function buildSignatureHelpContext (mode: TriggerKind, {
  character,
  isRetrigger = false
}: { character?: string, isRetrigger?: boolean } = {}) {
  let triggerKind: SignatureHelpTriggerKind;
  switch (mode) {
    case 'triggered':
      triggerKind = SignatureHelpTriggerKind.TriggerCharacter;
      break;
    case 'invoked':
      triggerKind = SignatureHelpTriggerKind.Invoked;
      break;
    case 'content-changed':
      triggerKind = SignatureHelpTriggerKind.ContentChange;
  }
  // TODO: `activeSignatureHelp`?
  let context: SignatureHelpContext = { triggerKind, isRetrigger };
  if (character != null) {
    context.triggerCharacter = character;
  }
  return context;
}

function isEmptyTextChange (change: TextChange) {
  return change.oldText === change.newText;
}

function filterTextChanges (changes: BufferStoppedChangingEvent['changes']) {
  return changes.filter((change) => !isEmptyTextChange(change));
}

/**
 * Determines whether a cursor position change is likely the equivalent of
 * the user having typed the second of a typing pair.
 */
function isTypingPairSkip (event: CursorPositionChangedEvent) {
  let { newBufferPosition: newPos, oldBufferPosition: oldPos } = event;
  if (newPos.row !== oldPos.row) return false;
  if (oldPos.column + 1 !== newPos.column) return false;
  let range = new Range(oldPos, newPos);
  let text = event.cursor.editor.getTextInBufferRange(range);
   return /[\]\)\}>'"]/.test(text);
}

/**
 * Distinguishes `SignatureProvider` from `SignatureHelpProvider`.
 */
function isSignatureProvider (provider: SignatureHelpProvider | SignatureProvider | null): provider is SignatureProvider {
  if (provider == null) return false;
  return ('getSignature' in provider);
}

console.log()
