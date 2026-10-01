/**
 * Bietet einen geladenen Export dem Browser als Datei an (LFH-728).
 *
 * Bewusst nicht als `<a href download>` auf den Endpunkt (`DownloadAnker`): der Browser speicherte
 * dann auch eine Fehlerantwort (403, 500) als Datei, und der Fehler gehört an die Seite
 * (`frontend/AGENTS.md`, Rückwege und Fehler). Deshalb erst laden (`apiDatei`), dann speichern.
 */

/** Wie lange die Object-URL nach dem Klick lebt: ein sofortiges Freigeben bricht den Download in
 *  manchen Engines ab, bevor er die Bytes gelesen hat. */
const FREIGABE_NACH_MS = 10_000;

const zweistellig = (n: number) => String(n).padStart(2, '0');

/** `personen-einsatz-42-2026-10-01-0705.csv` — Inhalt, Einsatz, lokaler Zeitpunkt auf die
 *  Minute. Der Server schickt keinen Dateinamen; ohne Stempel überschrieben sich Exporte. */
export function exportDateiname(inhalt: string, einsatzId: number, jetzt = new Date()): string {
  const datum = `${jetzt.getFullYear()}-${zweistellig(jetzt.getMonth() + 1)}-${zweistellig(jetzt.getDate())}`;
  const uhrzeit = `${zweistellig(jetzt.getHours())}${zweistellig(jetzt.getMinutes())}`;
  return `${inhalt}-einsatz-${einsatzId}-${datum}-${uhrzeit}.csv`;
}

export function speichereDatei(datei: Blob, dateiname: string): void {
  const url = URL.createObjectURL(datei);
  const anker = document.createElement('a');
  anker.href = url;
  anker.download = dateiname;
  anker.hidden = true;
  // Im Dokument klicken: Firefox ignoriert den Klick auf einen losen Anker.
  document.body.appendChild(anker);
  try {
    anker.click();
  } finally {
    anker.remove();
    setTimeout(() => URL.revokeObjectURL(url), FREIGABE_NACH_MS);
  }
}
