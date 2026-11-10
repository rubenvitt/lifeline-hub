import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vitest';

/**
 * Öffnet das Menü eines `MenueAusloeser` (oder eines anderen Dropdowns mit `autoFocus`) und wählt
 * einen Eintrag, ERST nachdem der `autoFocus`-Aufruf den Fokus in ein Menü gesetzt hat.
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
 * er danach nur durch den `autoFocus`-Aufruf. Bleibt er aus, scheitert das Warten laut. Das ist in
 * jsdom auch der Fall, wenn das Menü kein Fokusziel hat (alle Einträge gesperrt, oder der erste
 * freie Knoten ist der Trenner vor der Gefahr): Dort gibt es nichts zu stehlen, also ohne Warten
 * wählen (LLH-1391).
 */
export async function waehleMenueEintrag(
  ausloeser: HTMLElement,
  eintrag: string | RegExp,
): Promise<void> {
  await userEvent.click(ausloeser);
  // Nur im offenen Menü suchen: Ein früher geöffnetes bleibt in jsdom im Dokument, und ein
  // gleichnamiger Eintrag dort darf einen fehlenden im neuen Menü nicht verdecken (LLH-1537).
  const ziel = await waitFor(() => within(offenesMenue()).getByRole('menuitem', { name: eintrag }));
  await warteAufMenueFokus();
  await userEvent.click(ziel);
}

/**
 * Das eine offene Dropdown. antd lässt die Portale geschlossener Dropdowns im Baum stehen. In jsdom
 * läuft keine Bewegung zu Ende: Ein verlassendes Portal bleibt ohne `ant-dropdown-hidden` in
 * `ant-slide-up-leave-active` stehen, verlässlich erkennbar an seinem `pointer-events: none`. Die
 * Zählung ist streng, damit eine falsche Annahme laut wird.
 */
export function offenesMenue(): HTMLElement {
  const offen = Array.from(
    document.querySelectorAll<HTMLElement>('.ant-dropdown:not(.ant-dropdown-hidden)'),
  ).filter((d) => d.style.pointerEvents !== 'none');
  if (offen.length !== 1)
    throw new Error(`genau ein offenes Menü erwartet, ${offen.length} gefunden`);
  return offen[0];
}

/**
 * Wartet, bis der `autoFocus`-Aufruf eines eben geöffneten Menüs verbraucht ist (siehe
 * `waehleMenueEintrag`). Direkt nach dem Klick auf den Auslöser aufrufen, für Tests, die das Menü
 * selbst öffnen, weil sie vor der Wahl seine Einträge prüfen.
 *
 * Gewartet wird auf den Fokus in irgendeinem Menü: Verbraucht ist der Aufruf so oder so, der Klick
 * auf den Auslöser hat den Fokus vorher aus jedem Menü genommen.
 */
export async function warteAufMenueFokus(): Promise<void> {
  await waitFor(() => expect(document.activeElement?.closest('[role="menu"]')).not.toBeNull());
}
