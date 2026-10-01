import dayjs, { type Dayjs } from 'dayjs';

/**
 * Versatz der Geräteuhr zur Serveruhr (LFH-705,
 * `openspec/changes/archive/2026-10-01-lfh-705-serveruhr-versatz-offline/design.md`).
 *
 * Eine offline vorgemerkte Meldung trägt ihren Erfassungszeitpunkt. Nach der Geräteuhr
 * gestempelt, scheiterte sie auf einem vorgehenden Gerät am Zukunftsriegel des Servers oder
 * verdrängte eine neuere Meldung. Deshalb liest jede eigene API-Antwort ihren `Date`-Header
 * hier ein (D2), und `serverJetzt()` rechnet die Geräteuhr auf die Serveruhr um.
 */

const SCHLUESSEL = 'lifeline-serveruhr';
/** Unter dieser Abweichung ist die Korrektur Messrauschen (Sekundenauflösung von `Date`), D3. */
const RAUSCHGRENZE_MS = 5_000;
/** Wie lange eine Messung gilt, dieselbe Frist wie die Offline-Identität (D4). */
const HALTBARKEIT_MS = 24 * 60 * 60 * 1000;

interface Messung {
  /** Serveruhr minus Geräteuhr. */
  versatzMs: number;
  /** Geräteuhr beim Empfang der gemessenen Antwort. */
  gemessenAt: number;
}

let imSpeicher: Messung | null = null;

/**
 * Darf der Browser diese Antwort ohne Rückfrage aus seinem Cache liefern? Dann ist ihr `Date`
 * so alt wie der Cache-Eintrag und taugt nicht als Uhr. Der Browser hält die Header des
 * Eintrags mit, also gibt die Antwort selbst Auskunft. Eine 304-Revalidierung frischt `Date` auf.
 */
function darfFrischAusCache(kopf: Headers): boolean {
  const cc = (kopf.get('Cache-Control') ?? '').toLowerCase();
  if (/\bno-(?:cache|store)\b/.test(cc)) return false;
  if (/\bimmutable\b/.test(cc)) return true;
  const alter = [...cc.matchAll(/\b(?:max-age|s-maxage)\s*=\s*"?(\d+)/g)].map((m) => Number(m[1]));
  // max-age schlägt Expires; Last-Modified gibt nur ohne max-age heuristische Frische.
  if (alter.length > 0) return alter.some((s) => s > 0);
  return kopf.has('Expires') || kopf.has('Last-Modified');
}

function gueltig(m: unknown): m is Messung {
  if (typeof m !== 'object' || m === null) return false;
  const { versatzMs, gemessenAt } = m as Record<string, unknown>;
  return Number.isFinite(versatzMs) && Number.isFinite(gemessenAt);
}

function ausSpeicherLesen(): Messung | null {
  try {
    const roh = localStorage.getItem(SCHLUESSEL);
    if (roh == null) return null;
    const m: unknown = JSON.parse(roh);
    return gueltig(m) ? m : null;
  } catch {
    return null;
  }
}

/** Liest den `Date`-Header einer Antwort des eigenen Servers ein. Wirft nie. */
export function merkeServerzeit(res: Response, empfangenMs: number = Date.now()): void {
  try {
    const datum = res.headers.get('Date');
    if (datum == null || darfFrischAusCache(res.headers)) return;
    const serverMs = Date.parse(datum);
    if (!Number.isFinite(serverMs)) return;
    // `Date` ist auf die Sekunde abgeschnitten: die Serverzeit lag in [Date, Date + 1 s).
    imSpeicher = { versatzMs: serverMs + 500 - empfangenMs, gemessenAt: empfangenMs };
    try {
      localStorage.setItem(SCHLUESSEL, JSON.stringify(imSpeicher));
    } catch {
      // Ohne Speicher gilt die Messung nur in diesem Tab.
    }
  } catch {
    // Eine Uhrmessung darf keinen API-Aufruf scheitern lassen.
  }
}

/** Jetzt nach der Serveruhr, soweit ein frischer Versatz bekannt ist, sonst nach der Geräteuhr. */
export function serverJetzt(): Dayjs {
  const jetzt = Date.now();
  // Die jüngere Messung gilt (D2), auch wenn sie ein anderer Tab in localStorage gelegt hat.
  const gespeichert = ausSpeicherLesen();
  const m =
    imSpeicher && (!gespeichert || imSpeicher.gemessenAt >= gespeichert.gemessenAt)
      ? imSpeicher
      : gespeichert;
  const alter = m ? jetzt - m.gemessenAt : -1;
  // Ein negatives Alter heißt, die Geräteuhr wurde seit der Messung zurückgestellt.
  if (!m || alter < 0 || alter > HALTBARKEIT_MS || Math.abs(m.versatzMs) < RAUSCHGRENZE_MS) {
    return dayjs(jetzt);
  }
  return dayjs(jetzt + m.versatzMs);
}

/** Nur für Tests: vergisst die Messung im Speicher, auf Wunsch auch die gespeicherte. */
export function serveruhrVergessenFuerTests({
  speicherBehalten = false,
}: { speicherBehalten?: boolean } = {}): void {
  imSpeicher = null;
  if (!speicherBehalten) {
    try {
      localStorage.removeItem(SCHLUESSEL);
    } catch {
      // egal
    }
  }
}
