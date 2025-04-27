import { CompositeDisposable } from "atom";
import OverlayManager from "./overlay-manager";
import type { DatatipService } from "atom-ide-base";
import { HoverProvider } from "./hover";

const subscriptions: CompositeDisposable = new CompositeDisposable();
let datatipManager: OverlayManager | undefined;

export function activate () {
  datatipManager ??= new OverlayManager();
  subscriptions.add(datatipManager);
}

export function deactivate () {
  subscriptions.dispose();
}

export function provideDatatipService (): DatatipService {
  return datatipManager!.datatipService;
}

export function consumeHover (provider: HoverProvider) {
  console.log('consumeHover!', provider);
  datatipManager!.hoverRegistry.addProvider(provider);
}
