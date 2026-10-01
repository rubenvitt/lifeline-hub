/**
 * Kopfzeile „Umfang" einer Druckansicht: „1 Person", „1 200 Personen" — Tausender mit
 * Leerzeichen wie im ETB-Druck (`EtbDruckPage`), Einzahl bei genau einem.
 */
export function umfangText(anzahl: number, einzahl: string, mehrzahl: string): string {
  const zahl = String(anzahl).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${zahl} ${anzahl === 1 ? einzahl : mehrzahl}`;
}
