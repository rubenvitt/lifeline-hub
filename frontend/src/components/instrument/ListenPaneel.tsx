import { Button } from 'antd';
import { useId, type CSSProperties, type Key, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Farbrollen } from '../../theme/tokens';
import Augenbraue from './Augenbraue';
import DashboardPaneel, { type DashboardPaneelBasis } from './DashboardPaneel';
import { PANEEL_LADEN_TEXT, PANEEL_NEULADEN } from './PaneelZustand';
import { monoStil, useRollen } from './rollenwerte';

/**
 * ListenPaneel — eine kurze Liste mit „n weitere ↗“ ins Modul (Regel „Dashboard-Baukasten“,
 * `frontend/AGENTS.md`, LLH-1140). Abnehmer: nächste Marken im Überblick. Eine Liste in
 * Abschnitten („Offene Vorgänge“, LLH-1145) baut sich aus {@link ListenAbschnitt} in einem
 * `DashboardPaneel`.
 *
 * Gezeigt werden höchstens `max` Einträge; der Rest steht im Modul und wird als Link „n weitere ↗“
 * genannt, mit dem Gegenstand im zugänglichen Namen („3 weitere offene Aufträge“). Die Zahl der
 * weiteren ist eine Aussage über die geladene Liste, keine eigene Zählung: eine Kennzahl dazu
 * kommt aus dem Modulzähler (LFH-550).
 *
 * Eine leere Liste mit Daten IST der Leerzustand, der Aufrufer muss ihn nicht ausrechnen; Laden,
 * Fehler und Gesperrt sind keiner.
 *
 * Eine Zeile, die ein Ziel hat, nimmt `listenZeileStil` (handgebautes Bedienziel: Boden
 * `controlHeight` plus Polsterung aus der Staffel, LFH-365).
 */

/**
 * Eine Paneelzeile als Link — `minHeight: token.controlHeight` plus Polsterung aus der Staffel;
 * die Polsterung allein trüge den Handschuh-Boden nicht. Rein, damit die Böden ohne Render
 * prüfbar sind.
 */
export function listenZeileStil(
  rollen: Pick<Farbrollen, 'text' | 'flaeche3'>,
  token: { controlHeight: number; padding: number; paddingSM: number },
): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: token.padding,
    minHeight: token.controlHeight,
    paddingBlock: token.paddingSM,
    paddingInline: token.padding,
    borderBlockEnd: `1px solid ${rollen.flaeche3}`,
    color: rollen.text,
    textDecoration: 'none',
    boxSizing: 'border-box',
  };
}

export default function ListenPaneel<T>({
  eintraege,
  max,
  schluessel,
  zeile,
  weitere,
  zustand,
  ...basis
}: DashboardPaneelBasis & {
  eintraege: readonly T[];
  /** Höchstzahl gezeigter Einträge. */
  max: number;
  schluessel: (eintrag: T) => Key;
  /** Inhalt eines `<li>`. */
  zeile: (eintrag: T) => ReactNode;
  /** Ziel und Gegenstand von „n weitere ↗“ („offene Aufträge“). */
  weitere?: { ziel: string; name: string };
}) {
  const { token, rollen } = useRollen();
  const rest = eintraege.length - max;
  return (
    <DashboardPaneel
      {...basis}
      zustand={zustand === 'daten' && eintraege.length === 0 ? 'leer' : zustand}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {eintraege.slice(0, max).map((e) => (
          <li key={schluessel(e)}>{zeile(e)}</li>
        ))}
      </ul>
      {weitere != null && rest > 0 && (
        <Link
          to={weitere.ziel}
          data-lfh="liste-weitere"
          aria-label={`${rest} weitere ${weitere.name}`}
          style={{
            ...listenZeileStil(rollen, token),
            ...monoStil(11),
            color: rollen.bedienText,
            borderBlockEnd: 0,
          }}
        >
          {rest} weitere
          <span aria-hidden="true">↗</span>
        </Link>
      )}
    </DashboardPaneel>
  );
}

/** Zustand eines Abschnitts. `offline`: die Liste ist ohne Netz nicht geladen (pausierte Abfrage). */
export type ListenAbschnittZustand = 'daten' | 'laden' | 'fehler' | 'offline' | 'gesperrt';

/** Wortlaut der Abschnittszeilen — exportiert, damit Tests ihn nicht nachschreiben müssen. */
export const ABSCHNITT_KEINE = 'keine';
export const ABSCHNITT_OFFLINE = 'ohne Netz nicht geladen';
export const ABSCHNITT_FEHLER = 'Stand unbekannt, Liste nicht abrufbar';

/**
 * ListenAbschnitt — ein Abschnitt eines Dashboard-Paneels mit kurzer Liste (LLH-1145, Regel
 * „Dashboard-Baukasten“, `frontend/AGENTS.md`). Erster Abnehmer: „Offene Vorgänge“ im Überblick.
 *
 * KOPF: Augenbraue als Überschrift (Vorgabe `h3`, unter dem `h2` des Paneels), die Zahl (Mono),
 * eine Notiz und der Sprung „alle ↗“ ins Modul. Die ZAHL reicht der Aufrufer aus seiner
 * Zählquelle (Modulzähler, LFH-550); der Abschnitt zählt seine Liste nie. Zahl und Liste haben
 * getrennte Stände: die Zahl steht, sobald sie bekannt ist, auch wenn die Liste fehlt (ohne Netz
 * liegt der Zähler auf der Platte, manche Liste nicht). Unbekannt steht „—“, nie 0.
 *
 * KÖRPER: höchstens `max` Einträge (Vorgabe 3). Leer ist EINE Zeile „keine“, keine leere Fläche;
 * Laden, Fehler und „ohne Netz“ sind kein „keine“. GESPERRT (Modul nicht freigegeben, LFH-888):
 * Zahl „—“, der Grund als Zeile, kein Sprung, keine Liste.
 *
 * Zeilen mit Ziel nehmen {@link listenZeileStil}; der Sprung trägt den Boden `controlHeight`.
 */
export function ListenAbschnitt<T>({
  titel,
  kennung,
  ueberschrift = 'h3',
  zahl,
  zahlWort,
  notiz,
  zustand,
  eintraege,
  max = 3,
  schluessel,
  zeile,
  sprung,
  leerText = ABSCHNITT_KEINE,
  gesperrtText,
  onNeuladen,
}: {
  titel: string;
  /** `data-lfh` des Abschnitts; Vorgabe `listen-abschnitt`. */
  kennung?: string;
  ueberschrift?: 'h3' | 'h4';
  /** Zahl aus der Zählquelle des Aufrufers; `null` = unbekannt („—“). */
  zahl: number | null;
  /** Wort hinter der Zahl („im Einsatz“). */
  zahlWort?: string;
  notiz?: ReactNode;
  zustand: ListenAbschnittZustand;
  eintraege: readonly T[];
  max?: number;
  schluessel: (eintrag: T) => Key;
  /** Inhalt eines `<li>`. */
  zeile: (eintrag: T) => ReactNode;
  /** Ziel und Gegenstand von „alle ↗“ (Name „alle Meldungen“). */
  sprung?: { ziel: string; name: string };
  leerText?: string;
  /** Grund bei `gesperrt` („nicht freigegeben“). */
  gesperrtText: string;
  onNeuladen: () => void;
}) {
  const { token, rollen } = useRollen();
  const kopfId = useId();
  const gesperrt = zustand === 'gesperrt';
  const zeilenStil = listenZeileStil(rollen, token);
  const hinweisStil: CSSProperties = {
    ...zeilenStil,
    alignItems: 'center',
    fontSize: 12,
    color: rollen.gedaempft,
  };

  let koerper: ReactNode;
  if (gesperrt) {
    koerper = (
      <div data-lfh="abschnitt-gesperrt" style={hinweisStil}>
        {gesperrtText}
      </div>
    );
  } else if (zustand === 'laden') {
    koerper = (
      <div aria-busy="true" aria-label={`${titel} wird geladen`} style={hinweisStil}>
        {PANEEL_LADEN_TEXT}
      </div>
    );
  } else if (zustand === 'offline') {
    koerper = (
      <div data-lfh="abschnitt-offline" style={hinweisStil}>
        {ABSCHNITT_OFFLINE}
      </div>
    );
  } else if (zustand === 'fehler') {
    koerper = (
      <div role="alert" data-lfh="abschnitt-fehler" style={{ ...hinweisStil, flexWrap: 'wrap' }}>
        <span style={{ color: rollen.alarmText }}>{ABSCHNITT_FEHLER}</span>
        <Button onClick={onNeuladen}>{PANEEL_NEULADEN}</Button>
      </div>
    );
  } else if (eintraege.length === 0) {
    koerper = (
      <div data-lfh="abschnitt-keine" style={hinweisStil}>
        {leerText}
      </div>
    );
  } else {
    koerper = (
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {eintraege.slice(0, max).map((e) => (
          <li key={schluessel(e)}>{zeile(e)}</li>
        ))}
      </ul>
    );
  }

  return (
    <section data-lfh={kennung ?? 'listen-abschnitt'} aria-labelledby={kopfId}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          columnGap: token.paddingSM,
          rowGap: 2,
          paddingBlockStart: token.paddingSM,
          paddingInline: token.padding,
          borderBlockEnd: `1px solid ${rollen.flaeche3}`,
        }}
      >
        <Augenbraue als={ueberschrift} id={kopfId}>
          {titel}
        </Augenbraue>
        <span data-lfh="abschnitt-zahl" style={{ ...monoStil(15, 500), color: rollen.text }}>
          {gesperrt || zahl == null ? '—' : zahl}
          {zahlWort && !gesperrt && zahl != null && (
            <span style={{ ...monoStil(10), color: rollen.schwach }}> {zahlWort}</span>
          )}
        </span>
        <span
          data-lfh="abschnitt-notiz"
          style={{ flex: '1 1 auto', minWidth: 0, ...monoStil(10), color: rollen.gedaempft }}
        >
          {gesperrt ? null : notiz}
        </span>
        {!gesperrt && sprung && (
          <Link
            to={sprung.ziel}
            data-lfh="abschnitt-sprung"
            aria-label={`alle ${sprung.name}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: token.marginXXS,
              minHeight: token.controlHeight,
              paddingInline: token.paddingXS,
              ...monoStil(11),
              color: rollen.bedienText,
              textDecoration: 'none',
            }}
          >
            alle
            <span aria-hidden="true">↗</span>
          </Link>
        )}
      </div>
      {koerper}
    </section>
  );
}
