import { IconChevronRechts, IconChevronRunter } from '../../icons';
import { useId, type CSSProperties, type ReactNode } from 'react';
import { augenbraueStil, monoStil, paneelKopfStil, useRollen } from '../../components/instrument';

/**
 * Abschnitt der rechten Kartenleiste, zwei Formen desselben Kopfes:
 * - fest (`LeistenAbschnitt`): der Kopf des Ebenenbaums (Kartenansicht), nicht wegklappbar.
 * - einklappbar (`KlappPaneel`): die Gruppen des Ebenenbaums (`Ebenenbaum.tsx`) und der
 *   Objektliste (`MarkerSuche.tsx`). Ihren Klappzustand merken sie selbst (`useBaumKlapp`,
 *   `useObjektKlapp`); das Paneel „Zeichnen“ und sein Schlüssel `lfh:lagekarte:paneele` sind mit
 *   dem Werkzeugmenü an der Karte entfallen (LLH-1038).
 *
 * Kein `Paneel` aus `components/instrument`: dessen Rahmen umläuft alle vier Seiten, gestapelt
 * stünden die Linien doppelt. Kopf und Augenbraue sind dieselben (`paneelKopfStil`,
 * `augenbraueStil`), getrennt wird über die Haarlinie unten.
 *
 * Der Klappkopf ist ein `<button>` in der Überschrift (APG-Disclosure): der Name bleibt
 * Überschrift, `aria-expanded` trägt den Zustand. Als handgebautes Bedienziel trägt er `minHeight`
 * plus Polsterung ({@link klappKopfStil}).
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
  /** Zeichen rechts im Kopf (z. B. ein Icon). */
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
  /** Überschriftsebene: 2 für Paneele und Gruppen, 3 für Untergruppen im Ebenenbaum. */
  ebene?: 2 | 3;
  /** Untergruppe: der Kopf rückt ein, damit die Gliederung ohne Linie lesbar bleibt. */
  einzug?: boolean;
  /**
   * Eigenes Bedienziel rechts neben dem Klappkopf (Gruppenschalter im Ebenenbaum) — nie IM Knopf:
   * ein Schalter in einem Schalter wäre für Tastatur und Vorleser kein Ziel.
   */
  zusatz?: ReactNode;
}

export function KlappPaneel({
  titel,
  meta,
  kennung,
  offen,
  onUmschalten,
  polster = true,
  ebene = 2,
  einzug = false,
  zusatz,
  children,
}: KlappPaneelProps) {
  const { token, rollen } = useRollen();
  const koerperId = useId();
  const Ueberschrift = ebene === 3 ? 'h3' : 'h2';
  const kopf = (
    <Ueberschrift style={{ margin: 0, flex: 1, minWidth: 0 }}>
      <button
        type="button"
        aria-expanded={offen}
        aria-controls={koerperId}
        onClick={onUmschalten}
        className="lfh-klappkopf"
        style={{
          ...klappKopfStil(token),
          ...(einzug ? { paddingInlineStart: token.padding + token.paddingSM } : {}),
        }}
      >
        <span className="lfh-augenbraue" style={augenbraueStil(rollen)}>
          {titel}
        </span>
        {/* Trenner für den zugänglichen Namen („Nicht verortet 45", nicht „…verortet45");
              als Flex-Kind ohne Breite unsichtbar. */}{' '}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.paddingSM }}>
          {meta != null && <span style={{ ...monoStil(11), color: rollen.schwach }}>{meta}</span>}
          <span aria-hidden="true" style={{ display: 'inline-flex', color: rollen.schwach }}>
            {offen ? <IconChevronRunter size={14} /> : <IconChevronRechts size={14} />}
          </span>
        </span>
      </button>
    </Ueberschrift>
  );
  return (
    <section data-paneel={kennung} style={{ borderBlockEnd: `1px solid ${rollen.linie}` }}>
      {zusatz == null ? (
        kopf
      ) : (
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          {kopf}
          {zusatz}
        </div>
      )}
      {/* Zugeklappt wird nicht gerendert: versteckte Steuerelemente im Baum wären für Tastatur
          und Vorleser Ziele ohne Sicht. */}
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
