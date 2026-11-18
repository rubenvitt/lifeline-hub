import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { IconChevronRechts, IconChevronRunter } from '../../icons';
import { sicherLesen, sicherSchreiben } from '../../lib/sichererSpeicher';
import { augenbraueStil } from './Augenbraue';
import { useRollen } from './rollenwerte';
import './klappBand.css';

/**
 * Ein Kennzahlenband über einer Liste, das sich einklappen lässt (LLH-1786, Change
 * `z137bgm5-seitenkopf-einzeilig` D3, Spec `einsatztauglichkeit-layout`, „Kennzahlenbänder über
 * Listen lassen sich einklappen“): das Statusband des Meldebilds und die Unterbringung der
 * Betreuung. In den Stufen 48 und 72 nahm das Band die halbe Höhe vor der ersten Zeile.
 *
 * - Ohne gemerkte Wahl steht es offen. Eingeklappt bleibt EINE Zeile: der Kopf mit der Kurzform
 *   der Zahlen, die die Seite hereinreicht. Der Baustein kennt die Zahlen nicht.
 * - Die Wahl gilt je Seite auf dem Gerät (`lfh:klappband:<seite>`, `GERAETESPEICHER`, „bleibt“),
 *   erst State, dann Speicher: ohne Browserspeicher wirkt sie für die Sitzung.
 * - Der Kopf ist ein `<button>` mit `aria-expanded` (APG-Disclosure) und hält die Steuerhöhe der
 *   Stufe (Spec `einsatztauglichkeit-layout`, „Klappkopf folgt der Dichtestufe“), Muster
 *   `KlappPaneel` der Lagekarte.
 *
 * - Im Druck steht das Band immer offen und der Kopf fehlt (`klappBand.css`).
 *
 * Nicht für die Sichtungszeile der Betroffenen: sie muss am Handschirm im ersten Bild stehen.
 */

/** Speicherschlüssel der Wahl je Seite. */
export function klappBandSchluessel(seite: string): string {
  return `lfh:klappband:${seite}`;
}

/** Stil des Klappkopfs — rein und exportiert (Muster `klappKopfStil` der Lagekarte). */
export function klappBandKopfStil(token: {
  controlHeight: number;
  paddingXS: number;
  paddingSM: number;
}): CSSProperties {
  return {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: token.paddingSM,
    rowGap: token.paddingXS,
    boxSizing: 'border-box',
    minHeight: token.controlHeight,
    paddingBlock: token.paddingXS,
    paddingInline: 0,
    margin: 0,
    border: 0,
    background: 'none',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
    textAlign: 'start',
  };
}

function gemerktOffen(seite: string): boolean {
  return sicherLesen(klappBandSchluessel(seite)) !== 'zu';
}

interface KlappBandProps {
  /** Schlüssel der Seite für die gemerkte Wahl, z. B. `meldebild`. */
  seite: string;
  /** Name des Bands, steht im Kopf („Unterbringung in Zahlen“). */
  titel: string;
  /** Die Zahlen in einer Zeile, nur eingeklappt sichtbar („12 in Betreuung · 18 frei“). */
  kurzform: ReactNode;
  children: ReactNode;
}

export default function KlappBand({ seite, titel, kurzform, children }: KlappBandProps) {
  const { token, rollen } = useRollen();
  const [offen, setOffen] = useState(() => gemerktOffen(seite));
  const inhaltId = useId();
  const umschalten = () => {
    const neu = !offen;
    setOffen(neu);
    sicherSchreiben(klappBandSchluessel(seite), neu ? 'offen' : 'zu');
  };
  const Chevron = offen ? IconChevronRunter : IconChevronRechts;
  return (
    <div data-lfh="klappband" style={offen ? undefined : { marginBottom: token.margin }}>
      <button
        className="lfh-klappband-kopf"
        type="button"
        aria-expanded={offen}
        aria-controls={inhaltId}
        onClick={umschalten}
        style={klappBandKopfStil(token)}
      >
        <span aria-hidden="true" style={{ display: 'inline-flex', color: rollen.schwach }}>
          <Chevron size={14} />
        </span>
        <span className="lfh-augenbraue" style={augenbraueStil(rollen)}>
          {titel}
        </span>
        {!offen && (
          <span data-lfh="klappband-kurzform" style={{ color: rollen.text2 }}>
            {kurzform}
          </span>
        )}
      </button>
      {/* Eingeklappt bleibt das Band im Baum, nur ausgeblendet: der Druck zeigt es trotzdem
          (`klappBand.css`), und beim Aufklappen steht es ohne neuen Ladezustand da. */}
      <div id={inhaltId} data-lfh="klappband-inhalt" hidden={!offen}>
        {children}
      </div>
    </div>
  );
}
