/**
 * Geteilte Upload-Konstanten für alle Datei-Uploads (Dokumentenablage, ETB-Anhänge,
 * Schaden-Anhänge). Kein Codegen: die Werte spiegeln das Backend (`upload.test.ts` pinnt sie
 * literal).
 */

/**
 * Höchstgröße einer Datei: 25 MiB, Spiegel von `MAX_GROESSE` in `src/anhang/mod.rs` (dort
 * `len > MAX_GROESSE` → 400 „Datei ist zu groß (25 MiB erlaubt)"). Die Dialoge prüfen vorab,
 * damit niemand 25 MiB über eine Mobilfunkstrecke schickt, nur um die Absage zu lesen.
 */
export const UPLOAD_MAX_GROESSE = 25 * 1024 * 1024;

/** 25 MiB + clamd-Scan über eine Mobilfunkstrecke: 15 s reichen nicht. */
export const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Dateiauswahl der Erfassungsmodule (heute Schäden), Spiegel von `ERLAUBTE_MIME_ERFASSUNG`
 * in `src/anhang/mod.rs`: Kamerabilder samt HEIC/HEIF und PDF. Der Server prüft ohnehin;
 * das hier filtert nur den Dateidialog vor.
 */
export const ERFASSUNG_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf';
