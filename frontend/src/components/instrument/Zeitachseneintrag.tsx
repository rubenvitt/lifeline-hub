import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import type { EtbTyp } from '../../api/types';
import { etbTypFarbe } from '../../theme/statusFarben';
import type { EtbTypFarbe, Farbrollen } from '../../theme/tokens';
import { useViewport } from '../useViewport';
import { monoStil, useRollen } from './rollenwerte';

/**
 * Zeitachsen-Eintrag (Neuentwurf S1/S4, S2 „Entscheidungen der letzten Stunde") — die
 * Zeile des Einsatztagebuchs und jedes anderen zeitlich gelesenen Stroms (Meldungen,
 * Entscheidungen, Anordnungen).
 *
 * Aufbau von links: Zeit Mono 13/500 (+ Nr. Mono 10 `schwach`) · 2-px-KANTE in Typfarbe ·
 * TYPWORT Mono 10 Versalien, Sperrung .1em, in Wortfarbe, daneben Meta Mono 10 · Text
 * 13/1.5 · optionale Hinweiszeile 11 · rechts Verfasser Mono 11 / Weg Mono 10 · Aktionen.
 *
 * TYP ALS KANTE + WORT, NICHT ALS ETIKETT (Entscheidung 2 des Auftraggebers). Die Farbe
 * kommt aus `etbTypFarbe` (`theme/statusFarben.ts`): Kante und Wort sind zwei Werte, weil
 * sie verschiedene Böden haben — die Kante ist Dekoration, das Wort ist Text. Der zweite
 * Kanal ist das TYPWORT; es ist deshalb Pflicht und kommt vom Aufrufer (`etbTyp[typ].label`
 * o. ä.), nicht aus diesem Baustein — hier steht keine zweite Beschriftungskarte.
 * Für Ströme außerhalb des ETB nimmt `farben` ein eigenes Kante/Wort-Paar (aus einer Rolle
 * aufgelöst), `typ` bleibt dann weg.
 *
 * ZEILENTÖNUNG `berichtigung` / `luecke` / `problem` — ganze Zeile auf der jeweiligen
 * Zeilenrolle. Sie ersetzt das Typwort nicht; sie markiert den Eintrag in der Menge.
 *
 * Die Hülle reicht HTML-Attribute durch (`data-*`, `id`, `className`): ein Konsument im
 * Kartenzweig der `Datensicht` braucht `data-lfh="datensicht-karte"` und seine
 * `zeilenKlasse`, sonst findet `scrolleZurZeile` die Zeile nicht (CLAUDE.md, ETB-Eigenbau).
 */

export type Zeilentoenung = 'berichtigung' | 'luecke' | 'problem';
export type HinweisTon = 'schwach' | 'bedien' | 'alarm';

const TOENUNG: Record<Zeilentoenung, keyof Farbrollen> = {
  berichtigung: 'berichtigungZeile',
  luecke: 'lueckeZeile',
  problem: 'problemZeile',
};

/** Hinweisfarbe je Ton — rein. */
export function hinweisFarbe(
  rollen: Pick<Farbrollen, 'schwach' | 'bedien' | 'alarmText'>,
  ton: HinweisTon,
): string {
  return ton === 'alarm' ? rollen.alarmText : ton === 'bedien' ? rollen.bedien : rollen.schwach;
}

/** Grund der Zeile — rein. Ohne Tönung transparent (die Fläche darunter trägt). */
export function zeilenGrund(rollen: Farbrollen, toenung?: Zeilentoenung): string {
  return toenung ? (rollen[TOENUNG[toenung]] as string) : 'transparent';
}

/**
 * Waagerechte Rinne der drei Spalten — rein und exportiert (Muster `bedienzielStil`).
 *
 * Unter `md` die kleine Stufe (`paddingSM`), sonst `padding`. Grund, gemessen
 * (e2e `etb-chronologie`, 390 px in `handschuh`): mit `padding` = 26 px kosteten allein die
 * fünf Rinnen 130 px, dazu die Zeitspalte (56) und die 72-px-Aktion — dem Eintragstext
 * blieben 29 % der Zeilenbreite, unter dem Boden von 30 %. Die Rinne ist Luft, keine
 * Treffläche; die Bedienziele behalten ihre Staffelhöhe.
 */
export function zeitachsenRinne(token: { padding: number; paddingSM: number }, schmal: boolean) {
  return schmal ? token.paddingSM : token.padding;
}

type Hueller = Omit<HTMLAttributes<HTMLElement>, 'children' | 'style'>;

export interface ZeitachseneintragProps extends Hueller {
  zeit: ReactNode;
  /** Laufende Nummer („Nr. 409"). */
  nr?: ReactNode;
  /** ETB-Typ — liefert Kante und Wortfarbe. */
  typ?: EtbTyp;
  /** Eigenes Farbpaar für Ströme außerhalb des ETB; gewinnt gegen `typ`. */
  farben?: EtbTypFarbe;
  /** Das Typwort — Pflicht, zweiter Kanal („ANORDNUNG" oder „Anordnung", Versalien per CSS). */
  typwort: string;
  /** Mono-Meta neben dem Typwort („berichtigt Nr. 388", „S2 Lage"). */
  meta?: ReactNode;
  /** Der Eintragstext. */
  children: ReactNode;
  hinweis?: ReactNode;
  hinweisTon?: HinweisTon;
  verfasser?: ReactNode;
  weg?: ReactNode;
  toenung?: Zeilentoenung;
  /** Aktionen rechts (Dreipunkt-Menü o. ä., gebündelt nach LFH-365). */
  aktionen?: ReactNode;
  /** Element der Hülle; Vorgabe `div`, in einer Liste `li`, eigenständig `article`. */
  als?: 'div' | 'li' | 'article';
  style?: CSSProperties;
}

export default function Zeitachseneintrag({
  zeit,
  nr,
  typ,
  farben,
  typwort,
  meta,
  children,
  hinweis,
  hinweisTon = 'schwach',
  verfasser,
  weg,
  toenung,
  aktionen,
  als: Element = 'div',
  style,
  ...rest
}: ZeitachseneintragProps) {
  const { token, rollen } = useRollen();
  const { istSchmal } = useViewport();
  const rinne = zeitachsenRinne(token, istSchmal);
  const farbe: EtbTypFarbe =
    farben ?? (typ ? etbTypFarbe(typ, token) : { kante: rollen.schwach, wort: rollen.gedaempft });
  const spalte = { paddingBlock: token.paddingSM } as const;
  return (
    <Element
      {...rest}
      data-lfh-eintrag="zeitachse"
      data-typ={typ}
      data-toenung={toenung}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        borderBlockEnd: `1px solid ${rollen.flaeche2}`,
        background: zeilenGrund(rollen, toenung),
        listStyle: 'none',
        ...style,
      }}
    >
      <div
        style={{
          ...spalte,
          flex: '0 0 auto',
          minWidth: 56,
          paddingInline: rinne,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span style={{ ...monoStil(13, 500), color: rollen.text }}>{zeit}</span>
        {nr != null && <span style={{ ...monoStil(10), color: rollen.schwach }}>{nr}</span>}
      </div>
      <span
        aria-hidden="true"
        data-lfh="typkante"
        style={{
          flex: '0 0 2px',
          width: 2,
          marginBlock: token.paddingSM,
          background: farbe.kante,
        }}
      />
      <div
        style={{
          ...spalte,
          flex: '1 1 auto',
          minWidth: 0,
          paddingInline: rinne,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: token.marginXS }}
        >
          <span
            data-lfh="typwort"
            style={{
              ...monoStil(10, 500),
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: farbe.wort,
            }}
          >
            {typwort}
          </span>
          {meta != null && <span style={{ ...monoStil(10), color: rollen.schwach }}>{meta}</span>}
        </div>
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: rollen.text2,
            overflowWrap: 'anywhere',
          }}
        >
          {children}
        </div>
        {hinweis != null && (
          <div style={{ fontSize: 11, lineHeight: 1.5, color: hinweisFarbe(rollen, hinweisTon) }}>
            {hinweis}
          </div>
        )}
      </div>
      {(verfasser != null || weg != null || aktionen != null) && (
        <div
          style={{
            ...spalte,
            flex: '0 0 auto',
            maxWidth: '40%',
            paddingInlineEnd: rinne,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 5,
            textAlign: 'end',
          }}
        >
          {verfasser != null && (
            <span style={{ ...monoStil(11), color: rollen.gedaempft }}>{verfasser}</span>
          )}
          {weg != null && <span style={{ ...monoStil(10), color: rollen.schwach }}>{weg}</span>}
          {aktionen}
        </div>
      )}
    </Element>
  );
}
