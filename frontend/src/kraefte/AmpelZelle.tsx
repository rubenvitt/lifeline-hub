// Sprachbausteine werden dort eingebunden, wo sie gebraucht werden, nicht global.
import { IconAuto, IconPerson } from '../icons';
import '../theme/sprache.css';
import type { ReactNode } from 'react';
import { verteilungFelder } from './statusAchse';
import type { StatusVerteilung } from './kraeftebild';

/**
 * Die Zierde je Achse — ein Piktogramm, KEIN Emoji (Zeichnung, Farbe und Breite eines Emojis
 * kommen aus der Systemschrift). Die Zuordnung liegt HIER über das String-Union der Achse: eine
 * Prop, die eine Zeichenkette nimmt, nähme auch wieder ein Emoji. `IconPerson`, weil die
 * Spalte einzelne Kräfte zählt.
 */
const ICON: Record<'Personal' | 'Fahrzeuge', ReactNode> = {
  Personal: <IconPerson />,
  Fahrzeuge: <IconAuto />,
};

/**
 * Zählzeile einer Statusverteilung als eigene Spalte des Meldebilds (Personal bzw.
 * Fahrzeuge), Werte auch bei 0, damit zwei Zeilen fluchten.
 *
 * Zweiter Kanal: `.lfh-feld--alarm .lfh-zahl` färbt nur die ZAHL, deshalb ist jedes Feld ein
 * Verbund aus `.lfh-etikett` (Kurztext) und `.lfh-zahl`.
 *
 * Das Icon ist Zierde: das Icon des Satzes ist selbst `aria-hidden` (LFH-595), die Hülle bleibt
 * als zweite Sicherung (früher brachte antd `role="img"` mit englischem `aria-label` mit). Der
 * Test prüft, dass in der Gruppe keine `img`-Rolle überlebt.
 *
 * `.lfh-ampel` statt `.lfh-felder`: dieselben Felder ohne Raster und Rahmen, passend für eine
 * Tabellenzelle.
 */
export default function AmpelZelle({
  bezeichnung,
  verteilung,
}: {
  /** Zugängliche Bezeichnung der Zählgruppe — gleich dem Spaltenkopf und Schlüssel der Zierde. */
  bezeichnung: 'Personal' | 'Fahrzeuge';
  verteilung: StatusVerteilung | null;
}) {
  const felder = verteilungFelder(verteilung);
  // `mittel`-Zeilen tragen keine Verteilung: dann steht hier nichts, nicht „0 0 0 0".
  if (felder.length === 0) return null;
  return (
    <span className="lfh-ampel" role="group" aria-label={bezeichnung}>
      <span aria-hidden="true">{ICON[bezeichnung]}</span>
      {felder.map((f) => (
        <span
          key={f.etikett}
          className={f.stufe ? `lfh-feld lfh-feld--${f.stufe}` : 'lfh-feld'}
          title={f.titel}
        >
          <span className="lfh-etikett">{f.etikett}</span>
          <b className="lfh-zahl lfh-zahl--mittel">{f.wert}</b>
        </span>
      ))}
    </span>
  );
}
