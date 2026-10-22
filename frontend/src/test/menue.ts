import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vitest';

/**
 * Öffnet das Menü eines `MenueAusloeser` und wählt einen Eintrag, ERST nachdem das Menü seinen
 * Fokus hat.
 *
 * Warum gewartet wird: `autoFocus` am Dropdown (`components/MenueAusloeser.tsx`) setzt den Fokus
 * drei Animationsbilder nach dem Öffnen ins Menü (`@rc-component/dropdown`, `useAccessibility`:
 * `raf(focusMenu, 3)`), und das Schließen bricht diesen Aufruf nicht ab. Klickt ein Test schneller,
 * als die drei Bilder dauern (unter CI-Last dauern sie länger), feuert der Aufruf erst im danach
 * geöffneten Dialog und zieht den Fokus ins geschlossene, noch eingehängte Menü zurück: Getipptes
 * geht dort verloren (LLH-1390). Hängt der Auslöser mit der Wahl aus (Formular an der Karte), läuft
 * der Aufruf ins Leere. Im Browser wählt niemand binnen drei Bildern, ein ausgeblendetes Menü nimmt
 * keinen Fokus, und die Fokusfalle des Dialogs holt ihn zurück; in jsdom greift beides nicht (kein
 * Layout: die Falle findet keine sichtbaren Ziele).
 *
 * Der Klick auf den Auslöser legt den Fokus auf den Knopf, also außerhalb des Menüs; im Menü steht
 * er danach nur durch den `autoFocus`-Aufruf. Bleibt er aus, scheitert das Warten laut.
 */
export async function waehleMenueEintrag(ausloeser: HTMLElement, eintrag: string): Promise<void> {
  await userEvent.click(ausloeser);
  const eintraege = await screen.findAllByRole('menuitem', { name: eintrag });
  // Ein früher geöffnetes Menü bleibt in jsdom im Dokument; das zuletzt geöffnete gilt.
  const ziel = eintraege[eintraege.length - 1];
  const menue = ziel.closest<HTMLElement>('[role="menu"]');
  expect(menue).not.toBeNull();
  await waitFor(() => expect(menue?.contains(document.activeElement)).toBe(true));
  await userEvent.click(ziel);
}
