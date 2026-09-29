/**
 * Zweistufiges Esc beim Zeichnen (LFH-712): je öfter Esc, desto mehr Richtung view-only. Rein und
 * exportiert, damit jede Zeile der Stufentafel ohne Karte prüfbar ist; die Seite führt nur aus.
 *
 * Esc gehört der Seite, nicht terra-draw — Begründung in `zeichnen.ts` (`keyEvents`) und
 * `openspec/changes/archive/2026-09-29-lfh-712-lagekarte-zeichnen-korrigierbar/design.md` D2. Das Messen endet mit
 * einem Esc über einen eigenen Zuhörer der Seite.
 */

export interface EscLage {
  phase: 'zeichnen' | 'bestaetigen';
  speichernLaeuft: boolean;
  /** Punkte der laufenden Figur (Zeichenphase). */
  punkte: number;
  /** In der laufenden Zonen-Serie schon gespeicherte Objekte; 0 ohne Serie. */
  serieGespeichert: number;
}

export type EscStufe =
  /** Nichts tun (Speichern läuft). */
  | 'nichts'
  /** Fertige, ungespeicherte Figur verwerfen, zurück in die Zeichenphase. */
  | 'zurueckZumZeichnen'
  /** Angefangene Figur verwerfen, im Zeichenmodus bleiben. */
  | 'verwerfen'
  /** Zeichenmodus beenden; die schon gespeicherten Serienobjekte bleiben („Fertig"). */
  | 'fertig'
  /** Zeichenmodus beenden („Abbrechen"). */
  | 'abbrechen';

export function escStufe(lage: EscLage): EscStufe {
  if (lage.speichernLaeuft) return 'nichts';
  if (lage.phase === 'bestaetigen') return 'zurueckZumZeichnen';
  if (lage.punkte > 0) return 'verwerfen';
  return lage.serieGespeichert > 0 ? 'fertig' : 'abbrechen';
}

/** Die Quittung der beiden verwerfenden Stufen — ein Wortlaut, an einer Stelle. */
export const QUITTUNG_VERWORFEN = 'Zeichnung verworfen';

/**
 * Ein offenes antd-Overlay schließt selbst per Esc, über einen eigenen `window`-keydown, der weder
 * `preventDefault` ruft noch andere Zuhörer aufhält (`@rc-component/dropdown`, `portal`, `dialog`).
 * `defaultPrevented` allein fängt das nicht: ohne diesen Riegel schlösse Esc das Benutzermenü und
 * verwürfe die Zeichnung darunter.
 *
 * Gefragt wird nach dem sichtbaren Overlay, nicht nach dem Fokus: Esc soll sonst unabhängig vom
 * Fokus wirken. Ein Dialog-Rahmen, den antd nach dem Schließen stehen lässt, trägt `display: none`.
 */
const OFFENE_OVERLAYS = [
  '.ant-dropdown:not(.ant-dropdown-hidden)',
  '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
  '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
  '.ant-popover:not(.ant-popover-hidden)',
  '.ant-modal-wrap',
  '.ant-drawer-open',
].join(', ');

export function escGehoertOverlay(e: KeyboardEvent): boolean {
  const ziel = e.target instanceof Element ? e.target : null;
  if (ziel?.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return true;
  return Array.from(document.querySelectorAll<HTMLElement>(OFFENE_OVERLAYS)).some(
    (el) => getComputedStyle(el).display !== 'none',
  );
}
