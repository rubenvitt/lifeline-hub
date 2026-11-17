/**
 * Marke einer DWD-Warnung im Seitenkopf (LLH-1117, Spec `lage-wetter-pegel`, „Wetterwarnung im
 * Seitenkopf des Lagebilds"): Warndreieck und Stufe als Wort in der Rollenfarbe des Vertrags
 * `dwdWarnstufe` (zweiter Kanal = Wort), dahinter Ereignis und Zeitraum, als EIN Sprung zur
 * Modulseite. Welche Warnung, entscheidet `kopfWarnung.ts`; die Marke zeigt nur.
 *
 * Still: kein Ton, kein Hinweis in der AlarmZentrale (das Alarmbudget gehört dem Unwetterhinweis,
 * LFH-663). Der Link hält die Steuerhöhe der Staffel (Handgebautes Bedienziel, LFH-365); Schrift
 * und Größe erbt er vom Kopf-Meta, in dem er steht, wie der Warnstufen-Hinweis daneben.
 *
 * Als eigener Baustein gebaut, damit die Dashboard-Bausteine (LFH-1162) ihn übernehmen können.
 */
import { Link } from 'react-router';
import { useRollen } from '../components/instrument';
import { IconWarndreieck } from '../icons';
import { dwdWarnstufe } from '../theme/statusFarben';
import type { KopfWarnung } from './kopfWarnung';

export default function WetterKopfMarke({ warnung, ziel }: { warnung: KopfWarnung; ziel: string }) {
  const { token, rollen } = useRollen();
  const farbe =
    dwdWarnstufe[warnung.stufe].rolle === 'alarm' ? rollen.alarmText : rollen.achtungText;
  return (
    <span data-lfh="wetter-kopfmarke" style={{ display: 'inline-flex', minWidth: 0 }}>
      <Link
        to={ziel}
        style={{
          display: 'inline-flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 6,
          minHeight: token.controlHeight,
          color: rollen.text,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: farbe }}>
          <span aria-hidden="true" style={{ display: 'inline-flex' }}>
            <IconWarndreieck size={14} />
          </span>
          {warnung.stufenwort}
        </span>{' '}
        <span>
          {warnung.text}
          {warnung.weitere > 0 ? ` (+ ${warnung.weitere} weitere)` : ''}
        </span>
        <span aria-hidden="true" style={{ color: rollen.bedienText }}>
          {' '}
          ↗
        </span>
      </Link>
    </span>
  );
}
