import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import type { EtbTyp } from '../api/types';
import Fundstellen from '../components/Fundstellen';
import { useRollen } from '../components/instrument';
import { monoStil } from '../components/instrument/rollenwerte';
import { zeilenGrund } from '../components/instrument/Zeitachseneintrag';
import { etbTypFarbe } from '../theme/statusFarben';
import { EinklappHuelle, EinklappKnopf, useEinklappen } from './EtbInhalt';
import { EtbVermerkSpalte } from './EtbVermerke';
import {
  ETB_SPALTEN,
  ETB_SPALTEN_EINZUG,
  ETB_SPALTEN_KANTE,
  ETB_SPALTEN_RASTER,
  ETB_SPALTEN_RINNE,
  vonAnTitel,
  type VonAnAnzeige,
} from './etbSpalten';
import type { Vermerk } from './vermerke';
import './etbSpaltenzeile.css';

/**
 * Die Spaltenzeile des ETB (Change `kwc2yszv-etb-neuentwurf`, design.md D1, Spec
 * `etb-zeitachse-darstellung`, „Spaltenzeile in kompakter Dichte“): in kompakter Dichte ab `lg`
 * steht ein Eintrag in festen Spalten — Zeit · Nr. · Typ · Von → An · Inhalt · Vermerk · ⋮ —, die
 * über alle Zeilen und mit dem Spaltenkopf fluchten (eine Konstante, `ETB_SPALTEN_RASTER`).
 *
 * - Von → An in Textschrift 13 px, der Meldeweg gedämpft dahinter; zu lang endet es mit Auslassung,
 *   der volle Text steht im Titel. Gleiche Seiten stehen als „Vermerk <Stelle>“.
 * - Der Verfasser hat keine Spalte: er steht im Titel der Zeile und im Zeilenmenü (die Zeitachse
 *   gibt ihn mit in die Liste des ⋮, `zeilenAktionen.ts`). So bleibt die Zeile einzeilig, auch
 *   mit langem Verfasser.
 * - Verweise und Marken stehen in der Spalte Vermerk, nicht in einer Zeile darunter
 *   (`EtbVermerkSpalte`, „+n“ bei Überlauf).
 * - Ein langer Inhalt steht auf drei Zeilen, „mehr“ steht fest am Ende der Spalte Vermerk
 *   (`EtbInhalt`).
 * - Nichts unter 12 px; ein einzeiliger Eintrag ist 29 px hoch (Zeile 20 + 2 × 4 + Linie):
 *   Menü, Verweise und „mehr“ haben die Bedienhöhe, ragen aber in die Polsterung.
 *
 * Komfortabel und Handschuh behalten `Zeitachseneintrag` (elf andere Flächen nutzen ihn, D1);
 * unter `md` gilt die Handschirm-Zeile (`EtbHandschirmzeile`).
 */

/** Unsichtbar, aber vorgelesen („Nr. “ vor der Zahl — der Kopf ist nur ein Bild). */
export const NUR_VORLESER: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

/**
 * Der Spaltenkopf über der Zeitachse: dieselben Spuren wie die Zeile. Er klebt unter dem Kopf der
 * Seite (`--etb-kopf-unterkante`, gesetzt von der ETB-Seite als Unterkante von Seitenkopf und
 * Filterleiste), aber nur, solange diese Köpfe kleben (`klebt`, `etb/etbKopfKleben.ts`): sonst
 * rechnete der Fokusabstand oben ihn nicht ein, ein getabbtes Ziel läge unter ihm (Review L4).
 * Ein Bild der Spalten, kein Tabellenkopf: Vorleser lesen
 * die Zeilen, die ihre Bezeichnungen selbst tragen (`aria-hidden`).
 */
export function EtbSpaltenkopf({ klebt }: { klebt: boolean }) {
  const { rollen } = useRollen();
  return (
    <div
      aria-hidden="true"
      data-lfh="etb-spaltenkopf"
      className="etb-spaltenraster"
      style={{
        ...(klebt
          ? {
              position: 'sticky',
              top: 'var(--etb-kopf-unterkante, var(--lfh-rahmen-oben, 0px))',
              zIndex: 4,
            }
          : {}),
        display: 'grid',
        gridTemplateColumns: ETB_SPALTEN_RASTER,
        columnGap: ETB_SPALTEN_RINNE,
        alignItems: 'center',
        minHeight: 26,
        paddingInlineStart: ETB_SPALTEN_KANTE + ETB_SPALTEN_EINZUG,
        background: rollen.kopf,
        borderBlockEnd: `1px solid ${rollen.linie}`,
        fontSize: 12,
        lineHeight: '16px',
        color: rollen.gedaempft,
      }}
    >
      {ETB_SPALTEN.map((s) => (
        <span key={s.name || 'menue'} data-spalte={s.name || 'menue'}>
          {s.name}
        </span>
      ))}
    </div>
  );
}

/** Von → An als Zelle oder Kopfteil: Textschrift 13 px, Meldeweg 12 px gedämpft, Auslassung. */
export function VonAnText({
  anzeige,
  weg,
  begriff,
}: {
  anzeige: VonAnAnzeige;
  weg?: string;
  begriff?: string;
}) {
  const { rollen } = useRollen();
  const titel = vonAnTitel(anzeige, weg);
  return (
    <span
      data-lfh="etb-vonan"
      title={titel || undefined}
      style={{
        display: 'block',
        minWidth: 0,
        fontSize: 13,
        lineHeight: '20px',
        color: rollen.text2,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {anzeige?.art === 'vermerk' && (
        <>
          Vermerk <Fundstellen text={anzeige.stelle} begriff={begriff} />
        </>
      )}
      {anzeige?.art === 'weg' && (
        <>
          <Fundstellen text={anzeige.von || '—'} begriff={begriff} /> →{' '}
          <Fundstellen text={anzeige.an || '—'} begriff={begriff} />
        </>
      )}
      {weg && (
        <span style={{ fontSize: 12, color: rollen.gedaempft }}>
          {anzeige ? ' · ' : ''}
          {weg}
        </span>
      )}
    </span>
  );
}

type Hueller = Omit<HTMLAttributes<HTMLLIElement>, 'children' | 'style' | 'title'>;

export interface EtbSpaltenzeileProps extends Hueller {
  zeit: ReactNode;
  /** Laufende Nummer; gepufferte Zeilen haben noch keine. */
  nr?: number;
  typ: EtbTyp;
  typwort: string;
  vonAn: VonAnAnzeige;
  weg?: string;
  /** Begriff der Volltextsuche für Von → An. */
  fundstellen?: string;
  /** Der Inhalt (Markdown) — oder, bei einer Bündelzeile, ihr Knopf. */
  inhalt: ReactNode;
  /** Sprung oder Suchtreffer: der Inhalt steht ganz, ohne „weniger“. */
  offenErzwungen?: boolean;
  /** Berichtigt: Inhalt durchgestrichen (Spec, Szenario „Berichtigt“). */
  berichtigt?: boolean;
  /** Systemeintrag: Text 12 px gedämpft (LLH-1106). */
  leise?: boolean;
  toenung?: 'berichtigung' | 'problem';
  vermerke?: readonly Vermerk[];
  /** Vorn in der Spalte Vermerk (Sendezustand einer gepufferten Zeile). */
  vermerkVor?: ReactNode;
  /** Was unter „+n“ aufklappt: alle Vermerke umbrechend (`EtbVermerkListe`). */
  vermerkeVoll?: ReactNode;
  /** Steht immer unter dem Inhalt (Grund und Entscheidung einer abgelehnten Zeile, Veranlassung). */
  unterzeile?: ReactNode;
  menue?: ReactNode;
  /** Titel der Zeile: Verfasser. */
  titel?: string;
  style?: CSSProperties;
}

export default function EtbSpaltenzeile({
  zeit,
  nr,
  typ,
  typwort,
  vonAn,
  weg,
  fundstellen,
  inhalt,
  offenErzwungen = false,
  berichtigt = false,
  leise = false,
  toenung,
  vermerke = [],
  vermerkVor,
  vermerkeVoll,
  unterzeile,
  menue,
  titel,
  style,
  className,
  ...rest
}: EtbSpaltenzeileProps) {
  const { token, rollen } = useRollen();
  const farbe = etbTypFarbe(typ, token);
  const einklappen = useEinklappen(offenErzwungen);
  const [vermerkeAuf, setVermerkeAuf] = useState(false);
  const ueberstand = Math.max(0, (token.controlHeight - 20) / 2);
  const voll = vermerkeAuf ? vermerkeVoll : null;
  return (
    <li
      {...rest}
      data-lfh-eintrag="zeitachse"
      data-lfh-form="spalten"
      data-typ={typ}
      data-toenung={toenung}
      data-leise={leise || undefined}
      title={titel}
      className={['etb-spaltenzeile', 'etb-spaltenraster', className].filter(Boolean).join(' ')}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: ETB_SPALTEN_RASTER,
        columnGap: ETB_SPALTEN_RINNE,
        rowGap: 2,
        alignItems: 'baseline',
        paddingBlock: 4,
        paddingInlineStart: ETB_SPALTEN_KANTE + ETB_SPALTEN_EINZUG,
        borderBlockEnd: `1px solid ${rollen.flaeche2}`,
        background: zeilenGrund(rollen, toenung),
        listStyle: 'none',
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        data-lfh="typkante"
        style={{
          position: 'absolute',
          insetBlock: 0,
          insetInlineStart: 0,
          width: ETB_SPALTEN_KANTE,
          background: farbe.kante,
        }}
      />
      <span
        data-lfh="zeitachse-zeit"
        style={{ ...monoStil(15, 500), lineHeight: '20px', color: rollen.text }}
      >
        {zeit}
      </span>
      <span style={{ ...monoStil(12), lineHeight: '20px', color: rollen.gedaempft }}>
        {nr != null && (
          <>
            <span style={NUR_VORLESER}>Nr. </span>
            {nr}
          </>
        )}
      </span>
      <span
        data-lfh="typwort"
        style={{
          fontSize: 12,
          fontWeight: 600,
          lineHeight: '20px',
          color: farbe.wort,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {typwort}
      </span>
      <VonAnText anzeige={vonAn} weg={weg} begriff={fundstellen} />
      <EinklappHuelle
        einklappen={einklappen}
        style={{
          minWidth: 0,
          lineHeight: '20px',
          overflowWrap: 'anywhere',
          color: leise ? rollen.gedaempft : rollen.text,
          ...(leise ? ({ '--etb-inhalt-groesse': '12px' } as CSSProperties) : {}),
        }}
      >
        <div className={berichtigt ? 'etb-inhalt--berichtigt' : undefined}>{inhalt}</div>
      </EinklappHuelle>
      <EtbVermerkSpalte
        vermerke={vermerke}
        vor={vermerkVor}
        nach={<EinklappKnopf einklappen={einklappen} />}
        aufgeklappt={vermerkeAuf}
        onAufklappen={setVermerkeAuf}
      />
      <span
        style={{
          alignSelf: 'center',
          display: 'flex',
          justifyContent: 'flex-end',
          marginBlock: -ueberstand,
        }}
      >
        {menue}
      </span>
      {(voll != null || unterzeile != null) && (
        <div
          data-lfh="etb-unterzeile"
          style={{
            gridColumn: '5 / -1',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            fontSize: 12,
            lineHeight: '18px',
            color: rollen.gedaempft,
          }}
        >
          {voll}
          {unterzeile}
        </div>
      )}
    </li>
  );
}
