import type { DatatipService } from "atom-ide-base";
import { HoverProvider } from "./hover";
import { AugmentedSignatureHelpProvider } from "./provider-registry";
export declare function activate(): void;
export declare function deactivate(): void;
export declare function provideDatatipService(): DatatipService;
export declare function provideSignatureHelpService(): (provider: AugmentedSignatureHelpProvider) => import("atom").Disposable;
export declare function consumeHover(provider: HoverProvider): void;
