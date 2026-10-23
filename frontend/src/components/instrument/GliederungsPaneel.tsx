import type { ReactNode } from 'react';
import { Link } from 'react-router';
import DashboardPaneel, { type DashboardPaneelBasis } from './DashboardPaneel';
import { listenZeileStil } from './ListenPaneel';
import { useRollen } from './rollenwerte';
import './gliederungsPaneel.css';

/**
 * GliederungsPaneel — die Gliederung des Einsatzes, je Teil eine Zeile mit Lagekante, Kopf,
 * Inhalt und Zahlspalte (Regel „Dashboard-Baukasten“, `frontend/AGENTS.md`, LLH-1140). Abnehmer:
 * Einsatzabschnitte im Überblick (Lagezustand, Stärke, Einheiten je Status).
 *
 * Jede Zeile ist EIN Link auf ihren Teil; der Linkname bildet sich aus dem Inhalt in
 * DOM-Reihenfolge (Kopf · Inhalt · Zahl). Die Zeile ist ein handgebautes Bedienziel
 * (`listenZeileStil`, LFH-365).
 *
 * LAGEKANTE: Farbe nur als 3-px-Rand (`kante.farbe`, aufgelöste Rolle), das Wort steht im Kopf
 * (zweiter Kanal, WCAG 1.4.1). Ohne Beurteilung (`kante: null`) durchsichtig — eine graue Kante
 * sähe aus wie eine Stufe „neutral“.
 *
 * GEOMETRIE in `gliederungsPaneel.css` (Container-Abfrage auf die Paneelbreite): breit
 * Kante · Kopf · Inhalt · Zahl, schmal Kopf und Zahl oben, Inhalt darunter.
 *
 * `vorspann` steht über den Zeilen (etwa die Legende der Statusverteilung: am Handy läge ein Fuß
 * weit unter der ersten Zeile, LFH-962). `kennung` setzt `data-lfh` der Zeile und
 * `<kennung>-kante`.
 */

/** Klassen der Geometrie — exportiert, damit Tests und Aufrufer sie nicht nachschreiben. */
export const GLIEDERUNG_KLASSE = {
  liste: 'lfh-gliederung',
  zeile: 'lfh-gliederung__zeile',
  kante: 'lfh-gliederung__kante',
  kopf: 'lfh-gliederung__kopf',
  inhalt: 'lfh-gliederung__inhalt',
  zahl: 'lfh-gliederung__zahl',
} as const;

export interface Gliederungszeile {
  schluessel: string | number;
  ziel: string;
  /** Lagekante: aufgelöste Farbe und Rolle (`data-rolle`); `null` = nicht beurteilt. */
  kante: { farbe: string; rolle: string } | null;
  /** Name, Leitung, Lagezustand als Wort. */
  kopf: ReactNode;
  /** Auftrag, Rückmeldung o. ä. */
  inhalt?: ReactNode;
  /** Stärke, Verteilung — rechtsbündig. */
  zahl: ReactNode;
}

export default function GliederungsPaneel({
  zeilen,
  vorspann,
  kennung = 'gliederung',
  ...basis
}: DashboardPaneelBasis & {
  zeilen: readonly Gliederungszeile[];
  vorspann?: ReactNode;
  kennung?: string;
}) {
  const { token, rollen } = useRollen();
  return (
    <DashboardPaneel {...basis}>
      {vorspann}
      <ul className={GLIEDERUNG_KLASSE.liste} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {zeilen.map((z) => (
          <li key={z.schluessel}>
            <Link
              to={z.ziel}
              data-lfh={kennung}
              className={GLIEDERUNG_KLASSE.zeile}
              // `display` inline, weil `listenZeileStil` Flex setzt.
              style={{
                ...listenZeileStil(rollen, token),
                display: 'grid',
                paddingBlock: token.padding,
              }}
            >
              <span
                aria-hidden="true"
                data-lfh={`${kennung}-kante`}
                data-rolle={z.kante?.rolle}
                className={GLIEDERUNG_KLASSE.kante}
                style={{ background: z.kante ? z.kante.farbe : 'transparent' }}
              />
              <span
                className={GLIEDERUNG_KLASSE.kopf}
                style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}
              >
                {z.kopf}
              </span>
              <span
                className={GLIEDERUNG_KLASSE.inhalt}
                style={{
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 7,
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: rollen.gedaempft,
                  overflowWrap: 'anywhere',
                }}
              >
                {z.inhalt}
              </span>
              <span
                className={GLIEDERUNG_KLASSE.zahl}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}
              >
                {z.zahl}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </DashboardPaneel>
  );
}
