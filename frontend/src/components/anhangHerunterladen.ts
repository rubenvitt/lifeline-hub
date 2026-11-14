import { ApiError, apiDatei } from '../api/client';
import { WIRD_GEHOLT_WORT, isAnhangWirdGeholt } from '../api/anhangAbruf';
import { speichereDatei } from './dateiSpeichern';

/** Ein großer Anhang braucht über eine schmale Leitung mehr als die 15 s eines Abrufs. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * Lädt einen Anhang aus einem Menü herunter (Zeilenmenü der ETB-Zeitachse, Review L2): derselbe
 * Weg wie am Verweis (`useAnhangDownload`), nur ohne Verweis, an dem „wird geholt“ stehen könnte.
 * Ohne Spiegel ein Klick auf einen nackten Verweis (`<a href download>`, wie `DownloadAnker`). Am
 * Spiegel erst laden (`apiDatei`), dann anbieten: der Browser speicherte sonst die 409 „wird
 * geholt“ als Datei. Das Ergebnis meldet `melde` (antd `message`), weil es keinen Verweis gibt.
 */
export async function ladeAnhangHerunter(
  href: string,
  dateiname: string,
  opts: { spiegel: boolean; melde: (art: 'info' | 'error', text: string) => void },
): Promise<void> {
  if (!opts.spiegel) {
    const a = document.createElement('a');
    a.href = href;
    a.download = dateiname;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  try {
    speichereDatei(await apiDatei(href, { timeoutMs: DOWNLOAD_TIMEOUT_MS }), dateiname);
  } catch (e) {
    if (isAnhangWirdGeholt(e)) {
      opts.melde(
        'info',
        `${dateiname}: ${WIRD_GEHOLT_WORT}, nach dem nächsten Abgleich erneut versuchen`,
      );
    } else {
      opts.melde('error', `${dateiname}: ${e instanceof ApiError ? e.message : 'nicht geladen'}`);
    }
  }
}
