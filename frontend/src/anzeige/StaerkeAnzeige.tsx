import type { Staerke } from '../api/types';

/**
 * Reine Darstellung einer taktischen Stärke als `F/UF/M//Σ` (Gesamt = Summe, BOS-Schreibweise
 * mit Doppelstrich vor der Gesamtstärke), "—" bei `null`.
 *
 * Rendert bewusst KEIN umschließendes Element (Fragment), damit zusammengesetzte Textzeilen
 * (z. B. der „kumuliert …"-Tag in EinheitenPage/EinsatzabschnittePage) nicht in mehrere
 * Textknoten splitten und deren `getByText`-Substring-Matches grün bleiben.
 */
export default function StaerkeAnzeige({ wert }: { wert: Staerke | null }) {
  if (!wert) return <>—</>;
  const { fuehrer, unterfuehrer, mannschaft } = wert;
  return <>{`${fuehrer}/${unterfuehrer}/${mannschaft}//${fuehrer + unterfuehrer + mannschaft}`}</>;
}
