import { CompositeDisposable, Disposable, Range, Point, TextEditor, TextEditorElement, CommandEvent, CursorPositionChangedEvent, BufferStoppedChangingEvent } from 'atom';
import { SignatureHelpContext } from 'vscode-languageserver-protocol';
import type { DatatipProvider } from 'atom-ide-base';
import ProviderRegistry, { AugmentedSignatureHelpProvider } from './provider-registry';
import { HoverProvider } from './hover';
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
    currentMarkerRange: Range | null;
    currentOverlayType?: OverlayType;
    hoverTime: number;
    _onMouseMove: (event: MouseEvent) => void;
    _onMouseRemain: (event: MouseEvent) => void;
    _onCursorRemain: (event: CursorPositionChangedEvent) => void;
    constructor();
    initialize(): void;
    get datatipService(): ProviderRegistry<DatatipProvider>;
    get signatureHelpService(): ProviderRegistry<AugmentedSignatureHelpProvider>;
    get hoverRegistry(): ProviderRegistry<HoverProvider>;
    watchEditor(editor: TextEditor): Disposable | undefined;
    updateCurrentEditor(editor: TextEditor | null): void;
    dispose(): void;
    unmountOverlay(): void;
    onMouseMove(event: MouseEvent): void;
    onCursorDidChangeSignatureHelp(event: CursorPositionChangedEvent): Promise<void>;
    onTextDidChangeSignatureHelp(event: BufferStoppedChangingEvent, editor: TextEditor): Promise<void>;
    onMouseRemain(event: MouseEvent): Promise<void>;
    onCursorMove(event: CursorPositionChangedEvent): void;
    onCursorRemain(event: CursorPositionChangedEvent): Promise<void>;
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
    showSignatureHelp(provider: AugmentedSignatureHelpProvider, editor: TextEditor, position: Point, context?: SignatureHelpContext): Promise<void>;
}
export {};
