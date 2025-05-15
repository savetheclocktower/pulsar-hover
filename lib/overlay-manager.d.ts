import { CompositeDisposable, Disposable, Range, Point, TextEditor, TextEditorElement, CommandEvent, CursorPositionChangedEvent, BufferStoppedChangingEvent } from 'atom';
import type { SignatureHelpContext } from 'vscode-languageserver-protocol';
import type { DatatipProvider, SignatureHelpProvider } from 'atom-ide-base';
import ProviderRegistry from './provider-registry';
import { HoverProvider } from './hover';
import { SignatureProvider } from './signature';
type MountOverlayWithMarkerOptions = {
    type: OverlayType;
    highlight?: boolean;
    markerInvalidate?: 'never' | 'surround' | 'overlap' | 'inside' | 'touch';
    markerPosition?: 'head' | 'tail';
};
type OverlayType = 'signature-help' | 'hover';
export default class OverlayManager {
    #private;
    editor: TextEditor | null;
    editorView: TextEditorElement | null;
    editorSubscriptions: CompositeDisposable | null;
    overlayMarkerDisposables: CompositeDisposable | null;
    showHoverOnCursorMove: boolean;
    showHoverOnMouseMove: boolean;
    showSignatureHelpWhileTyping: boolean;
    hoverTime: number;
    currentMarkerRange: Range | null;
    currentOverlayType?: OverlayType;
    _onMouseMove: (event: MouseEvent) => void;
    _onMouseRemain: (event: MouseEvent) => void;
    _onCursorMove: (event: CursorPositionChangedEvent) => void;
    _onCursorRemain: (event: CursorPositionChangedEvent) => void;
    _resizeObserver: ResizeObserver;
    constructor();
    initialize(): void;
    get datatipService(): ProviderRegistry<DatatipProvider>;
    get signatureHelpService(): ProviderRegistry<SignatureHelpProvider>;
    get hoverRegistry(): ProviderRegistry<HoverProvider>;
    get signatureRegistry(): ProviderRegistry<SignatureProvider>;
    watchEditor(editor: TextEditor): Disposable | undefined;
    updateCurrentEditor(editor: TextEditor | null): void;
    dispose(): void;
    unmountOverlay(): void;
    onCursorDidChangeSignatureHelp(event: CursorPositionChangedEvent): Promise<void>;
    /**
     * Called when text changes and we think we might be typing arguments within
     * a function. Certain trigger characters will cause us to ask the language
     * server for an update.
     */
    onTextDidChangeSignatureHelp(event: BufferStoppedChangingEvent, editor: TextEditor): Promise<void>;
    onMouseMove(event: MouseEvent): void;
    /**
     * Called after the mouse pointer has remained in the exact same place for at
     * least the configured interval.
     */
    onMouseRemain(event: MouseEvent): Promise<void>;
    onCursorMove(event: CursorPositionChangedEvent): void;
    /**
     * Called after a cursor has stayed in one place for at least the configured
     * interval.
     */
    onCursorRemain(event: CursorPositionChangedEvent): Promise<void>;
    /**
     * Attempt to show hover information at the given buffer position. Identifies
     * a provider, asks it for information, and displays what it gets in return,
     * if anything.
     */
    showHoverOverlay(editor: TextEditor, position: Point): Promise<void>;
    onHoverToggleCommand(event: CommandEvent<TextEditorElement>): Promise<void>;
    onSignatureHelpToggleCommand(event: CommandEvent<TextEditorElement>): Promise<void>;
    mountOverlayWithMarker(editor: TextEditor, range: Range | null | undefined, position: Point, element: HTMLElement, { type, highlight, markerInvalidate, markerPosition }: MountOverlayWithMarkerOptions): CompositeDisposable;
    /**
     * Ask for signature help from a given provider and, if it is supplied, display it.
     *
     * @param provider The provider to query.
     * @param editor The current text editor.
     * @param position The position of the cursor in the buffer.
     * @param context The context data to pass to the language server.
     */
    showSignatureHelp(provider: SignatureHelpProvider | SignatureProvider, editor: TextEditor, position: Point, context?: SignatureHelpContext): Promise<void>;
    /**
     * Fires a callback once the next time any overlay is visible.
     */
    onOverlayVisible(callback: any): Disposable;
}
export {};
