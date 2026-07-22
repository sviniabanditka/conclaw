import { useEffect } from 'react';

import { backButton, mainButton } from './telegram';

/**
 * Hand a sheet's chrome to Telegram while it is open.
 *
 * Two things a web page cannot do for itself. The system back gesture closes
 * the whole app unless something claims it — so an open sheet claims it, and
 * back means back rather than exit. And the primary action moves to Telegram's
 * own button at the bottom of the screen, which is where a phone user's thumb
 * already is and where every other Mini App puts it.
 *
 * Every handler is removed on cleanup: `onClick` appends, so a sheet opened
 * three times without this fires its action three times.
 */
export function useSheetChrome({
  open,
  onClose,
  action,
}: {
  open: boolean;
  onClose: () => void;
  action?: { text: string; disabled?: boolean; busy?: boolean; onClick: () => void };
}): void {
  // The back button only needs re-binding when the sheet opens or the handler
  // changes — not when the action's label or busy state does.
  useEffect(() => {
    const back = backButton();
    if (!back || !open) return;
    back.onClick(onClose);
    back.show();
    return () => {
      back.offClick(onClose);
      back.hide();
    };
  }, [open, onClose]);

  useEffect(() => {
    const main = mainButton();
    if (!main || !open || !action) return;
    const handler = () => action.onClick();
    main.setText(action.text);
    main.onClick(handler);
    main.show();
    return () => {
      main.offClick(handler);
      main.hide();
      main.hideProgress();
    };
    // The handler is rebound when the action changes, which is what keeps it
    // closing over current state rather than the state it was opened with.
  }, [open, action?.text, action?.onClick]);

  useEffect(() => {
    const main = mainButton();
    if (!main || !open || !action) return;
    if (action.disabled) main.disable();
    else main.enable();
    if (action.busy) main.showProgress(true);
    else main.hideProgress();
  }, [open, action?.disabled, action?.busy]);
}
