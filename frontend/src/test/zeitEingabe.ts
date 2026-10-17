import { fireEvent, screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Testhelfer der Zeiteingabe (`anzeige/ZeitpunktEingabe.tsx`, Spec `zeiteingabe`, „Eingabe als
 * Text“): ein Zeitfeld wird getippt und mit Enter übernommen, nie über Kalenderzellen oder
 * Format-Strings. Die Eingabe ist taktisch („1430“, „101430okt26“) oder ISO.
 */
export async function tippeZeit(user: UserEvent, feld: HTMLElement, text: string): Promise<void> {
  await user.clear(feld);
  if (text) await user.type(feld, text);
  await user.keyboard('{Enter}');
}

/** Wie {@link tippeZeit}, ohne userEvent (für Tests mit Fake-Timern oder `fireEvent`). */
export function setzeZeit(feld: HTMLElement, text: string): void {
  fireEvent.focus(feld);
  fireEvent.change(feld, { target: { value: text } });
  fireEvent.keyDown(feld, { key: 'Enter' });
}

/** Das Zeitfeld mit diesem zugänglichen Namen. */
export function zeitFeld(name: string | RegExp): HTMLElement {
  return screen.getByRole('textbox', { name });
}
