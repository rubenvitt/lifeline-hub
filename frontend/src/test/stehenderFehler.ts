import { screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * Der STEHENDE Fehlerhinweis einer Seite (LFH-473): ein Alert mit dem Text AUSSERHALB von
 * `.ant-message`. Ein Toast mit demselben Wortlaut zählt nicht, er ist nach drei Sekunden weg.
 */
function stehendeAlerts(text: string): HTMLElement[] {
  return screen
    .queryAllByRole('alert')
    .filter((a) => a.textContent?.includes(text) && a.closest('.ant-message') === null);
}

/** Wartet auf den stehenden Hinweis und prüft, dass KEIN Toast denselben Fehler doppelt meldet. */
export async function stehenderFehler(text: string): Promise<HTMLElement> {
  await waitFor(() => expect(stehendeAlerts(text)).toHaveLength(1));
  const toast = document.querySelector('.ant-message');
  expect(toast?.textContent ?? '').not.toContain(text);
  return stehendeAlerts(text)[0];
}

/** Der Hinweis ist weg — etwa, weil das nächste Absenden ihn geräumt hat. */
export async function keinStehenderFehler(text: string): Promise<void> {
  await waitFor(() => expect(stehendeAlerts(text)).toHaveLength(0));
}
