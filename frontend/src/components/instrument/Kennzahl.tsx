import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import type { Farbrollen, Schriftstufenname } from '../../theme/tokens';
import Augenbraue from './Augenbraue';
import { Aufgliederung, type Segment } from './Aufgliederung';
import { monoStil, schriftStil, useRollen } from './rollenwerte';
import { statusFlaeche, type StatusTon } from './statusFlaeche';
// Grund und Hover/Fokus der Zelle stehen als Klasse `.lfh-kennzahl` in der Gestaltungssprache:
// ein Inline-Grund schlüge jede `:hover`-Regel.
import '../../theme/sprache.css';

/**
 * Kennzahl und Kennzahlenband (Neuentwurf S1/S2/S6) — „Zahl führt".
 *
 * Eine Zelle: Augenbraue · Zahl Mono 500 in drei Stufen (22 / 32 / 40 aus
 * `schriftskala`) · optionale Einheit Mono 12 `schwach` · Notiz 11 `gedaempft` ·
 * optionaler Aufgliederungsbalken. Das Band setzt n Zellen ins FUGENRASTER: `gap: 1px`
 * auf `linie`, jede Zelle auf `flaeche`.
 *
 * ── DATENZUSTÄNDE, übernommen aus dem Lage-Dashboard (LFH-331 · B3) ────────────────
 *
 * `laden` → „····" mit `aria-busy`, Notiz „wird abgerufen". `fehler` → „?" mit
 * `title="Stand unbekannt"`, Notiz „Stand unbekannt". Das ist wörtlich die Weiche aus
 * `pages/lage-dashboard/LageDashboardPage.tsx`, deren Tests die Strings pinnen: wer das
 * Dashboard auf diesen Baustein zieht, verliert nichts. Eine NULL ist ein Wert, kein
 * Zustand — „Fehler sieht aus wie leer" ist der Sweep-Befund, gegen den die drei Formen
 * verschieden aussehen. Der Ton gilt nur im Zustand `daten`: ein „?" in Alarmrot
 * behauptete eine Lage, die niemand kennt.
 *
 * ── TON UND ZWEITER KANAL ──────────────────────────────────────────────────────────
 *
 * `achtung`/`alarm` färben die Zahl UND setzen eine abgestufte Innenkante (3 bzw. 6 px,
 * `inset`-Schatten, null Layout): die beiden bewerteten Stufen unterscheiden sich auch
 * ohne Farbe, und die Zeile springt beim Statuswechsel nicht (keine stufenabhängige
 * Schriftgröße).
 *
 * ── STATUSPUNKT (Neuentwurf S6, Statusstufen-Kacheln) ──────────────────────────────
 *
 * `punkt` setzt ein 8-px-Quadrat in der Tonfarbe VOR die Augenbraue — die Kachel benennt
 * damit eine STUFE (S1 … S6), nicht eine Bewertung der Zahl; deshalb ist er von `ton`
 * getrennt. Er ist Dekoration (`aria-hidden`): der zweite Kanal ist die Augenbraue mit dem
 * Stufenwort. Wie `ton` gilt er nur im Zustand `daten` — bei `laden`/`fehler` steht er
 * neutral an seinem Platz, damit die Zeile nicht springt und kein Ton eine unbekannte Lage
 * behauptet.
 *
 * ── KLICKBAR ────────────────────────────────────────────────────────────────────────
 *
 * Mit `ziel` wird die ganze Zelle ein `<Link>` — ein handgebautes Bedienziel mit den ZWEI
 * Angaben aus LFH-365 (`minHeight: token.controlHeight` plus Polsterung aus der Staffel).
 * Grund (`flaeche`) sowie Hover/Fokus tragen die Klassen `lfh-kennzahl` /
 * `lfh-kennzahl--ziel` in `sprache.css` — ein Inline-Grund schlüge jede `:hover`-Regel. Im Zustand `laden`
 * bleibt die Zelle trotzdem ein Link: das Ziel (die Liste) existiert auch ohne Zahl.
 */

export type KennzahlZustand = 'daten' | 'laden' | 'fehler';
export type KennzahlTon = 'neutral' | 'achtung' | 'alarm';
export type KennzahlGroesse = 'klein' | 'mittel' | 'gross';

const STUFE: Record<KennzahlGroesse, Schriftstufenname> = {
  klein: 'datenwertKlein',
  mittel: 'datenwert',
  gross: 'datenwertGross',
};

/** Kantenbreite je Ton — abgestuft, damit Alarm und Achtung ohne Farbe unterscheidbar sind. */
export const KANTE: Record<KennzahlTon, number> = { neutral: 0, achtung: 3, alarm: 6 };

export const LADE_ZEICHEN = '····';
export const FEHLER_ZEICHEN = '?';
export const STAND_UNBEKANNT = 'Stand unbekannt';
export const WIRD_ABGERUFEN = 'wird abgerufen';

/** Die Zahlfarbe — nur im Zustand `daten` getönt. Rein. */
export function zahlFarbe(
  rollen: Pick<Farbrollen, 'text' | 'achtung' | 'alarm'>,
  ton: KennzahlTon,
  zustand: KennzahlZustand,
): string {
  if (zustand !== 'daten' || ton === 'neutral') return rollen.text;
  return ton === 'alarm' ? rollen.alarm : rollen.achtung;
}

/**
 * Farbe des Statuspunkts — die KANTE der Statusfläche (`statusFlaeche`), also dieselbe
 * Rollenfarbe, die `StatusZelle`/`StatusChip` als Rand tragen. Außerhalb von `daten` neutral.
 * Rein.
 */
export function punktFarbe(
  rollen: Parameters<typeof statusFlaeche>[0],
  ton: StatusTon,
  zustand: KennzahlZustand,
  dunkel: boolean,
): string {
  return statusFlaeche(rollen, zustand === 'daten' ? ton : 'neutral', dunkel).kante;
}

/**
 * Stil der Zelle — rein und exportiert (Muster `bedienzielStil`), damit Boden und Kante
 * ohne Render prüfbar sind. `minHeight` steht IMMER da, nicht nur klickbar: ein Band mit
 * gemischten Zellen soll nicht in der Höhe springen, wenn eine davon ein Ziel bekommt.
 */
export function kennzahlStil(
  rollen: Pick<Farbrollen, 'text' | 'achtung' | 'alarm'>,
  token: { controlHeight: number; padding: number; paddingLG: number; marginXS: number },
  ton: KennzahlTon,
  zustand: KennzahlZustand,
): CSSProperties {
  const kante = zustand === 'daten' ? KANTE[ton] : 0;
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: token.marginXS,
    minWidth: 0,
    minHeight: token.controlHeight,
    paddingBlock: token.padding,
    paddingInline: token.paddingLG,
    color: rollen.text,
    textDecoration: 'none',
    ...(kante > 0
      ? { boxShadow: `inset ${kante}px 0 0 0 ${ton === 'alarm' ? rollen.alarm : rollen.achtung}` }
      : {}),
  };
}

export interface KennzahlProps {
  /** Augenbraue — was gezählt wird. */
  titel: ReactNode;
  wert: ReactNode;
  einheit?: ReactNode;
  notiz?: ReactNode;
  groesse?: KennzahlGroesse;
  ton?: KennzahlTon;
  zustand?: KennzahlZustand;
  /** Statuspunkt vor der Augenbraue (S6-Statusstufen) — siehe Dateikopf. */
  punkt?: StatusTon;
  /** Aufgliederungsbalken unter der Zahl. */
  aufgliederung?: { segmente: readonly Segment[]; titel?: string; legende?: ReactNode | false };
  /** Macht die Zelle zum Link auf diese Route (gebaut über `routing/deeplinks.ts`). */
  ziel?: string;
  /** Zugänglicher Name des Links; Vorgabe ist sein Textinhalt. */
  zielBeschriftung?: string;
  style?: CSSProperties;
}

export function Kennzahl({
  titel,
  wert,
  einheit,
  notiz,
  groesse = 'mittel',
  ton = 'neutral',
  zustand = 'daten',
  punkt,
  aufgliederung,
  ziel,
  zielBeschriftung,
  style,
}: KennzahlProps) {
  const { token, rollen, dunkel } = useRollen();
  const zahl =
    zustand === 'laden' ? (
      <b aria-busy="true" style={{ font: 'inherit' }}>
        {LADE_ZEICHEN}
      </b>
    ) : zustand === 'fehler' ? (
      <b title={STAND_UNBEKANNT} style={{ font: 'inherit' }}>
        {FEHLER_ZEICHEN}
      </b>
    ) : (
      <b style={{ font: 'inherit' }}>{wert}</b>
    );
  const notizText =
    zustand === 'fehler' ? STAND_UNBEKANNT : zustand === 'laden' ? WIRD_ABGERUFEN : notiz;

  const inhalt = (
    <>
      {punkt != null ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
          <span
            aria-hidden="true"
            data-lfh="kennzahl-punkt"
            data-ton={zustand === 'daten' ? punkt : 'neutral'}
            style={{
              width: 8,
              height: 8,
              flex: '0 0 8px',
              background: punktFarbe(rollen, punkt, zustand, dunkel),
            }}
          />
          <Augenbraue>{titel}</Augenbraue>
        </span>
      ) : (
        <Augenbraue>{titel}</Augenbraue>
      )}
      <span style={{ display: 'flex', alignItems: 'baseline', gap: token.marginXS }}>
        <span
          data-lfh="kennzahl-wert"
          style={{
            ...schriftStil(STUFE[groesse]),
            lineHeight: 1,
            color: zahlFarbe(rollen, ton, zustand),
          }}
        >
          {zahl}
        </span>
        {einheit != null && zustand === 'daten' && (
          <span style={{ ...monoStil(12), color: rollen.schwach }}>{einheit}</span>
        )}
      </span>
      {aufgliederung != null && zustand === 'daten' && (
        <Aufgliederung
          segmente={aufgliederung.segmente}
          titel={aufgliederung.titel}
          legende={aufgliederung.legende}
        />
      )}
      {notizText != null && (
        <span style={{ fontSize: 11, lineHeight: 1.4, color: rollen.gedaempft }}>{notizText}</span>
      )}
    </>
  );

  const stil = { ...kennzahlStil(rollen, token, ton, zustand), ...style };
  return ziel != null ? (
    <Link
      to={ziel}
      aria-label={zielBeschriftung}
      className="lfh-kennzahl lfh-kennzahl--ziel"
      data-lfh="kennzahl"
      style={stil}
    >
      {inhalt}
    </Link>
  ) : (
    <div
      className="lfh-kennzahl"
      data-lfh="kennzahl"
      aria-busy={zustand === 'laden' || undefined}
      style={stil}
    >
      {inhalt}
    </div>
  );
}

/**
 * Stil des Fugenrasters. `spalten` fest, sonst so viele, wie mit ≥ 160 px passen —
 * das Band bricht auf dem Handschirm um, statt Etiketten abzuschneiden.
 */
export function kennzahlenbandStil(
  rollen: Pick<Farbrollen, 'linie'>,
  spalten?: number,
): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns:
      spalten != null
        ? `repeat(${spalten}, minmax(0, 1fr))`
        : 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))',
    gap: 1,
    background: rollen.linie,
    border: `1px solid ${rollen.linie}`,
  };
}

interface KennzahlenbandProps {
  children: ReactNode;
  /** Feste Spaltenzahl; ohne sie füllt das Band nach verfügbarer Breite. */
  spalten?: number;
  /** Zugänglicher Name der Gruppe („Lage in Zahlen"). */
  beschriftung?: string;
  style?: CSSProperties;
}

export function Kennzahlenband({ children, spalten, beschriftung, style }: KennzahlenbandProps) {
  const { rollen } = useRollen();
  return (
    <div
      role={beschriftung ? 'group' : undefined}
      aria-label={beschriftung}
      data-lfh="kennzahlenband"
      style={{ ...kennzahlenbandStil(rollen, spalten), ...style }}
    >
      {children}
    </div>
  );
}
