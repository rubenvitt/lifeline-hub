import { pausiereLiveStroeme } from '../../live/liveVerbindung';

/**
 * Höchstwartezeit auf einen weiter zurückgestellten Druck, bevor der Live-Strom wieder öffnet.
 * Ohne sie bliebe der Strom zu, wenn Safari den Druck sperrt oder nie nachholt.
 */
export const DRUCK_LIVE_FRIST_MS = 10_000;

/**
 * Öffnet den Druckdialog, auch in Safari bei offenem Live-Strom (LFH-1105).
 *
 * WebKit stellt `window.print()` zurück, solange das Dokument als „lädt noch“ gilt, und eine
 * offene `EventSource` endet nie: der Aufruf kehrt ohne Dialog und ohne `beforeprint` zurück.
 * Schließt der Strom, kommt der zurückgestellte Druck sofort (gemessen in Safari 27, Ticket).
 *
 * Chromium und Firefox feuern `beforeprint` synchron in `window.print()` (darauf baut auch
 * `useDruckModus`); dort bleibt alles wie bisher, der Strom bleibt offen. Fehlt `beforeprint`,
 * schließt der Strom noch in derselben Aufgabe wie der Druckaufruf, also mit derselben
 * Nutzergeste, und öffnet nach dem Druck neu (Vollabgleich über `beiWiederaufbau`).
 */
export function oeffneDruckdialog(): void {
  let begonnen = false;
  const merke = () => {
    begonnen = true;
  };
  window.addEventListener('beforeprint', merke);
  try {
    window.print();
    if (begonnen) return;
    const fortsetzen = pausiereLiveStroeme();
    if (!fortsetzen) return;
    if (begonnen) {
      fortsetzen();
      return;
    }
    // Hält noch eine andere Ladung den Druck zurück, kommt er später: dann nach `afterprint`
    // weiter, spätestens nach der Frist.
    const weiter = () => {
      clearTimeout(frist);
      window.removeEventListener('afterprint', weiter);
      fortsetzen();
    };
    const frist = setTimeout(weiter, DRUCK_LIVE_FRIST_MS);
    window.addEventListener('afterprint', weiter);
  } finally {
    window.removeEventListener('beforeprint', merke);
  }
}
