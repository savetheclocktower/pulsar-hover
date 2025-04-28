import {
  CompositeDisposable,
  Disposable,
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

import { SignatureHelpContext, SignatureHelpTriggerKind } from 'vscode-languageserver-protocol';

import type { Datatip, DatatipProvider, MarkedString, Signature, SignatureParameter } from 'atom-ide-base';

import ProviderRegistry, { AugmentedSignatureHelpProvider } from './provider-registry';
import { Timer } from './util';
import { HoverInformation, HoverProvider } from './hover';
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
  #subscriptions: CompositeDisposable = new CompositeDisposable();
  #datatipRegistry: ProviderRegistry<DatatipProvider> = new ProviderRegistry();
  #hoverRegistry: ProviderRegistry<HoverProvider> = new ProviderRegistry();
  #signatureHelpRegistry: ProviderRegistry<AugmentedSignatureHelpProvider> = new ProviderRegistry();

  #watchedEditors: WeakSet<TextEditor> = new WeakSet();

  editor: TextEditor | null = null;
  editorView: TextEditorElement | null = null;

  editorSubscriptions: CompositeDisposable | null = null;
  overlayMarkerDisposables: CompositeDisposable | null = null;

  showHoverOnCursorMove = false;
  showHoverOnMouseMove = true;
  showSignatureHelpWhileTyping = true;

  currentMarkerRange: Range | null = null;
  currentOverlayType?: OverlayType;

  #cursorMoveTimer?: Timer;
  #mouseMoveTimer?: Timer;

  hoverTime = atom.config.get("pulsar-hover.hover.hoverTime") as number;

  _onMouseMove: (event: MouseEvent) => void
  _onMouseRemain: (event: MouseEvent) => void
  _onCursorRemain: (event: CursorPositionChangedEvent) => void

  constructor() {
    this.#createTimers();
    this._onMouseMove = this.onMouseMove.bind(this);
    this._onMouseRemain = this.onMouseRemain.bind(this);
    this._onCursorRemain = this.onCursorRemain.bind(this);
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
      atom.config.observe("pulsar-hover.hover.hoverTime", () => {
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

    let onCursorMove = this.onCursorMove.bind(this);

    if (this.showHoverOnMouseMove) {
      this.editorView.addEventListener('mousemove', this._onMouseMove);
    }

    this.editorSubscriptions.add(
      this.editor.onDidChangeCursorPosition(onCursorMove),
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

  onMouseMove(event: MouseEvent) {
    this.#mouseMoveTimer!.schedule(event);
  }

  async onCursorDidChangeSignatureHelp(event: CursorPositionChangedEvent) {
    if (event.textChanged) return;
    if (!isTypingPairSkip(event)) return;

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

  async onTextDidChangeSignatureHelp (event: BufferStoppedChangingEvent, editor: TextEditor) {
      let changes = filterTextChanges(event.changes)
      if (changes.length !== 1) return;
      let [change] = changes;

      // Use the start of the current selection as the cursor position.
      // (Autocomplete often inserts a placeholder and puts the cursor at
      // the end.)
      let cursorPosition = editor.getSelectedBufferRange().start;

      if (
        // Ignore deletions…
        change.newText.length === 0 ||
        // …ignore multi-line changes…
        change.newRange.start.row !== change.newRange.end.row ||
        // …and ignore changes that don’t cover the current cursor
        // position.
        !change.newRange.containsPoint(cursorPosition)
      ) {
        console.log('UNMOUNTED!');
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

      let provider = this.#signatureHelpRegistry.getProviderForEditor(editor);
      if (!provider) return;

      console.log('[signature] got a provider');

      let potentialTriggerCharacter = change.newText[index];
      console.log('[signature] potentialTriggerCharacter:', potentialTriggerCharacter, change, event.changes);

      let alreadyOpen = this.currentOverlayType === 'signature-help';

      if (
        // Make a new signature help request if we just typed a trigger
        // character…
        provider.triggerCharacters?.has(potentialTriggerCharacter) === true ||
        // …or if we just typed a retrigger character _and_ the overlay was
        // already open…
        (provider.retriggerCharacters?.has(potentialTriggerCharacter) && alreadyOpen) // ||
        // // …or it should not
        // // get dismissed just because we typed a space character.
        // !(/\S/).test(change.newText) && alreadyOpen
      ) {
        let context = buildSignatureHelpContext('triggered', {
          character: potentialTriggerCharacter,
          isRetrigger: this.currentOverlayType === 'signature-help'
        });
        await this.showSignatureHelp(provider, editor, cursorPosition, context);
      }
  }

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
    //
    // @ts-ignore Internal API
    if (distance >= this.editor.getDefaultCharWidth()) {
      console.log('hiding!');
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

    if (!this.currentMarkerRange?.containsPoint(position)) {
      await this.showHoverOverlay(editor, position);
    }
  }

  #getEditorBackgroundColor (editor: TextEditor) {
    // Grab the background color of the editor so we can match it when
    // rendering code blocks in the overlay.
    let el = editor.getElement();
    let editorStyles = getComputedStyle(el);
    return editorStyles.backgroundColor;
  }

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
          element = document.createElement('div');
          element.appendChild(
            await renderOverlayContent({
              markdown: contents.value,
              containerClassName: 'hover-overlay-view-container',
              contentClassName: 'hover-overlay-view',
              editorStyles: {
                backgroundColor: editorBackgroundColor,
                fontFamily: atom.config.get('editor.fontFamily')
              }
            })
          );
        }
      }

      let width = (editor.getElement() as TextEditorElement).getWidth();

      if (element) {
        element.style.maxWidth = `${width}px`;
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

    let position = editor.getCursorBufferPosition();
    let isTooltipOpenForPosition = this.currentMarkerRange?.containsPoint(position);
    if (isTooltipOpenForPosition === true && this.currentOverlayType === 'signature-help') {
      return this.unmountOverlay();
    }

    let provider = this.#signatureHelpRegistry.getProviderForEditor(editor);
    if (!provider) return;

    let context = buildSignatureHelpContext('invoked', { isRetrigger: false });

    // await this.showSignatureHelp(provider, editor, position, context);
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
      let highlightMarker = editor.markBufferRange(range ?? new Range(position, position), { invalidate: 'never' });

      let decorations = editor.getOverlayDecorations().filter((decoration) => {
        return decoration.isType('highlight') && decoration.getMarker().compare(highlightMarker) === 1;
      });

      if (decorations.length > 0) {
        highlightMarker.destroy();
      } else {
        highlightDecoration = editor.decorateMarker(highlightMarker, {
          type: 'highlight',
          class: 'datatip-highlight-region'
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
    provider: AugmentedSignatureHelpProvider,
    editor: TextEditor,
    position: Point,
    context?: SignatureHelpContext
  ) {
    try {
      let signatureHelp = await provider.getSignatureHelp(editor, position, context);

      this.unmountOverlay();

      if (!signatureHelp || signatureHelp.signatures.length === 0) {
        return;
      }

      let grammarName = editor.getGrammar().scopeName.toLowerCase();

      let index = signatureHelp.activeSignature ?? 0;
      let signature = signatureHelp.signatures[index];
      let paramIndex = signatureHelp.activeParameter ?? 0;
      let parameter = signature.parameters?.[paramIndex] ?? null;

      let doc = ``;

      // TODO: VS Code’s presentation of this data is arguably more helpful:
      // instead of displaying just one parameter at a time in the signature,
      // they display the _entire_ signature and highlight the active parameter
      // within it.
      //
      // But because we are doing syntax highlighting within code blocks, this
      // is tricky! We could do one of two things:
      //
      // * Abandon syntax highlighting for this presentation and instead format
      //   the signatures in plaintext, thus making it easier to wrap our
      //   desired regions in `span`s;
      // * Figure out how to include marker information within our headless
      //   syntax highlighting strategy so that we can include that data when
      //   turning our `HighlightIterator` into `span`s. (In theory, this could
      //   be tricky, but the ranges identified by the language server would be
      //   extremely unlikely to straddle scope boundaries in weird ways).
      //
      // Either way, this is a task for later.
      if (parameter) {
        doc = buildParameterDocumentation(parameter, signature, grammarName);
      } else if (signature.documentation != null) {
        doc = buildSignatureDocumentation(signature, grammarName);
      }

      let element = document.createElement('div');
      element.appendChild(
        await renderOverlayContent({
          markdown: doc,
          containerClassName: 'hover-overlay-view-container',
          contentClassName: 'hover-overlay-view',
          editorStyles: {
            backgroundColor: this.#getEditorBackgroundColor(editor),
            fontFamily: atom.config.get('editor.fontFamily')
          }
        })
      );

      let width = (editor.getElement() as TextEditorElement).getWidth();
      element.style.maxWidth = `${width}px`;

      this.overlayMarkerDisposables = this.mountOverlayWithMarker(
        editor, null, position, element,
        {
          type: 'signature-help',
          highlight: false,
          markerInvalidate: 'overlap',
          markerPosition: 'tail'
        }
      );
    } catch (err) {
      console.error(err);
    }
  }
}

function interpretParameterLabel (label: SignatureParameter['label'], signature: Signature) {
  if (typeof label === 'string') return label;
  return signature.label.substring(label[0], label[1]);
}

function buildFencedCodeBlock (value: string, grammarName?: string) {
  return `\`\`\`${grammarName ?? ''}\n${value}\n\`\`\`\n`
}

function buildParameterDocumentation (parameter: SignatureParameter, signature: Signature, grammarName: string = '') {
  let doc;
  if (parameter.documentation == null) {
    doc = '';
  } else if (typeof parameter.documentation === 'string') {
    doc = parameter.documentation;
  } else {
    doc = parameter.documentation.value;
  }

  let label = interpretParameterLabel(parameter.label, signature);

  let signatureLabel = buildSignatureDocumentation(signature) ?? '';

  if (signatureLabel) {
    signatureLabel = `\n\n---\n\n${signatureLabel}`;
  }

  return `${buildFencedCodeBlock(label, grammarName)}\n${doc}${signatureLabel}`;
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

type TriggerKind = 'triggered' | 'invoked' | 'content-changed';
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
  let context: SignatureHelpContext = { triggerKind, isRetrigger };
  if (character != null) {
    context.triggerCharacter = character;
  }
  return context;
}

function isEmptyTextChange (change: TextChange) {
  console.log('isEmpty?', change);
  return change.oldText === change.newText;
}

function filterTextChanges (changes: BufferStoppedChangingEvent['changes']) {
  return changes.filter((change) => !isEmptyTextChange(change));
}

function isTypingPairSkip (event: CursorPositionChangedEvent) {
  let { newBufferPosition: newPos, oldBufferPosition: oldPos } = event;
  if (newPos.row !== oldPos.row) return false;
  if (oldPos.column + 1 !== newPos.column) return false;
  let range = new Range(oldPos, newPos);
  let text = event.cursor.editor.getTextInBufferRange(range);
   return /[\]\)\}'"]/.test(text);
}
