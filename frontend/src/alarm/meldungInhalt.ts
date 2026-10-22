import { ladeMeldung } from '../api/meldungen';
import type {
  BenachrichtigungArt,
  BenachrichtigungBezugTyp,
  BenachrichtigungEreignis,
  Meldung,
  MeldungStatus,
} from '../api/types';

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
 * Mal; ohne Inhalt wüsste man wieder nicht, welche Meldung offen ist. Der Eingang einer Meldung
 * (LLH-1062) nennt ihn ebenso.
 */
export const INHALT_TITEL: Partial<Record<BenachrichtigungArt, string>> = {
  sofortmeldung: 'Sofortmeldung',
  sofortmeldung_eskaliert: 'Bestätigung ausstehend',
  meldung: 'Neue Meldung',
};

/**
 * Bezüge, deren Kennung eine Meldung ist, mit dem Titelwort, das ihr Ereignis trägt (`null`:
 * das der Art). Die Übernahme in die Lage (LLH-1062) hat keine eigene Art, ihr Bezug sagt es.
 */
const MELDUNG_BEZUG: Partial<Record<BenachrichtigungBezugTyp, string | null>> = {
  meldung: null,
  lage_uebernahme: 'In die Lage übernommen',
};

/** Titelwort eines Hinweises zu einer Meldung; `null`, wenn er keinen Inhalt nennt. */
export function inhaltTitelWort(
  art: BenachrichtigungArt,
  bezugTyp: BenachrichtigungBezugTyp = 'meldung',
): string | null {
  if (!(bezugTyp in MELDUNG_BEZUG) || !INHALT_TITEL[art]) return null;
  return MELDUNG_BEZUG[bezugTyp] ?? INHALT_TITEL[art] ?? null;
}

/** Was ein Hinweis aus der Meldung übernimmt; `null` je Feld heißt: Text des Servers. */
export type MeldungInhalt = {
  titel: string | null;
  anfang: string | null;
  wortlaut: string | null;
  /** Absender allein, für die Zeilen des Eingangshinweises. */
  absender: string | null;
  /** Triage-Status beim Abruf: „Sichten“ gibt es nur für eine neue Meldung. */
  status: MeldungStatus | null;
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

/**
 * Der Inhalt, den ein Hinweis der Art `art` zum Bezug `bezugTyp` aus der Meldung zeigt; `null`
 * für andere Arten und Bezüge.
 */
export function meldungInhaltVon(
  art: BenachrichtigungArt,
  m: Pick<Meldung, 'absender' | 'inhalt'> & Partial<Pick<Meldung, 'status'>>,
  bezugTyp: BenachrichtigungBezugTyp = 'meldung',
): MeldungInhalt | null {
  const titelWort = inhaltTitelWort(art, bezugTyp);
  if (!titelWort) return null;
  const absender = m.absender?.trim() ?? '';
  const wortlaut = m.inhalt?.trim() ?? '';
  return {
    titel: absender ? `${titelWort} · ${absender}` : null,
    anfang: wortlaut ? wortlautAnfang(wortlaut) : null,
    wortlaut: wortlaut || null,
    absender: absender || null,
    status: m.status ?? null,
  };
}

/**
 * Holt den Inhalt zu einem Hinweis, höchstens {@link INHALT_FRIST_MS} lang. Wirft nie: ein
 * Fehler, eine fremde Art oder ein anderer Bezug ergeben `null`.
 */
export function ladeMeldungInhalt(
  e: Pick<BenachrichtigungEreignis, 'art' | 'bezug_typ' | 'bezug_id' | 'einsatz_id'>,
): Promise<MeldungInhalt | null> {
  if (!inhaltTitelWort(e.art, e.bezug_typ)) return Promise.resolve(null);
  const abruf = ladeMeldung(e.einsatz_id, e.bezug_id).then(
    (m) => meldungInhaltVon(e.art, m, e.bezug_typ),
    () => null,
  );
  let uhr: ReturnType<typeof setTimeout> | undefined;
  const frist = new Promise<null>((fertig) => {
    uhr = setTimeout(() => fertig(null), INHALT_FRIST_MS);
  });
  return Promise.race([abruf, frist]).finally(() => clearTimeout(uhr));
}
