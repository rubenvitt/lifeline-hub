import type { CSSProperties, Key, ReactNode } from 'react';
import { Link } from 'react-router';
import type { Farbrollen } from '../../theme/tokens';
import DashboardPaneel, { type DashboardPaneelBasis } from './DashboardPaneel';
import { monoStil, useRollen } from './rollenwerte';

/**
 * ListenPaneel — eine kurze Liste mit „n weitere ↗“ ins Modul (Regel „Dashboard-Baukasten“,
 * `frontend/AGENTS.md`, LLH-1140). Abnehmer: offene Aufträge und nächste Marken im Überblick,
 * später „Offene Vorgänge“ (LLH-1145).
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
