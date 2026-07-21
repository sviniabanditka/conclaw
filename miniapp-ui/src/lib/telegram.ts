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

interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  HapticFeedback?: HapticFeedback;
}

const tg: TelegramWebApp | undefined = (
  window as unknown as { Telegram?: { WebApp: TelegramWebApp } }
).Telegram?.WebApp;

export function initTelegram(): void {
  if (!tg) return;
  tg.ready();
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
