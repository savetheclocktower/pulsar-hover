import { CompositeDisposable, Disposable, Range, Point, TextEditor, TextEditorElement, CommandEvent, CursorPositionChangedEvent } from 'atom';
declare module 'atom' {
    interface TextEditor {
        getElement(): HTMLElement;
    }
    interface TextEditorElement {
        getWidth(): number;
    }
}
import type { DatatipProvider } from 'atom-ide-base';
import ProviderRegistry from './provider-registry';
import { HoverProvider } from './hover';
export default class OverlayManager {
    #private;
    editor: TextEditor | null;
    editorView: TextEditorElement | null;
    editorSubscriptions: CompositeDisposable | null;
    overlayMarkerDisposables: CompositeDisposable | null;
    showOverlayOnCursorMove: boolean;
    showOverlayOnMouseMove: boolean;
    currentMarkerRange: Range | null;
    hoverTime: number;
    _onMouseMove: (event: MouseEvent) => void;
    _onMouseRemain: (event: MouseEvent) => void;
    _onCursorRemain: (event: CursorPositionChangedEvent) => void;
    constructor();
    initialize(): void;
    get datatipService(): ProviderRegistry<DatatipProvider>;
    get hoverRegistry(): ProviderRegistry<HoverProvider>;
    watchEditor(editor: TextEditor): Disposable | undefined;
    updateCurrentEditor(editor: TextEditor | null): void;
    dispose(): void;
    unmountOverlay(): void;
    onMouseMove(event: MouseEvent): void;
    onMouseRemain(event: MouseEvent): Promise<void>;
    onCursorMove(event: CursorPositionChangedEvent): void;
    onCursorRemain(event: CursorPositionChangedEvent): Promise<void>;
    showOverlay(editor: TextEditor, position: Point): Promise<void>;
    onCommand(event: CommandEvent<TextEditorElement>): Promise<void>;
    mountOverlayWithMarker(editor: TextEditor, range: Range, position: Point, element: HTMLElement): CompositeDisposable;
}
