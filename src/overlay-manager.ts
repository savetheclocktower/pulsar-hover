import {
  CompositeDisposable,
  Disposable,
  Range,
  Point,
  TextEditor,
  TextEditorElement,
  CommandEvent,
  CursorPositionChangedEvent
} from 'atom';

declare module 'atom' {
  interface TextEditor {
    getElement(): HTMLElement
  }
  interface TextEditorElement {
    getWidth(): number
  }
}

import type { Datatip, DatatipProvider, MarkedString } from 'atom-ide-base';

import ProviderRegistry from './provider-registry';
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

export default class OverlayManager {
  #subscriptions: CompositeDisposable = new CompositeDisposable();
  #providerRegistry: ProviderRegistry<DatatipProvider> = new ProviderRegistry();
  #hoverRegistry: ProviderRegistry<HoverProvider> = new ProviderRegistry();

  #watchedEditors: WeakSet<TextEditor> = new WeakSet();

  editor: TextEditor | null = null;
  editorView: TextEditorElement | null = null;

  editorSubscriptions: CompositeDisposable | null = null;
  overlayMarkerDisposables: CompositeDisposable | null = null;

  showOverlayOnCursorMove = false;
  showOverlayOnMouseMove = true;

  currentMarkerRange: Range | null = null;

  #cursorMoveTimer?: Timer;
  #mouseMoveTimer?: Timer;

  hoverTime = atom.config.get("pulsar-hover.hoverTime") as number;

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
      atom.config.observe("pulsar-hover.hoverTime", () => {
        this.#createTimers();
      }),
      atom.workspace.observeTextEditors((editor) => {
        let disposable = this.watchEditor(editor);
        editor.onDidDestroy(() => disposable?.dispose());
      }),
      atom.commands.add('atom-text-editor', {
        'pulsar-hover:toggle': event => this.onCommand(event)
      }),
      atom.config.observe('pulsar-hover.showOverlayOnCursorMove', (value) => {
        this.showOverlayOnCursorMove = value;
        // Forces update of internal editor tracking.
        let editor = this.editor;
        this.editor = null;
        this.updateCurrentEditor(editor);
      }),
      atom.config.observe('pulsar-hover.showOverlayOnMouseMove', (value) => {
        this.showOverlayOnMouseMove = value;
        // Forces update of internal editor tracking.
        let editor = this.editor;
        this.editor = null;
        this.updateCurrentEditor(editor);
      })
    )
  }

  get datatipService() {
    return this.#providerRegistry;
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

    if (this.showOverlayOnMouseMove) {
      this.editorView.addEventListener('mousemove', this._onMouseMove);
    }

    this.editorSubscriptions.add(
      this.editor.onDidChangeCursorPosition(onCursorMove),
      this.editor.getBuffer().onDidChangeText((event) => {
        if (event.changes.length === 0) return;
        this.unmountOverlay();
      }),
      new Disposable(() => {
        this.editorView?.removeEventListener('mousemove', this._onMouseMove);
      })
    );
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
    this.overlayMarkerDisposables?.dispose();
    this.overlayMarkerDisposables = null;
  }

  onMouseMove(event: MouseEvent) {
    this.#mouseMoveTimer!.schedule(event);
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
      return this.unmountOverlay();
    }

    let point = this.editor.bufferPositionForScreenPosition(screenPosition);
    if (this.currentMarkerRange === null || !this.currentMarkerRange.containsPoint(point)) {
      await this.showOverlay(this.editor, point);
    }
  }

  onCursorMove(event: CursorPositionChangedEvent) {
    this.#cursorMoveTimer!.schedule(event);
  }

  async onCursorRemain(event: CursorPositionChangedEvent) {
    if (event.textChanged || !this.showOverlayOnCursorMove)
      return;

    // @ts-ignore internal API
    let editor = event.cursor.editor as TextEditor;
    let position = event.cursor.getBufferPosition();

    if (!this.currentMarkerRange?.containsPoint(position)) {
      await this.showOverlay(editor, position);
    }
  }

  async showOverlay(editor: TextEditor, position: Point) {
    try {
      // Grab the background color of the editor so we can match it when
      // rendering code blocks in the overlay.
      let el = editor.getElement();
      let editorStyles = getComputedStyle(el);
      let editorBackgroundColor = editorStyles.backgroundColor;
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
        for (let provider of this.#providerRegistry.getAllProvidersForEditor(editor)) {
          const providerTip = await provider.datatip(editor, position);
          if (providerTip) {
            result = providerTip;
            break;
          }
        }
      }

      let element: HTMLElement | null = null;

      if (!result) {
        this.unmountOverlay();
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
        this.overlayMarkerDisposables = this.mountOverlayWithMarker(editor, this.currentMarkerRange!, position, element);
      }
    } catch (err) {
      this.unmountOverlay();
      console.error(err);
    }
  }

  async onCommand(event: CommandEvent<TextEditorElement>) {
    let editor = event.currentTarget.getModel();
    if (!atom.workspace.isTextEditor(editor)) return;

    let position = editor.getCursorBufferPosition();
    let isTooltipOpenForPosition = this.currentMarkerRange?.containsPoint(position);
    if (isTooltipOpenForPosition === true) {
      return this.unmountOverlay();
    }

    await this.showOverlay(editor, position);
  }

  mountOverlayWithMarker(
    editor: TextEditor,
    range: Range,
    position: Point,
    element: HTMLElement
  ) {
    let disposables = new CompositeDisposable();
    let highlightMarker = editor.markBufferRange(range, { invalidate: 'never' });

    let decorations = editor.getOverlayDecorations().filter((decoration) => {
      return decoration.isType('highlight') && decoration.getMarker().compare(highlightMarker) === 1;
    });

    if (decorations.length > 0) {
      highlightMarker.destroy();
    } else {
      disposables.add(new Disposable(() => highlightMarker.destroy()));

      editor.decorateMarker(highlightMarker, {
        type: 'highlight',
        class: 'datatip-highlight-region'
      });
    }

    // The actual overlay should appear at the trigger position.
    let overlayMarker = editor.markBufferRange(
      new Range(position, position),
      { invalidate: 'never' }
    );

    editor.decorateMarker(overlayMarker, {
      type: 'overlay',
      class: 'hover-overlay',
      position: 'tail',
      item: element
    });

    disposables.add(new Disposable(() => overlayMarker.destroy()));

    if (this.showOverlayOnMouseMove) {
      element.addEventListener('mouseenter', () => {
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

    element.addEventListener(
      'wheel',
      (e) => e.stopPropagation(),
      { passive: true }
    );

    return disposables;
  }
}
