import { ladeMeldung } from '../api/meldungen';
import type { BenachrichtigungArt, BenachrichtigungEreignis, Meldung } from '../api/types';

/**
 * Inhalt einer Meldung im Hinweis (LLH-1052, Spec `benachrichtigungen`, „Sofortmeldung
 * alarmiert“): Absender im Titel, Anfang des Wortlauts als Beschreibung, der ganze Wortlaut im
 * `title`.
 *
 * Absender und Wortlaut sind Scrub-Werte: der Server nennt sie weder im Live-Ereignis noch im
 * Text der Benachrichtigung (`src/benachrichtigung/text.rs`, nur Retain-Spalten). Der Client holt
 * sie über die Meldung selbst (`GET …/meldungen/{id}`, Leserecht Meldungen, das jeder Empfänger
 * hat). Antwortet sie nicht rechtzeitig, bleibt der Text des Servers.
 */

/** Höchstlänge des Wortlautanfangs in Zeichen, samt „ …“. */
export const WORTLAUT_ANFANG_MAX = 120;

/**
 * So lange wartet ein Hinweis auf den Inhalt, gerechnet ab Eingang. Danach steht er mit dem Text
 * des Servers: ein hängender Abruf darf keinen Alarm aufhalten.
 */
export const INHALT_FRIST_MS = 1500;

/**
 * Arten, deren Hinweis den Inhalt der Meldung nennt, mit dem Titelwort vor dem Absender. Eine
 * Art ohne Eintrag bleibt beim Text des Servers. Die Eskalation ist derselbe Alarm ein zweites
 * Mal; ohne Inhalt wüsste man wieder nicht, welche Meldung offen ist.
 */
export const INHALT_TITEL: Partial<Record<BenachrichtigungArt, string>> = {
  sofortmeldung: 'Sofortmeldung',
  sofortmeldung_eskaliert: 'Bestätigung ausstehend',
};

/** Was ein Hinweis aus der Meldung übernimmt; `null` je Feld heißt: Text des Servers. */
export type MeldungInhalt = {
  titel: string | null;
  anfang: string | null;
  wortlaut: string | null;
};

const AUSLASSUNG = ' …';

/**
 * Anfang eines Wortlauts für eine Zeile: Leerraum gefaltet, höchstens
 * {@link WORTLAUT_ANFANG_MAX} Zeichen. Gekürzt wird am Wortende, wenn eins in der zweiten Hälfte
 * liegt, sonst hart; dann folgt „ …“.
 */
export function wortlautAnfang(text: string, max = WORTLAUT_ANFANG_MAX): string {
  const flach = text.replace(/\s+/g, ' ').trim();
  const zeichen = Array.from(flach);
  if (zeichen.length <= max) return flach;
  const budget = max - Array.from(AUSLASSUNG).length;
  let schnitt = zeichen.slice(0, budget).join('');
  // Fällt der Schnitt genau auf ein Wortende, ist das nächste Zeichen ein Leerzeichen.
  const wortende = zeichen[budget] === ' ' ? schnitt.length : schnitt.lastIndexOf(' ');
  if (wortende > schnitt.length / 2) schnitt = schnitt.slice(0, wortende);
  return `${schnitt.replace(/[\s,;:.–-]+$/u, '')}${AUSLASSUNG}`;
}

/** Der Inhalt, den ein Hinweis der Art `art` aus der Meldung zeigt; `null` für andere Arten. */
export function meldungInhaltVon(
  art: BenachrichtigungArt,
  m: Pick<Meldung, 'absender' | 'inhalt'>,
): MeldungInhalt | null {
  const titelWort = INHALT_TITEL[art];
  if (!titelWort) return null;
  const absender = m.absender?.trim() ?? '';
  const wortlaut = m.inhalt?.trim() ?? '';
  return {
    titel: absender ? `${titelWort} · ${absender}` : null,
    anfang: wortlaut ? wortlautAnfang(wortlaut) : null,
    wortlaut: wortlaut || null,
  };
}

/**
 * Holt den Inhalt zu einem Hinweis, höchstens {@link INHALT_FRIST_MS} lang. Wirft nie: ein
 * Fehler, eine fremde Art oder ein anderer Bezug ergeben `null`.
 */
export function ladeMeldungInhalt(
  e: Pick<BenachrichtigungEreignis, 'art' | 'bezug_typ' | 'bezug_id' | 'einsatz_id'>,
): Promise<MeldungInhalt | null> {
  if (e.bezug_typ !== 'meldung' || !INHALT_TITEL[e.art]) return Promise.resolve(null);
  const abruf = ladeMeldung(e.einsatz_id, e.bezug_id).then(
    (m) => meldungInhaltVon(e.art, m),
    () => null,
  );
  let uhr: ReturnType<typeof setTimeout> | undefined;
  const frist = new Promise<null>((fertig) => {
    uhr = setTimeout(() => fertig(null), INHALT_FRIST_MS);
  });
  return Promise.race([abruf, frist]).finally(() => clearTimeout(uhr));
}
