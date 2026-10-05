import { Button } from 'antd';
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Sammelbanner, useRollen } from '../instrument';
import { useDruckModus } from '../druck/useDruckModus';
import { IconChevronRechts, IconChevronRunter } from '../../icons';
import type { BaumKnoten } from './baum';
import { schleuse, wartendText } from './baumSchleuse';
import './haengenderBaumPrint.css';

/**
 * Das hängende Organigramm-Gerüst (LFH-626 D3, als Bauteil geteilt seit LFH-625 D4): die erste
 * Ebene unter dem Kopf bricht in Spalten um (`auto-fill`), tiefere Ebenen hängen senkrecht. So
 * bleibt es in jeder Breite ohne waagerechtes Scrollen und ohne Graph-Bibliothek. Jede Spalte
 * trägt ihre eigene Oberkante; ein durchgehender Querbalken löge beim Umbruch in die zweite Zeile.
 *
 * Nutzer: das Organigramm der Führungsorganisation (`pages/einsatzabschnitte/Organigramm.tsx`);
 * die Fernmeldeskizze des S6 zeichnet seit LFH-893 ein eigenes SVG (`stab/FernmeldeskizzeBild.tsx`).
 * Das Gerüst kennt weder Knotenart noch Inhalt; Druckregeln in `haengenderBaumPrint.css`. Die
 * `data-lfh`-Namen (`org-…`) tragen Gates und e2e.
 *
 * ZUFLUSS-SCHLEUSE (LFH-867, Kriterium 12, WCAG 3.2.5): solange Maus oder Stift über dem Baum
 * liegen oder der Fokus darin steht, hält das Gerüst Menge, Ort und Folge der Knoten
 * (`baumSchleuse.ts`); der Inhalt fließt, außer bei einem umgehängten Knoten am alten Ort. Neu,
 * umgehängt, umsortiert und entfallen wartet im Sammelbanner der
 * Standzeile fester Höhe zwischen Kopf und erster Ebene. Entfallenes bleibt als Platzhalter ohne
 * Link stehen, der Kopf steht still (eine neue Stabszeile schöbe sonst den ganzen Baum). Der
 * Bereich ist die ganze `section` samt Standzeile: der Weg zum Banner taut nicht auf. Touch zählt
 * nur über den Fokus. Im Druck gilt die Schleuse nicht (`useDruckModus`).
 *
 * Herleitung: `openspec/changes/archive/2026-10-01-lfh-626-fuehrungsorganisation-skizze/design.md`
 * (D3, D6), `openspec/changes/archive/2026-10-01-lfh-625-fernmeldeskizze/design.md` (D4) und
 * `openspec/changes/archive/2026-10-04-lfh-867-organigramm-zufluss-schleuse/design.md`.
 */

/** Mindestbreite einer Spalte der ersten Ebene; gemessen vor dem Bau (LFH-626 D3, Nachtrag). */
export const SPALTE_MIN_PX = 300;
/** Ab dieser Tiefe rückt nichts mehr weiter ein, die Linie bleibt (LFH-626 D3). */
const EINRUECKEN_BIS_TIEFE = 4;

/**
 * Trefffläche handgebauter Namenslinks (LFH-365, Muster `bedienzielStil`): ein `<a>` erbt keine
 * Steuerhöhe, der Boden kommt aus `controlHeight` (30 / 48 / 72). Ohne waagerechte Polsterung:
 * der Name fluchtet mit dem Zeichen, und die Spalte ist schmal (LFH-626 D3, Nachtrag).
 */
export function baumZielStil(token: { controlHeight: number }): CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', minHeight: token.controlHeight };
}

export { klappbareSchluessel, type BaumKnoten } from './baum';

interface Props<K extends BaumKnoten<K>> {
  /** Zugänglicher Name der Region („Organigramm“, „Fernmeldeskizze“). */
  bezeichnung: string;
  /** `data-lfh` der Region, für Gates und e2e des Nutzers. */
  lfh?: string;
  /** Der Wurzelbereich über der ersten Ebene (Einsatzleitung, ggf. Stabsstelle). */
  kopf: ReactNode;
  wurzeln: readonly K[];
  /** Gemerkt werden die ZUGEklappten Schlüssel: alles startet offen, Neues steht offen da. */
  zugeklappt: ReadonlySet<string>;
  onUmschalten: (key: string) => void;
  /** Name des Knotens für das Klappziel („Unterstellte von <Name>“). */
  knotenName: (k: K) => string;
  /** Liefert einen Namen, wenn Knoten und Kinder als benannte Gruppe stehen (Sammelknoten). */
  gruppe?: (k: K) => string | null;
  /** Der Inhalt neben dem Klappziel. */
  inhalt: (k: K, tiefe: number) => ReactNode;
}

export default function HaengenderBaum<K extends BaumKnoten<K>>(props: Props<K>) {
  const { bezeichnung, lfh, kopf, wurzeln } = props;
  const { token, rollen } = useRollen();
  const druckt = useDruckModus();
  const bereichRef = useRef<HTMLElement>(null);
  const standRef = useRef<HTMLDivElement>(null);

  // ── Schleuse (LFH-867) ─────────────────────────────────────────────────────────────
  // `gehalten === null`: offen. Geschlossen wird mit dem gerade gezeigten Stand — bei offener
  // Schleuse ist das der frische.
  const [gehalten, setGehalten] = useState<{ wurzeln: readonly K[]; kopf: ReactNode } | null>(null);
  const frischRef = useRef({ wurzeln, kopf });
  // Erst nach dem Commit: ein verworfener Render darf „anzeigen“ keinen nie gezeigten Stand geben.
  useLayoutEffect(() => {
    frischRef.current = { wurzeln, kopf };
  });
  const bedingungRef = useRef({ zeiger: false, fokus: false });
  const setzeBedingung = (art: 'zeiger' | 'fokus', wert: boolean) => {
    const b = { ...bedingungRef.current, [art]: wert };
    bedingungRef.current = b;
    // Ein leerer Baum schließt nicht: ohne Knoten rückt nichts, und der erste Zugang soll nicht
    // hinter dem Banner landen (wie die `Datensicht`).
    setGehalten((vorher) =>
      b.zeiger || b.fokus
        ? (vorher ?? (frischRef.current.wurzeln.length > 0 ? frischRef.current : null))
        : null,
    );
  };
  // Touch zählt nicht: ein Tipp betritt und verlässt den Bereich; nach dem Tipp hält der Fokus.
  const zeigerRein = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') setzeBedingung('zeiger', true);
  };
  // Erscheint der Baum unter einem ruhenden Zeiger, meldet der Browser beim nächsten Bewegen kein
  // `pointerenter`. Die erste Bewegung holt es nach (LFH-668).
  const zeigerBewegt = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' && !bedingungRef.current.zeiger) setzeBedingung('zeiger', true);
  };
  const zeigerRaus = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') setzeBedingung('zeiger', false);
  };
  // Jeder Fokus hält, auch einer per Klick auf ein Klappziel: er sitzt auf einem echten Bedienziel
  // (Verhalten der `Datensicht`; design.md D2).
  const fokusRein = () => setzeBedingung('fokus', true);
  // `blur` feuert auch beim Wechsel zwischen zwei Zielen des Bereichs — nur ein Ziel außerhalb taut.
  const fokusRaus = (e: FocusEvent) => {
    const ziel = e.relatedTarget;
    if (ziel instanceof Node && bereichRef.current?.contains(ziel)) return;
    setzeBedingung('fokus', false);
  };
  /**
   * Sicherheitsnetz: entfernt ein Render den fokussierten Knoten (ein entfallener Abschnitt wird zum
   * Platzhalter ohne Link), fällt der Fokus auf `body`, und WebKit meldet kein `focusout`. Nach
   * jedem Render: fiel der Fokus auf `body`, fängt ihn die Standzeile (WCAG 2.4.3) — die Schleuse
   * hält weiter, sonst rückte gerade der Platzhalter weg. Liegt er sonst außerhalb (oder fängt die
   * Standzeile nicht, etwa im Druck), gilt er als gegangen.
   */
  useLayoutEffect(() => {
    if (!bedingungRef.current.fokus || bereichRef.current?.contains(document.activeElement)) return;
    if (document.activeElement === null || document.activeElement === document.body) {
      standRef.current?.focus({ preventScroll: true });
      if (bereichRef.current?.contains(document.activeElement)) return;
    }
    setzeBedingung('fokus', false);
  });

  const offen = druckt || gehalten === null;
  const stand = useMemo(
    () => schleuse(offen ? null : gehalten.wurzeln, wurzeln),
    [offen, gehalten, wurzeln],
  );
  const gezeigterKopf = offen ? kopf : gehalten.kopf;
  const wartet = wartendText(stand.wartend);

  /**
   * Feste Höhe = die des Sammelbanners (Knopf `controlHeight` + Innenabstand + Rand): der Wechsel
   * zwischen „Live", „Live pausiert" und dem Banner verschiebt den Baum nicht. Nur der Banner
   * trägt `role="status"` — die ruhigen Texte wechselten beim bloßen Überfahren.
   */
  const standzeile = (
    <div
      ref={standRef}
      tabIndex={-1}
      data-lfh="org-stand"
      style={{
        height: token.controlHeight + 2 * token.paddingXS + 2,
        marginBlockStart: token.marginSM,
        display: 'flex',
      }}
    >
      {wartet !== null ? (
        <Sammelbanner
          aktion={{
            label: 'anzeigen',
            // Der Knopf verschwindet gleich; der Fokus bleibt im Bereich (Standzeile), statt auf
            // `body` zu fallen (WCAG 2.4.3), und ein späteres Verlassen erzeugt ein `focusout`.
            onKlick: () => {
              standRef.current?.focus({ preventScroll: true });
              setGehalten(frischRef.current);
            },
          }}
          style={{ flex: '1 1 auto', minWidth: 0, flexWrap: 'nowrap', boxSizing: 'border-box' }}
        >
          <span
            title={wartet}
            style={{
              display: 'block',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {wartet}
          </span>
        </Sammelbanner>
      ) : (
        <span style={{ alignSelf: 'center', fontSize: token.fontSizeSM, color: rollen.gedaempft }}>
          {offen ? 'Live' : 'Live pausiert'}
        </span>
      )}
    </div>
  );

  const zweigProps = { ...props, entfallen: stand.entfallen };
  return (
    <section
      ref={bereichRef}
      aria-label={bezeichnung}
      data-lfh={lfh}
      className="haengender-baum"
      onPointerEnter={zeigerRein}
      onPointerMove={zeigerBewegt}
      onPointerLeave={zeigerRaus}
      onFocus={fokusRein}
      onBlur={fokusRaus}
    >
      {gezeigterKopf}
      {standzeile}
      {stand.gezeigt.length > 0 && (
        <ul
          data-lfh="org-ebene1"
          style={{
            listStyle: 'none',
            // Im Druck fehlt die Standzeile: der Abstand zum Kopf ist dann wieder der alte.
            margin: `${druckt ? token.marginLG : token.marginSM}px 0 0`,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${SPALTE_MIN_PX}px), 1fr))`,
            gap: token.margin,
          }}
        >
          {stand.gezeigt.map((k) => (
            <li
              key={k.key}
              data-lfh="org-spalte"
              style={{
                borderBlockStart: `2px solid ${rollen.linieStark}`,
                paddingTop: token.paddingXS,
                minWidth: 0,
              }}
            >
              <Zweig {...zweigProps} knoten={k} tiefe={0} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Ein Knoten mit seinen Kindern, senkrecht darunter. */
type ZweigProps<K extends BaumKnoten<K>> = Props<K> & {
  entfallen: ReadonlySet<string>;
  knoten: K;
  tiefe: number;
};

function Zweig<K extends BaumKnoten<K>>(props: ZweigProps<K>) {
  const { knoten, tiefe, zugeklappt, onUmschalten, knotenName, gruppe, inhalt, entfallen } = props;
  const { token, rollen } = useRollen();
  const offen = !zugeklappt.has(knoten.key);
  const kinderId = `org-kinder-${knoten.key}`;
  const hatKinder = knoten.kinder.length > 0;

  const kopf = (
    <div
      data-lfh="org-knoten"
      style={{ display: 'flex', alignItems: 'flex-start', gap: token.marginXS, minWidth: 0 }}
    >
      {hatKinder ? (
        <Button
          type="text"
          data-lfh="org-klappen"
          aria-label={`Unterstellte von ${knotenName(knoten)}`}
          aria-expanded={offen}
          // Zugeklappt ist die Liste nicht im DOM; ein Verweis zeigte ins Leere.
          aria-controls={offen ? kinderId : undefined}
          icon={offen ? <IconChevronRunter /> : <IconChevronRechts />}
          onClick={() => onUmschalten(knoten.key)}
        />
      ) : (
        // Platzhalter in Knopfbreite, damit Zeichen und Namen einer Ebene fluchten.
        <span
          aria-hidden
          data-lfh="org-klappen-platz"
          // Breite des Klappknopfs: ein Icon-Knopf ist so breit wie hoch (`controlHeight`).
          style={{ flex: `0 0 ${token.controlHeight}px` }}
        />
      )}
      {entfallen.has(knoten.key) ? (
        // Platzhalter des Gerüsts, nicht des Aufrufers: kein Link auf einen gelöschten Datensatz.
        // Als Wort, nicht nur als Farbe (WCAG 1.4.1).
        <div
          data-lfh="org-entfallen"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: token.marginXS,
            minHeight: token.controlHeight,
            minWidth: 0,
            color: rollen.gedaempft,
          }}
        >
          <span style={{ overflowWrap: 'anywhere' }}>{knotenName(knoten)}</span>
          <span>entfallen</span>
        </div>
      ) : (
        inhalt(knoten, tiefe)
      )}
    </div>
  );

  const kinder = hatKinder && offen && (
    <ul
      id={kinderId}
      style={{
        listStyle: 'none',
        margin: 0,
        // Einrückung gedeckelt: tiefe Gliederungen wachsen nach unten, nicht in die Breite.
        // Unabhängig von der Knopfhöhe: im Handschuh wüchse der Einzug sonst je Ebene um 36 px.
        marginInlineStart: tiefe < EINRUECKEN_BIS_TIEFE ? token.paddingXS : 0,
        paddingInlineStart: tiefe < EINRUECKEN_BIS_TIEFE ? token.paddingSM : token.paddingXXS,
        borderInlineStart: `1px solid ${rollen.linieStark}`,
      }}
    >
      {knoten.kinder.map((k) => (
        <li key={k.key} style={{ minWidth: 0 }}>
          <Zweig {...props} knoten={k} tiefe={tiefe + 1} />
        </li>
      ))}
    </ul>
  );

  const gruppenName = gruppe?.(knoten) ?? null;
  return gruppenName != null ? (
    <div role="group" aria-label={gruppenName}>
      {kopf}
      {kinder}
    </div>
  ) : (
    <>
      {kopf}
      {kinder}
    </>
  );
}
