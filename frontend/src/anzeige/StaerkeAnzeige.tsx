import type { Staerke } from '../api/types';
import { staerkeText } from './staerke';

/**
 * Reine Darstellung einer taktischen Stärke als `F/UF/M//Σ` (BOS-Schreibweise), "—" bei `null`.
 * Rendert bewusst ein Fragment, damit zusammengesetzte Textzeilen (z. B. „kumuliert …") nicht
 * in mehrere Textknoten zerfallen.
 */
export default function StaerkeAnzeige({ wert }: { wert: Staerke | null }) {
  return <>{staerkeText(wert)}</>;
}
