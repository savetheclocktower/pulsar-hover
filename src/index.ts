import { CompositeDisposable } from "atom";
import OverlayManager from "./overlay-manager";
import type { DatatipService, SignatureHelpProvider } from "atom-ide-base";
import { HoverProvider } from "./hover";
import { SignatureProvider } from "./signature";

const subscriptions = new CompositeDisposable();
let overlayManager: OverlayManager | undefined;

export function activate() {
  overlayManager ??= new OverlayManager();
  subscriptions.add(overlayManager);
}

export function deactivate() {
  subscriptions.dispose();
}

// Legacy `datatip` and `signature-help` services.

export function provideDatatipService(): DatatipService {
  return overlayManager!.datatipService;
}

export function provideSignatureHelpService() {
  return (provider: SignatureHelpProvider) => {
    return overlayManager!.signatureHelpService.addProvider(provider);
  };
}

// Replacement `hover` and `signature` services.

export function consumeHover(provider: HoverProvider) {
  subscriptions.add(
    overlayManager!.hoverRegistry.addProvider(provider)
  );
}

export function consumeSignature(promise: Promise<SignatureProvider | null>) {
  promise.then((provider) => {
    if (provider == null) return;
    subscriptions.add(
      overlayManager!.signatureRegistry.addProvider(provider)
    );
  });
}
