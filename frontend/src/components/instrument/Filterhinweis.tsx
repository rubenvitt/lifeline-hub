import { Button } from 'antd';
import type { ReactNode } from 'react';
import { monoStil, useRollen } from './rollenwerte';

/**
 * Filterhinweis — das Band über einer gefilterten Liste (LLH-1071, Spec `etb-filterleiste`,
 * „Filterband über der Erfassung“): „Gefiltert · 7 von 134 Einträgen sichtbar · Meldung · seit
 * 1345“ mit „Filter zurücksetzen“. Für das ETB gebaut, für jede gefilterte Liste gedacht.
 *
 * FARBE aus der Statusrolle Achtung (Spec `farbrollen-kontrast`, „Hinweisflächen kommen aus den
 * Statusflächen“): Fläche `achtungFlaeche`, 2-px-Kante `achtung`, Text `achtungText` — keine
 * eigene Farbe. Bernstein, nicht Blau: das blaue {@link Sammelbanner} meldet Neues und kann
 * zugleich darunter stehen; eine Verwechslung hieße, ein unvollständiges Tagebuch für
 * vollständig zu halten. Das Wort „Gefiltert“ ist der zweite Kanal (WCAG 1.4.1). Kein Blinken.
 *
 * ZAHLEN nur von außen, und nur aus einer Serverzählung (`frontend/src/etb/AGENTS.md`, „Kopfzahl
 * und Bilanz“): fehlt eine, steht keine. Merkmale in Mono, wo es Werte sind (der Aufrufer
 * formuliert sie); zu lang endet die Zeile mit „…“, den vollen Text trägt der Titel.
 *
 * `role="status"`: höflich angesagt, wenn ein Filter greift. Ohne Merkmal steht nichts da und
 * belegt keinen Platz.
 */
export interface FilterhinweisProps {
  /** Treffer unter dem Filter (Serverzählung). */
  treffer?: number;
  /** Gesamtzahl ohne Filter (Serverzählung). */
  gesamt?: number;
  /** Die gesetzten Merkmale, kurz („Meldung“, „seit 1345“, „Einheit ELW 1“, „„Deich““). */
  merkmale: readonly string[];
  onZuruecksetzen: () => void;
  /** Zusatzzeilen (eigener Eintrag außerhalb des Filters, Nachträge), je ein Knoten. */
  zusaetze?: readonly ReactNode[];
  /** Mehrzahl der Liste für den Satz; Vorgabe „Einträgen“. */
  dinge?: string;
}

export default function Filterhinweis({
  treffer,
  gesamt,
  merkmale,
  onZuruecksetzen,
  zusaetze = [],
  dinge = 'Einträgen',
}: FilterhinweisProps) {
  const { token, rollen } = useRollen();
  if (merkmale.length === 0) return null;
  const merkmalText = merkmale.join(' · ');
  const mitZahl = treffer != null && gesamt != null;
  return (
    <div
      role="status"
      data-lfh="filterhinweis"
      style={{
        background: rollen.achtungFlaeche,
        color: rollen.achtungText,
        borderInlineStart: `2px solid ${rollen.achtung}`,
        paddingBlock: token.paddingXXS,
        paddingInline: token.paddingSM,
        display: 'flex',
        flexDirection: 'column',
        gap: token.paddingXXS,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS, minWidth: 0 }}>
        <strong style={{ flex: '0 0 auto' }}>Gefiltert</strong>
        {mitZahl && (
          <span style={{ flex: '0 0 auto' }}>
            <span aria-hidden="true">· </span>
            <span style={monoStil(12)}>{treffer}</span> von{' '}
            <span style={monoStil(12)}>{gesamt}</span> {dinge} sichtbar
          </span>
        )}
        <span
          title={merkmalText}
          style={{
            ...monoStil(12),
            flex: '1 1 auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <span aria-hidden="true">· </span>
          {merkmalText}
        </span>
        <Button onClick={onZuruecksetzen} style={{ flex: '0 0 auto' }}>
          Filter zurücksetzen
        </Button>
      </div>
      {zusaetze.map((z, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
          {z}
        </div>
      ))}
    </div>
  );
}
