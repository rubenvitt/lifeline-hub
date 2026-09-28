import type { Staerke } from '../api/types';

/**
 * Reine Darstellung einer taktischen Stärke als `F/UF/M//Σ` (BOS-Schreibweise), "—" bei `null`.
 * Rendert bewusst ein Fragment, damit zusammengesetzte Textzeilen (z. B. „kumuliert …") nicht
 * in mehrere Textknoten zerfallen.
 */
export default function StaerkeAnzeige({ wert }: { wert: Staerke | null }) {
  if (!wert) return <>—</>;
  const { fuehrer, unterfuehrer, mannschaft } = wert;
  return <>{`${fuehrer}/${unterfuehrer}/${mannschaft}//${fuehrer + unterfuehrer + mannschaft}`}</>;
}
