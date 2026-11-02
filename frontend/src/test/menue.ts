import { screen, waitFor } from '@testing-library/react';
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
  const eintraege = await screen.findAllByRole('menuitem', { name: eintrag });
  // Ein früher geöffnetes Menü bleibt in jsdom im Dokument; das zuletzt geöffnete gilt.
  const ziel = eintraege[eintraege.length - 1];
  await warteAufMenueFokus();
  await userEvent.click(ziel);
}

/**
 * Wartet, bis der `autoFocus`-Aufruf eines eben geöffneten Menüs verbraucht ist (siehe
 * `waehleMenueEintrag`). Direkt nach dem Klick auf den Auslöser aufrufen, für Tests, die das Menü
 * selbst öffnen, weil sie vor der Wahl seine Einträge prüfen.
 *
 * Gewartet wird auf den Fokus in IRGENDEINEM Menü, nicht im neuen: In Tests vergibt
 * `@rc-component/util` jedem Menü dieselbe Kennung (`useId` → `test-id`), und rc-menu sucht das
 * Fokusziel per `data-menu-id` im ganzen Dokument. Steht ein früheres Menü mit gleichen Schlüsseln
 * noch im DOM, landet der Fokus dort, und das neue Menü bekommt ihn nie. Verbraucht ist der Aufruf
 * so oder so; der Klick auf den Auslöser hat den Fokus vorher aus jedem Menü genommen.
 */
export async function warteAufMenueFokus(): Promise<void> {
  await waitFor(() => expect(document.activeElement?.closest('[role="menu"]')).not.toBeNull());
}
