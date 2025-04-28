import { CompositeDisposable, Disposable, Range, Point, TextEditor, TextEditorElement, CommandEvent, CursorPositionChangedEvent } from 'atom';
import type { DatatipProvider } from 'atom-ide-base';
import ProviderRegistry from './provider-registry';
import { HoverProvider } from './hover';
export default class OverlayManager {
    #private;
    editor: TextEditor | null;
    editorView: TextEditorElement | null;
    editorSubscriptions: CompositeDisposable | null;
    overlayMarkerDisposables: CompositeDisposable | null;
    showOnCursorMove: boolean;
    showOnMouseMove: boolean;
    currentMarkerRange: Range | null;
    hoverTime: number;
    _onMouseMove: (event: MouseEvent) => void;
    constructor();
    initialize(): void;
    get datatipService(): ProviderRegistry<DatatipProvider>;
    get hoverRegistry(): ProviderRegistry<HoverProvider>;
    watchEditor(editor: TextEditor): Disposable | undefined;
    updateCurrentEditor(editor: TextEditor | null): void;
    dispose(): void;
    unmountOverlay(): void;
    onMouseMove(event: MouseEvent): void;
    onCursorMove(event: CursorPositionChangedEvent): void;
    showOverlay(editor: TextEditor, position: Point): Promise<void>;
    onCommandEvent(event: CommandEvent<TextEditorElement>): Promise<void>;
    mountOverlayWithMarker(editor: TextEditor, range: Range, position: Point, element: HTMLElement): CompositeDisposable;
}
