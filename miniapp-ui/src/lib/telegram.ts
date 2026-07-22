/**
 * The bits of Telegram's Mini App SDK this app uses.
 *
 * Wrapped rather than called directly so the page still renders when opened in
 * an ordinary browser — during development, or when someone pastes the URL —
 * instead of dying on `window.Telegram` being undefined.
 */
interface HapticFeedback {
  notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
}

interface TelegramButton {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface MainButton extends TelegramButton {
  setText(text: string): void;
  enable(): void;
  disable(): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
}

interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  HapticFeedback?: HapticFeedback;
  BackButton?: TelegramButton;
  MainButton?: MainButton;
}

const tg: TelegramWebApp | undefined = (
  window as unknown as { Telegram?: { WebApp: TelegramWebApp } }
).Telegram?.WebApp;

export function initTelegram(): void {
  if (!tg) return;
  tg.ready();
  // expand(), not requestFullscreen(): fullscreen takes the app out from under
  // Telegram's own header, and on a phone with a notch that puts the top of
  // the content behind the status bar and the island.
  tg.expand();
  // Without this, dragging inside a scrollable list closes the app.
  tg.disableVerticalSwipes?.();
  tg.setHeaderColor?.('bg_color');
}

export function initData(): string {
  return tg?.initData ?? '';
}

export function haptic(kind: 'success' | 'error'): void {
  tg?.HapticFeedback?.notificationOccurred(kind);
}

export function tap(): void {
  tg?.HapticFeedback?.impactOccurred('light');
}

/**
 * Telegram's own back button and primary action.
 *
 * Null outside Telegram, which is the whole reason they are reached through
 * here: a sheet has to work in a plain browser too, so every caller has to
 * cope with their absence rather than assuming the chrome exists.
 */
export function backButton(): TelegramButton | null {
  return tg?.BackButton ?? null;
}

export function mainButton(): MainButton | null {
  return tg?.MainButton ?? null;
}

/** Whether the platform supplies chrome, so the page can stop drawing its own. */
export function hasNativeChrome(): boolean {
  return Boolean(tg?.MainButton && tg?.BackButton);
}
