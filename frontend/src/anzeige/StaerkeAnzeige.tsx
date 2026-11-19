import type { Staerke } from '../api/types';
import { STAERKE_AUSGESCHRIEBEN, staerkeText } from './staerke';

/**
 * Darstellung einer taktischen Stärke als `F/UF/M//Σ` (BOS-Schreibweise), „—“ bei `null`. Der Wert
 * trägt die ausgeschriebene Form als `title`: zugängliche Beschreibung für Vorlesehilfen und
 * Tooltip als Zusatz (LLH-1750, Spec `lage-verdichtung`, „Die Stärke nennt ihre Schreibweise“;
 * die sichtbare Schreibweise nennt die Fläche selbst, antippbar über `StaerkeSchreibweise` aus
 * `KuerzelErklaerung.tsx`, LLH-1825). Ein schlichtes
 * `span` ohne Abstand und ohne Stil, damit zusammengesetzte Zeilen („kumuliert …“) wie Text fließen.
 */
export default function StaerkeAnzeige({ wert }: { wert: Staerke | null }) {
  if (!wert) return <>{staerkeText(wert)}</>;
  return (
    <span data-lfh="staerke" title={STAERKE_AUSGESCHRIEBEN}>
      {staerkeText(wert)}
    </span>
  );
}
