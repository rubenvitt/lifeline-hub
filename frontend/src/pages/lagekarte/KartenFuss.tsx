import type { CSSProperties, ReactNode } from 'react';

/**
 * Abstand der Fußleiste zum Kartenrand und zwischen ihren Bändern (px). Er ist die
 * Fortschreibung der beiden Einzelwerte, die vorher nebeneinander standen
 * (`SnapshotLeiste` 12, `ZeichnenSteuerung` 16) — zwei Zahlen für denselben Rand waren
 * schon vor der Überdeckung ein Widerspruch.
 */
export const FUSS_ABSTAND = 12;

export type BandAusrichtung = 'voll' | 'mitte' | 'links';

/**
 * Stil eines Bandes IM Fuß-Rahmen (LFH-355). Rein und exportiert nach dem Muster von
 * `bedienzielStil`/`aktionsabstand`: nur so ist die Zusicherung ohne Render prüfbar.
 *
 * `pointerEvents: 'auto'` ist die Gegenzeile zu `pointerEvents: 'none'` am Rahmen und
 * gehört zwingend an JEDES Band — ein Band ohne sie wäre sichtbar und tot.
 */
export function bandStil(ausrichtung: BandAusrichtung = 'voll'): CSSProperties {
  return {
    pointerEvents: 'auto',
    alignSelf:
      ausrichtung === 'mitte' ? 'center' : ausrichtung === 'links' ? 'flex-start' : 'stretch',
    // Ein Band darf den Rahmen nie überlaufen, sonst käme die Überdeckung über die
    // Breitenachse zurück, die der Rahmen über die Höhenachse gerade ausgeräumt hat.
    maxWidth: '100%',
  };
}

/** Stil des Fuß-Rahmens selbst. Exportiert, damit die Zusicherungen prüfbar sind. */
export const fussStil: CSSProperties = {
  position: 'absolute',
  left: FUSS_ABSTAND,
  right: FUSS_ABSTAND,
  bottom: FUSS_ABSTAND,
  zIndex: 5,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: FUSS_ABSTAND,
  // Der Rahmen spannt über die volle Kartenbreite, trägt aber selbst nichts. Ohne diese
  // Zeile schluckte der Leerraum zwischen (und neben) den Bändern jedes Ziehen und Klicken
  // auf der Karte darunter — die Bänder holen sich die Ereignisse über `bandStil` zurück.
  pointerEvents: 'none',
};

/**
 * Gemeinsamer unterer Rand der Lagekarte (LFH-355).
 *
 * ── WARUM EIN RAHMEN UND NICHT EIN HÖHERER `zIndex` ─────────────────────────────
 *
 * `ZeichnenSteuerung` (`bottom: 16`, mittig) und `SnapshotLeiste` (`bottom: 12`, volle
 * Breite) lagen beide absolut auf `zIndex: 5` und kämpften um denselben unteren Rand. Bei
 * Gleichstand gewinnt die spätere DOM-Position, und das war die Leiste: die Knöpfe
 * „Abschließen"/„Abbrechen" waren im Default-Zustand (Zeitachse ausgeklappt) vollständig
 * verdeckt und damit **nicht bedienbar** — gemessen als Playwright-Timeout mit
 * „`<div>` intercepts pointer events", während `toBeVisible()` grün blieb. CSS-Sichtbarkeit
 * ist keine Klickbarkeit; diese Falle ist generisch für die e2e-Suite.
 *
 * Ein höherer `zIndex` an der Steuerung hätte den Klick zurückgeholt und die Überdeckung
 * gelassen — die Leiste läge weiter darunter, nur andersherum, und das Ticket verlangt
 * ausdrücklich das Gegenteil („kein neues Überdeckungspaar, auch bei schmalem Viewport").
 * Der Rahmen stapelt beide stattdessen als **Flow-Geschwister in einer Spalte**: zwei
 * Elemente im normalen Fluss können sich nicht überlagern, das folgt aus dem Layout und
 * nicht aus einer Zahl. Deshalb geben die Bänder ihre eigene absolute Positionierung ab —
 * wer sie einem von ihnen zurückgibt, nimmt es aus dem Fluss und holt genau den Bug wieder.
 *
 * Die Reihenfolge ist Teil der Aussage: die Zeichnen-Steuerung steht OBEN und schwenkt
 * damit über der Leiste ein, statt sich davorzulegen. Sie erscheint nur im Zeichenmodus;
 * die Leiste bleibt an ihrem gewohnten Platz am unteren Rand.
 */
export function KartenFuss({ children }: { children?: ReactNode }) {
  return (
    <div data-lfh="karten-fuss" style={fussStil}>
      {children}
    </div>
  );
}
