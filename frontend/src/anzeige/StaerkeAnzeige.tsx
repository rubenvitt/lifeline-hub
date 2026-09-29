import type { Staerke } from '../api/types';
import { staerkeText } from './staerke';

/**
 * Reine Darstellung einer taktischen Stärke als `F/UF/M//Σ` (Gesamt = Summe, BOS-Schreibweise
 * mit Doppelstrich vor der Gesamtstärke), "—" bei `null`.
 *
 * Rendert bewusst KEIN umschließendes Element (Fragment), damit zusammengesetzte Textzeilen
 * (z. B. der „kumuliert …"-Tag in EinheitenPage/EinsatzabschnittePage) nicht in mehrere
 * Textknoten splitten und deren `getByText`-Substring-Matches grün bleiben.
 */
export default function StaerkeAnzeige({ wert }: { wert: Staerke | null }) {
  return <>{staerkeText(wert)}</>;
}
