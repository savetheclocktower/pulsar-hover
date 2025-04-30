import type { DatatipService, SignatureHelpProvider } from "atom-ide-base";
import { HoverProvider } from "./hover";
import { SignatureProvider } from "./signature";
export declare function activate(): void;
export declare function deactivate(): void;
export declare function provideDatatipService(): DatatipService;
export declare function provideSignatureHelpService(): (provider: SignatureHelpProvider) => import("atom").Disposable;
export declare function consumeHover(provider: HoverProvider): void;
export declare function consumeSignature(promise: Promise<SignatureProvider | null>): void;
