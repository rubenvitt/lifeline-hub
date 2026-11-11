import { ApiError } from './client';

/**
 * Anhänge auf Abruf am Spiegel (LLH-1492, design.md D8, Spec `einsatz-spiegel`, „Anhänge auf
 * Abruf“): fehlt der Inhalt eines Anhangs, eines Kartenhintergrunds oder eines UHS-Plans noch,
 * antwortet der Server mit 409 und diesem Text, fordert ihn an und weckt den Abgleich. Die
 * Oberfläche zeigt dann „wird geholt“ statt eines Fehlers und versucht es nach dem nächsten
 * Abgleich erneut. Einen eigenen Fehlercode trägt die Antwort nicht; der Text ist der Vertrag
 * (`WIRD_GEHOLT` in `src/instanz/spiegel/anhang.rs`).
 */
export const ANHANG_WIRD_GEHOLT_TEXT = 'Der Anhang wird von der führenden Instanz geholt.';

/** Kurzwort an der Stelle des Inhalts. */
export const WIRD_GEHOLT_WORT = 'wird geholt';

/** Der Inhalt ist am Spiegel noch nicht da und wird geholt. */
export class AnhangWirdGeholt extends Error {
  constructor() {
    super(ANHANG_WIRD_GEHOLT_TEXT);
    this.name = 'AnhangWirdGeholt';
  }
}

/** Ob ein Fehler „wird geholt“ heißt (eigener Fehler oder die 409 des Servers). */
export function isAnhangWirdGeholt(e: unknown): boolean {
  if (e instanceof AnhangWirdGeholt) return true;
  return e instanceof ApiError && e.status === 409 && e.message === ANHANG_WIRD_GEHOLT_TEXT;
}

/** Liest eine 409-Antwort eines Inhaltsabrufs; heißt sie „wird geholt“, wirft es das. */
export async function throwIfWirdGeholt(res: Response): Promise<void> {
  if (res.status !== 409) return;
  let text: unknown = null;
  try {
    text = ((await res.clone().json()) as { error?: unknown }).error;
  } catch {
    // kein JSON — dann ist es kein „wird geholt“
  }
  if (text === ANHANG_WIRD_GEHOLT_TEXT) throw new AnhangWirdGeholt();
}

/**
 * Prüft nach einem gescheiterten Laden (Bild, Download), ob der Inhalt am Spiegel geholt wird.
 * Ein GET auf dieselbe Adresse: 409 mit dem Text heißt `wird_geholt`, eine 2xx `bereit`, alles
 * andere `fehler`. Nur am Spiegel aufrufen: sonst kostet ein kaputtes Bild einen zweiten Abruf.
 */
export async function checkAnhangAbruf(
  href: string,
  signal?: AbortSignal,
): Promise<'bereit' | 'wird_geholt' | 'fehler'> {
  try {
    const res = await fetch(href, { credentials: 'same-origin', signal });
    if (res.ok) {
      // Den Inhalt nicht lesen: der Browser lädt ihn danach selbst.
      void res.body?.cancel().catch(() => {});
      return 'bereit';
    }
    await throwIfWirdGeholt(res);
    return 'fehler';
  } catch (e) {
    return isAnhangWirdGeholt(e) ? 'wird_geholt' : 'fehler';
  }
}
