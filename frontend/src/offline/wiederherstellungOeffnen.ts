/**
 * Öffnet den Wiederherstellungsbereich (`OfflineRecoveryDrawer`) von außerhalb der Betriebszeile,
 * die ihn besitzt (LLH-1758): der Zähler „n NICHT GESENDET“ im Kopf ist ein Knopf dorthin. Ein
 * Modul-Store ohne Speicher; die Betriebszeile abonniert ihn.
 */
const hoerer = new Set<() => void>();

export function openWiederherstellung(): void {
  for (const h of [...hoerer]) h();
}

export function subscribeWiederherstellung(listener: () => void): () => void {
  hoerer.add(listener);
  return () => {
    hoerer.delete(listener);
  };
}
