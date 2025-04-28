import { CompositeDisposable } from "atom";
import OverlayManager from "./overlay-manager";
import type { DatatipService } from "atom-ide-base";
import { HoverProvider } from "./hover";
import { AugmentedSignatureHelpProvider } from "./provider-registry";

const subscriptions: CompositeDisposable = new CompositeDisposable();
let overlayManager: OverlayManager | undefined;

export function activate() {
  overlayManager ??= new OverlayManager();
  subscriptions.add(overlayManager);
}

export function deactivate() {
  subscriptions.dispose();
}

export function provideDatatipService(): DatatipService {
  return overlayManager!.datatipService;
}

export function provideSignatureHelpService() {
  return (provider: AugmentedSignatureHelpProvider) => {
    return overlayManager!.signatureHelpService.addProvider(provider);
  };
}

export function consumeHover(provider: HoverProvider) {
  overlayManager!.hoverRegistry.addProvider(provider);
}
