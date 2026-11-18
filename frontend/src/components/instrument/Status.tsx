import type { CSSProperties, ReactNode } from 'react';
import type { StatusDarstellung } from '../../theme/statusFarben';
import { monoStil, useRollen } from './rollenwerte';
import { statusFlaeche, tonVonRolle, type StatusTon } from './statusFlaeche';

/**
 * StatusZelle und Status — Status als getönte Fläche (Neuentwurf S1 „Statuszelle",
 * S2 Abschnittsraster, S6 Einheitenliste). Die Farbwerte und ihre Kontrastrechnung stehen
 * in {@link statusFlaeche}; hier wird nur angeordnet.
 *
 * DER ZWEITE KANAL IST PFLICHT, und zwar im Typ: `wort` ist ein Pflicht-Prop. Die Zelle
 * zeigt oft nur eine Zahl (die Legende über dem Raster bzw. im Spaltenkopf nennt die Bedeutung
 * fürs Auge); deshalb trägt sie das Wort unsichtbar hinter der Zahl und als `title` — ein
 * Vorleser hört „2 bereit", nicht „2".
 *
 * KEIN Bedienziel: beide sind Anzeige. Wer eine Zelle klickbar braucht, legt einen Link
 * oder Knopf DARUM (mit den zwei Angaben aus LFH-365), statt hier einen `onClick` zu
 * erwarten.
 */

/** Visuell verborgen, für Vorleser da — die übliche Clip-Bauform. */
export const NUR_VORLESER: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

interface StatusZelleProps {
  ton: StatusTon;
  /** Der angezeigte Wert, meist eine Zahl. */
  wert: ReactNode;
  /** Zweiter Kanal — Pflicht. */
  wort: string;
  /** Zellenhöhe in px; Vorgabe 34 (Entwurf S1), 24 für dichte Raster (S2). */
  hoehe?: number;
  style?: CSSProperties;
}

/** Raster-taugliche Zelle: steht im Fugenraster (`gap: 1px` auf `linie`) des Aufrufers. */
export function StatusZelle({ ton, wert, wort, hoehe = 34, style }: StatusZelleProps) {
  const { rollen } = useRollen();
  const f = statusFlaeche(rollen, ton);
  return (
    <div
      data-lfh="status-zelle"
      data-ton={ton}
      title={wort}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: hoehe,
        background: f.grund,
        color: f.text,
        ...monoStil(hoehe >= 30 ? 13 : 12),
        ...style,
      }}
    >
      {wert}
      <span style={NUR_VORLESER}> {wort}</span>
    </div>
  );
}

/** Formzeichen als dritter Kanal (DV 102, A0-Formensprache), für Vorleser ausgeblendet. */
export const FORM_ZEICHEN: Record<NonNullable<StatusDarstellung['form']>, string> = {
  dreieck: '▲',
  kreis: '●',
  balken: '▮',
};

/**
 * Formzeichen einer Rolle, wenn der Aufrufer keins nennt (Change
 * `eon26eat-status-und-bedienung`, D1): Alarm ▲, Achtung ▮, in Ordnung ●. Neutral und Bedienung
 * tragen keins; dort ist nichts zu tun, und ein Zeichen würde nur Lärm machen.
 */
export function formVonTon(ton: StatusTon): StatusDarstellung['form'] {
  switch (ton) {
    case 'alarm':
      return 'dreieck';
    case 'achtung':
      return 'balken';
    case 'normal':
      return 'kreis';
    default:
      return undefined;
  }
}

/** Zwei Größen, sonst keine (Spec `status-darstellung`, „Ein Zustand hat eine Form“). */
export type StatusGroesse = 'klein' | 'normal';

export const STATUS_MASSE: Record<StatusGroesse, { hoehe: number; schrift: number }> = {
  klein: { hoehe: 20, schrift: 11 },
  normal: { hoehe: 24, schrift: 12 },
};

type StatusQuelle =
  | { darstellung: StatusDarstellung; ton?: never; wort?: never }
  | { ton: StatusTon; wort: string; darstellung?: never };

type StatusProps = StatusQuelle & {
  /** Code vor dem Wort (FMS „S4“, „SK III“), Mono 500. */
  code?: ReactNode;
  /** Punkt zwischen Code und Wort, das FMS-Format „S4 · Am Einsatzort“ (LFH-973). */
  trenner?: boolean;
  /** Formzeichen; ohne Angabe nach Rolle ({@link formVonTon}), `null` unterdrückt es. */
  form?: StatusDarstellung['form'] | null;
  /**
   * Mandantengepflegte Zusatzfarbe (`status_farbe`, ungeprüfter Freitext): nur ein dekorativer
   * Punkt (LFH-446), nie die Fläche.
   */
  farbe?: string | null;
  groesse?: StatusGroesse;
  /** Langer Wortlaut bricht um (LLH-1124), statt über den Rand zu laufen. */
  umbrechen?: boolean;
  /** Zeichen vor dem Wortlaut, etwa ein Ladekreis für einen laufenden Vorgang. */
  icon?: ReactNode;
  title?: string;
  style?: CSSProperties;
};

/**
 * Der eine Baustein für jeden angezeigten Zustand (LLH-1779, Spec `status-darstellung`):
 * getönte Fläche aus {@link statusFlaeche}, Formzeichen, Wort, KEIN Rahmen. Ein Rahmen heißt
 * „bedienbar“ (LLH-1780); den bedienbaren Status zeichnet `StatusKnopf`.
 *
 * Nimmt entweder eine {@link StatusDarstellung} aus dem Statusvertrag oder `ton` + `wort`. Die
 * Rolle `marke` hat keine Statusfläche und erscheint neutral; eine Kennzeichnung ohne Zustand
 * gehört ohnehin in `Marke`.
 */
export function Status(props: StatusProps) {
  const { code, trenner, farbe, groesse = 'normal', umbrechen = false, icon, title, style } = props;
  const { token, rollen } = useRollen();
  const ton: StatusTon = props.darstellung
    ? (tonVonRolle(props.darstellung.rolle) ?? 'neutral')
    : props.ton;
  const wort = props.darstellung ? props.darstellung.label : props.wort;
  const form =
    props.form === null ? undefined : (props.form ?? props.darstellung?.form ?? formVonTon(ton));
  const f = statusFlaeche(rollen, ton);
  const masse = STATUS_MASSE[groesse];
  const mandantenfarbe = farbe?.trim();
  return (
    <span
      data-lfh="status"
      data-ton={ton}
      data-groesse={groesse}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: token.marginXXS,
        minHeight: masse.hoehe,
        height: umbrechen ? undefined : masse.hoehe,
        paddingInline: token.paddingXS,
        background: f.grund,
        color: f.text,
        fontSize: masse.schrift,
        lineHeight: 1.2,
        whiteSpace: umbrechen ? 'normal' : 'nowrap',
        maxWidth: umbrechen ? '100%' : undefined,
        verticalAlign: 'middle',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {form && <span aria-hidden="true">{FORM_ZEICHEN[form]}</span>}
      {icon}
      {mandantenfarbe && (
        // Hintergrund statt Textfarbe: ungültiges CSS bleibt transparent.
        <span
          aria-hidden="true"
          data-lfh="mandantenfarbe"
          style={{
            display: 'inline-block',
            width: '0.5em',
            height: '0.5em',
            borderRadius: 0,
            backgroundColor: mandantenfarbe,
          }}
        />
      )}
      {code != null && <span style={monoStil(masse.schrift, 500)}>{code}</span>}
      {/* Vorgelesen trennt der Abstand, der Punkt ist Optik. */}
      {code != null && trenner && <span aria-hidden="true">·</span>}
      <span>{wort}</span>
    </span>
  );
}
