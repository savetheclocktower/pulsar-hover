import type { DatatipService } from "atom-ide-base";
import { HoverProvider } from "./hover";
export declare function activate(): void;
export declare function deactivate(): void;
export declare function provideDatatipService(): DatatipService;
export declare function consumeHover(provider: HoverProvider): void;
