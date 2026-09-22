import { useCallback, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { TbChevronDown, TbChevronRight } from 'react-icons/tb';
import { augenbraueStil, monoStil, paneelKopfStil, useRollen } from '../../components/instrument';

/**
 * Abschnitt der rechten Kartenleiste (Neuentwurf S5). Zwei Formen desselben Kopfes:
 *
 * - **fest** (`LeistenAbschnitt`): Ebenen und Ausgewählt — die Leiste TRÄGT diese beiden,
 *   sie lassen sich nicht wegklappen.
 * - **einklappbar** (`KlappPaneel`): alles, was die alte Leiste als Karten stapelte (Nicht
 *   verortet, Einsatzort, Zeichnen, Ansichten, Fachebenen, Bilder, Kartengrundlage). Nichts
 *   davon ist entfallen, es steht nur nicht mehr dauerhaft offen.
 *
 * Kein `Paneel` aus `components/instrument`: dessen Rahmen umläuft alle vier Seiten, und
 * gestapelt in der Leiste stünden die Linien doppelt. Kopf und Augenbraue sind dieselben
 * (`paneelKopfStil`, `augenbraueStil`), getrennt wird über die Haarlinie unten.
 *
 * Der Klappkopf ist ein `<button>` IN der Überschrift (APG-Disclosure): der Name bleibt
 * Überschrift im Baum, `aria-expanded` trägt den Zustand als Wort, nicht nur als Pfeil. Als
 * handgebautes Bedienziel trägt er die zwei Angaben (`minHeight` aus `controlHeight` plus
 * Polsterung, {@link klappKopfStil}).
 */

/** Stil des Klappkopfs — rein und exportiert (Muster `bedienzielStil`). */
export function klappKopfStil(token: {
  controlHeight: number;
  padding: number;
  paddingXS: number;
}): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: token.padding,
    width: '100%',
    minHeight: token.controlHeight,
    paddingBlock: token.paddingXS,
    paddingInline: token.padding,
    margin: 0,
    border: 0,
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'start',
  };
}

interface AbschnittProps {
  titel: string;
  /** Mono-Meta rechts im Kopf (Zähler). */
  meta?: ReactNode;
  /** Zeichen rechts im Kopf (z. B. eine Ikone). */
  zeichen?: ReactNode;
  /** Kennung für Tests und Sprungziele (`data-paneel`). */
  kennung: string;
  children: ReactNode;
}

/** Fester Leistenabschnitt: Kopf mit Augenbraue, ohne Klappe. */
export function LeistenAbschnitt({ titel, meta, zeichen, kennung, children }: AbschnittProps) {
  const { token, rollen } = useRollen();
  const kopfId = useId();
  return (
    <section
      aria-labelledby={kopfId}
      data-paneel={kennung}
      style={{ borderBlockEnd: `1px solid ${rollen.linie}` }}
    >
      <div style={paneelKopfStil(rollen, token)}>
        <h2 id={kopfId} className="lfh-augenbraue" style={augenbraueStil(rollen)}>
          {titel}
        </h2>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.paddingSM }}>
          {meta != null && <span style={{ ...monoStil(11), color: rollen.schwach }}>{meta}</span>}
          {zeichen != null && (
            <span aria-hidden="true" style={{ display: 'inline-flex', color: rollen.schwach }}>
              {zeichen}
            </span>
          )}
        </span>
      </div>
      {children}
    </section>
  );
}

interface KlappPaneelProps extends AbschnittProps {
  offen: boolean;
  onUmschalten: () => void;
  /** Körper gepolstert (Fließinhalt); Vorgabe ja. Listen/Zeilen polstern selbst. */
  polster?: boolean;
}

export function KlappPaneel({
  titel,
  meta,
  kennung,
  offen,
  onUmschalten,
  polster = true,
  children,
}: KlappPaneelProps) {
  const { token, rollen } = useRollen();
  const koerperId = useId();
  return (
    <section data-paneel={kennung} style={{ borderBlockEnd: `1px solid ${rollen.linie}` }}>
      <h2 style={{ margin: 0 }}>
        <button
          type="button"
          aria-expanded={offen}
          aria-controls={koerperId}
          onClick={onUmschalten}
          className="lfh-klappkopf"
          style={klappKopfStil(token)}
        >
          <span className="lfh-augenbraue" style={augenbraueStil(rollen)}>
            {titel}
          </span>
          {/* Trenner für den zugänglichen Namen („Nicht verortet 45", nicht „…verortet45");
              als Flex-Kind ohne Breite unsichtbar. */}{' '}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.paddingSM }}>
            {meta != null && <span style={{ ...monoStil(11), color: rollen.schwach }}>{meta}</span>}
            <span aria-hidden="true" style={{ display: 'inline-flex', color: rollen.schwach }}>
              {offen ? <TbChevronDown size={14} /> : <TbChevronRight size={14} />}
            </span>
          </span>
        </button>
      </h2>
      {/* Zugeklappt wird NICHT gerendert: die Leiste trägt viel Bedienung, und versteckte
          Steuerelemente im Baum wären für Tastatur und Vorleser Ziele ohne Sicht. */}
      {offen && (
        <div
          id={koerperId}
          style={{
            borderBlockStart: `1px solid ${rollen.flaeche3}`,
            ...(polster ? { padding: token.padding } : {}),
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}

/** Kennungen der einklappbaren Paneele — die Vorgabe ihres Zustands steht daneben. */
export type PaneelKennung =
  | 'nichtVerortet'
  | 'einsatzort'
  | 'verortet'
  | 'zeichnen'
  | 'ansicht'
  | 'fachebenen'
  | 'bilder'
  | 'grundlage';

/**
 * Vorgabe: offen, was im Einsatz laufend gebraucht wird (Verorten, Zeichnen, Ansicht);
 * zu, was man einmal einstellt (Fachebenen, Bild-Hintergründe, Kartengrundlage).
 */
export const PANEEL_VORGABE: Record<PaneelKennung, boolean> = {
  nichtVerortet: true,
  einsatzort: true,
  verortet: true,
  zeichnen: true,
  ansicht: true,
  fachebenen: false,
  bilder: false,
  grundlage: false,
};

const SPEICHER_SCHLUESSEL = 'lfh:lagekarte:paneele';

/** Gespeicherte Wahl lesen — ungültige oder fehlende Einträge fallen auf die Vorgabe. */
export function paneeleLesen(roh: string | null): Record<PaneelKennung, boolean> {
  const zustand = { ...PANEEL_VORGABE };
  if (!roh) return zustand;
  try {
    const gelesen = JSON.parse(roh) as Record<string, unknown>;
    for (const k of Object.keys(PANEEL_VORGABE) as PaneelKennung[]) {
      if (typeof gelesen[k] === 'boolean') zustand[k] = gelesen[k];
    }
  } catch {
    // Kaputter Eintrag: Vorgabe. Die Leiste darf an einer Bequemlichkeit nicht scheitern.
  }
  return zustand;
}

/**
 * Offen/zu je Paneel, pro Gerät gemerkt (Bequemlichkeit, kein Einsatzzustand — deshalb
 * `localStorage`, jede Lese- und Schreibstelle abgesichert).
 */
export function usePaneelZustand() {
  const [zustand, setZustand] = useState<Record<PaneelKennung, boolean>>(() => {
    try {
      return paneeleLesen(localStorage.getItem(SPEICHER_SCHLUESSEL));
    } catch {
      return { ...PANEEL_VORGABE };
    }
  });
  const setze = useCallback((kennung: PaneelKennung, offen: boolean) => {
    setZustand((alt) => {
      if (alt[kennung] === offen) return alt;
      const neu = { ...alt, [kennung]: offen };
      try {
        localStorage.setItem(SPEICHER_SCHLUESSEL, JSON.stringify(neu));
      } catch {
        // Kein Speicher (privates Fenster): der Zustand gilt dann nur bis zum Neuladen.
      }
      return neu;
    });
  }, []);
  return { zustand, setze };
}
