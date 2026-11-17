import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import type { EtbTyp } from '../api/types';
import { useRollen } from '../components/instrument';
import { monoStil } from '../components/instrument/rollenwerte';
import { zeilenGrund } from '../components/instrument/Zeitachseneintrag';
import { etbTypFarbe } from '../theme/statusFarben';
import { EtbInhalt } from './EtbInhalt';
import { NUR_VORLESER, VonAnText } from './EtbSpaltenzeile';
import { ETB_SPALTEN_KANTE } from './etbSpalten';
import type { VonAnAnzeige } from './etbSpalten';
import './etbSpaltenzeile.css';

/**
 * Die Zeile auf dem Handschirm (Spec `etb-zeitachse-darstellung`, „Zeile auf dem Handschirm“,
 * Entwurf `docs/design/2026-11-12-etb/Handy-Lesen.dc.html`): unter `md` oben eine Kopfzeile mit
 * Zeit, Typwort und Von → An, darunter der Inhalt in voller Breite, Vermerke darunter. Zeilenmenü
 * und Verfasser nehmen dem Inhalt keine Breite: das ⋮ steht am Ende der Kopfzeile, der Verfasser
 * im Titel und im Zeilenmenü. Bei 390 px nutzt der Inhalt so mindestens 330 px.
 */
type Hueller = Omit<HTMLAttributes<HTMLLIElement>, 'children' | 'style' | 'title'>;

export interface EtbHandschirmzeileProps extends Hueller {
  zeit: ReactNode;
  nr?: number;
  typ: EtbTyp;
  typwort: string;
  vonAn: VonAnAnzeige;
  weg?: string;
  fundstellen?: string;
  /** Neben dem Typwort: Sendezustand einer gepufferten Zeile. */
  meta?: ReactNode;
  inhalt: ReactNode;
  offenErzwungen?: boolean;
  berichtigt?: boolean;
  leise?: boolean;
  toenung?: 'berichtigung' | 'problem';
  /** Vermerke und alles unter dem Text (`EtbVermerkListe`, Grund einer Ablehnung). */
  unten?: ReactNode;
  menue?: ReactNode;
  titel?: string;
  style?: CSSProperties;
}

export default function EtbHandschirmzeile({
  zeit,
  nr,
  typ,
  typwort,
  vonAn,
  weg,
  fundstellen,
  meta,
  inhalt,
  offenErzwungen = false,
  berichtigt = false,
  leise = false,
  toenung,
  unten,
  menue,
  titel,
  style,
  className,
  ...rest
}: EtbHandschirmzeileProps) {
  const { token, rollen } = useRollen();
  const farbe = etbTypFarbe(typ, token);
  return (
    <li
      {...rest}
      data-lfh-eintrag="zeitachse"
      data-lfh-form="handschirm"
      data-typ={typ}
      data-toenung={toenung}
      data-leise={leise || undefined}
      title={titel}
      className={['etb-handschirmzeile', className].filter(Boolean).join(' ')}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        paddingBlock: '7px 8px',
        paddingInline: `${token.paddingXS + ETB_SPALTEN_KANTE}px ${token.paddingSM}px`,
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
      <div
        data-lfh="etb-kopfzeile"
        style={{ display: 'flex', alignItems: 'center', gap: token.marginXS, minWidth: 0 }}
      >
        <span
          data-lfh="zeitachse-zeit"
          style={{ ...monoStil(15, 500), lineHeight: '20px', color: rollen.text, flex: 'none' }}
        >
          {zeit}
        </span>
        {nr != null && (
          <span style={{ ...monoStil(12), color: rollen.gedaempft, flex: 'none' }}>
            <span style={NUR_VORLESER}>Nr. </span>
            {nr}
          </span>
        )}
        <span
          data-lfh="typwort"
          style={{ fontSize: 12, fontWeight: 600, color: farbe.wort, flex: 'none' }}
        >
          {typwort}
        </span>
        {meta != null && <span style={{ flex: 'none' }}>{meta}</span>}
        <span style={{ flex: '1 1 auto', minWidth: 0 }}>
          <VonAnText anzeige={vonAn} weg={weg} begriff={fundstellen} />
        </span>
        {menue != null && <span style={{ flex: 'none', marginInlineStart: 'auto' }}>{menue}</span>}
      </div>
      <div
        style={{
          minWidth: 0,
          overflowWrap: 'anywhere',
          color: leise ? rollen.gedaempft : rollen.text,
          ...(leise ? ({ '--etb-inhalt-groesse': '12px' } as CSSProperties) : {}),
        }}
      >
        <EtbInhalt offenErzwungen={offenErzwungen} style={{ lineHeight: '20px' }}>
          <div className={berichtigt ? 'etb-inhalt--berichtigt' : undefined}>{inhalt}</div>
        </EtbInhalt>
      </div>
      {unten}
    </li>
  );
}
