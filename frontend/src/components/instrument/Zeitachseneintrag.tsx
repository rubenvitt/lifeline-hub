import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import type { EtbTyp } from '../../api/types';
import { etbTypFarbe } from '../../theme/statusFarben';
import type { EtbTypFarbe, Farbrollen } from '../../theme/tokens';
import { useViewport } from '../useViewport';
import { monoStil, useRollen } from './rollenwerte';

/**
 * Zeitachsen-Eintrag — die Zeile des Einsatztagebuchs und jedes anderen zeitlich gelesenen
 * Stroms (Meldungen, Entscheidungen, Anordnungen).
 *
 * Aufbau von links: Zeit Mono 13/500 (+ Nr. Mono 10 `schwach`) · 2-px-KANTE in Typfarbe ·
 * TYPWORT Mono 10 Versalien, Sperrung .1em, in Wortfarbe, daneben Meta Mono 10 · Text 13/1.5 ·
 * optionale Hinweiszeile 11 · rechts Verfasser Mono 11 / Weg Mono 10 · Aktionen.
 *
 * DICHTE (LFH-958, {@link zeitachsenAufbau}): in `kompakt` stehen Verfasser und Weg als Mono-Meta
 * in der Kopfzeile neben dem Typwort, das Zeilenmenü (`menue`) an ihrem Ende; die Spalte rechts
 * trägt dann nur noch Text-Aktionen (`aktionen`). So ist ein einzeiliger Eintrag im Fükw eine
 * Zeile hoch statt drei. In `komfortabel` und `handschuh` bleibt die Spalte.
 *
 * TYP ALS KANTE + WORT, NICHT ALS ETIKETT. Die Farbe kommt aus `etbTypFarbe`
 * (`theme/statusFarben.ts`): Kante und Wort sind zwei Werte, weil sie verschiedene Böden haben
 * (Dekoration gegen Text). Der zweite Kanal ist das TYPWORT; es ist Pflicht und kommt vom
 * Aufrufer (`etbTyp[typ].label` o. ä.), hier steht keine zweite Beschriftungskarte. Für Ströme
 * außerhalb des ETB nimmt `farben` ein eigenes Kante/Wort-Paar, `typ` bleibt dann weg.
 *
 * ZEILENTÖNUNG `berichtigung` / `luecke` / `problem` — ganze Zeile auf der jeweiligen
 * Zeilenrolle. Sie ersetzt das Typwort nicht; sie markiert den Eintrag in der Menge.
 *
 * Die Hülle reicht HTML-Attribute durch (`data-*`, `id`, `className`): eine Zeile braucht
 * `data-lfh="datensicht-karte"` und ihre Zeilenklasse, sonst findet `scrolleZurZeile` sie nicht.
 */

type Zeilentoenung = 'berichtigung' | 'luecke' | 'problem';
type HinweisTon = 'schwach' | 'bedien' | 'alarm';

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
 * Aufbau der Zeile aus der Dichte — rein und exportiert (LFH-958, Muster `zielEinzug.ts`): unter
 * 48 px Bedienhöhe (`kompakt`) `zeile`, sonst `spalte`. Über das Token, nicht `useDichte()`: unter
 * einem lokal überschriebenen Theme liefen Höhe und Aufbau sonst auseinander.
 */
export function zeitachsenAufbau(token: { controlHeight: number }): 'zeile' | 'spalte' {
  return token.controlHeight < 48 ? 'zeile' : 'spalte';
}

/**
 * Waagerechte Rinne der drei Spalten — rein und exportiert (Muster `bedienzielStil`).
 *
 * Unter `md` die kleine Stufe (`paddingSM`), sonst `padding`: bei 390 px in `handschuh` ließen
 * fünf 26-px-Rinnen plus Zeitspalte und 72-px-Aktion dem Eintragstext weniger als 30 % der
 * Zeilenbreite (e2e `etb-chronologie`). Die Rinne ist Luft, keine Trefffläche.
 */
export function zeitachsenRinne(token: { padding: number; paddingSM: number }, schmal: boolean) {
  return schmal ? token.paddingSM : token.padding;
}

type Hueller = Omit<HTMLAttributes<HTMLElement>, 'children' | 'style'>;

interface ZeitachseneintragProps extends Hueller {
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
  /** Text-Aktionen rechts („Zurücknehmen“, „Erneut senden“), in jeder Dichte in der Spalte. */
  aktionen?: ReactNode;
  /** Dreipunkt-Menü der Zeile (LFH-365); in `kompakt` am Ende der Kopfzeile, sonst rechts. */
  menue?: ReactNode;
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
  menue,
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
  const einzeilig = zeitachsenAufbau(token) === 'zeile';
  const trenner = (
    <span aria-hidden="true" style={{ ...monoStil(10), color: rollen.schwach }}>
      ·
    </span>
  );
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
          gap: einzeilig ? 2 : 5,
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
          {einzeilig && verfasser != null && (
            <>
              {trenner}
              {/* Einzeilig statt des 15ch-Deckels (LFH-615), der in die Höhe umbrach; der volle
                  Name steht im Titel. */}
              <span
                data-lfh="verfasser"
                title={typeof verfasser === 'string' ? verfasser : undefined}
                style={{
                  ...monoStil(10),
                  color: rollen.gedaempft,
                  maxWidth: '24ch',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {verfasser}
              </span>
            </>
          )}
          {einzeilig && weg != null && (
            <>
              {trenner}
              <span style={{ ...monoStil(10), color: rollen.schwach }}>{weg}</span>
            </>
          )}
          {einzeilig && menue != null && (
            // Die negative Blockkante lässt den 30-px-Knopf in die Polsterung ragen, statt die
            // Kopfzeile auf seine Höhe zu ziehen; die Trefffläche bleibt ganz.
            <span style={{ marginInlineStart: 'auto', marginBlock: -token.paddingSM }}>
              {menue}
            </span>
          )}
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
      {(einzeilig
        ? aktionen != null
        : verfasser != null || weg != null || aktionen != null || menue != null) && (
        <div
          data-lfh="metaspalte"
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
          {!einzeilig && verfasser != null && (
            // Gedeckelt (LFH-615): mit Funktion („Administrator ·\u00A0EL") drückte die Spalte den
            // Meldungstext bei 1200 px unter die halbe Sicht. `ch` misst in der Mono-Schrift DIESES
            // Elements; ein längerer Verfasser bricht um.
            <span
              data-lfh="verfasser"
              style={{
                ...monoStil(11),
                color: rollen.gedaempft,
                maxWidth: '15ch',
                overflowWrap: 'anywhere',
              }}
            >
              {verfasser}
            </span>
          )}
          {!einzeilig && weg != null && (
            <span style={{ ...monoStil(10), color: rollen.schwach }}>{weg}</span>
          )}
          {aktionen}
          {!einzeilig && menue}
        </div>
      )}
    </Element>
  );
}
