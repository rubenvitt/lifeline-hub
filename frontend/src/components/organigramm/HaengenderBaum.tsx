import { Button } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { useRollen } from '../instrument';
import { IkoneChevronRechts, IkoneChevronRunter } from '../../ikonen';
import type { BaumKnoten } from './baum';
import './haengenderBaumPrint.css';

/**
 * Das hängende Organigramm-Gerüst (LFH-626 D3, als Bauteil geteilt seit LFH-625 D4): die erste
 * Ebene unter dem Kopf bricht in Spalten um (`auto-fill`), tiefere Ebenen hängen senkrecht. So
 * bleibt es in jeder Breite ohne waagerechtes Scrollen und ohne Graph-Bibliothek. Jede Spalte
 * trägt ihre eigene Oberkante; ein durchgehender Querbalken löge beim Umbruch in die zweite Zeile.
 *
 * Nutzer: das Organigramm der Führungsorganisation (`pages/einsatzabschnitte/Organigramm.tsx`)
 * und die Fernmeldeskizze des S6 (`stab/Fernmeldeskizze.tsx`). Das Gerüst kennt weder Knotenart
 * noch Inhalt; Druckregeln in `haengenderBaumPrint.css`. Die `data-lfh`-Namen (`org-…`) tragen
 * Gates und e2e beider Nutzer.
 *
 * Herleitung: `openspec/changes/archive/2026-10-01-lfh-626-fuehrungsorganisation-skizze/design.md`
 * (D3, D6) und `openspec/changes/lfh-625-fernmeldeskizze/design.md` (D4).
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
  return (
    <section aria-label={bezeichnung} data-lfh={lfh} className="haengender-baum">
      {kopf}
      {wurzeln.length > 0 && (
        <ul
          data-lfh="org-ebene1"
          style={{
            listStyle: 'none',
            margin: `${token.marginLG}px 0 0`,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${SPALTE_MIN_PX}px), 1fr))`,
            gap: token.margin,
          }}
        >
          {wurzeln.map((k) => (
            <li
              key={k.key}
              data-lfh="org-spalte"
              style={{
                borderBlockStart: `2px solid ${rollen.linieStark}`,
                paddingTop: token.paddingXS,
                minWidth: 0,
              }}
            >
              <Zweig {...props} knoten={k} tiefe={0} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Ein Knoten mit seinen Kindern, senkrecht darunter. */
function Zweig<K extends BaumKnoten<K>>(props: Props<K> & { knoten: K; tiefe: number }) {
  const { knoten, tiefe, zugeklappt, onUmschalten, knotenName, gruppe, inhalt } = props;
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
          icon={offen ? <IkoneChevronRunter /> : <IkoneChevronRechts />}
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
      {inhalt(knoten, tiefe)}
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
