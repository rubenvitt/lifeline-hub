/**
 * Zeiteingabe in der Anzeigezone (LFH-692, Fähigkeit `zeiteingabe`) — der EINE Wandlungskern
 * zwischen Wire, Formularwert und Picker.
 *
 * - **Wire:** UTC ohne Zonenkennung (`YYYY-MM-DD HH:mm:ss`).
 * - **Formularwert:** ein absoluter Zeitpunkt (`Dayjs`, Modus egal). Validatoren, Schnellwahlen
 *   und `alsBackendZeit` rechnen daran ohne Zonenwissen richtig.
 * - **Picker (antd):** ein BROWSERLOKALES `Dayjs`, dessen Uhrzeit die Wanduhr der Anzeigezone ist.
 *   antd erzeugt „jetzt“ und neue Panel-Daten selbst mit `dayjs()`, und ein tz-`Dayjs` trägt einen
 *   festen Versatz, den `.add`/`.set` über eine Sommerzeitgrenze nicht nachführen — deshalb wird
 *   nur an der Grenze gewandelt (`zuWanduhr` hinein, `ausWanduhr` heraus), nie dazwischen.
 *
 * Herleitung: `openspec/changes/archive/2026-10-01-lfh-692-zeiteingabe-anzeigezone/design.md` (D1, D2, D4).
 */
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const WIRE = 'YYYY-MM-DD HH:mm:ss';
const TAG = 'YYYY-MM-DD';

/** Zone des Browsers (im Test: die Prozesszone). */
export function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Gültige IANA-Zone oder `null` (= Browserzone). Das Einstellungsfeld ist Freitext; ein Tippfehler
 * darf keine Eingabe zum Absturz bringen (wie `format.ts:inZone`).
 */
export function effektiveZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/**
 * Wire → Zeitpunkt. `dayjs(s)` läse den zonenlosen String als Ortszeit und verschöbe ihn um den
 * Versatz, deshalb `dayjs.utc`. Unbrauchbares wird GANZ verworfen: ein `Invalid Date` im Picker
 * ist von außen nicht von einem gesetzten Datum zu unterscheiden.
 */
export function alsZeitpunkt(s: string | null | undefined): Dayjs | undefined {
  if (!s) return undefined;
  const d = dayjs.utc(s);
  return d.isValid() ? d : undefined;
}

/**
 * Wire → Zeitpunkt mit der Wanduhr der BROWSERZONE. Nur für Anzeigen ohne Anzeige-Konventionen
 * (Admin-Seiten außerhalb eines Einsatzes) und für Testerwartungen; jede Eingabe nimmt
 * `alsZeitpunkt` und die Bausteine in `ZeitpunktEingabe.tsx`.
 */
export function alsOrtszeit(s: string | null | undefined): Dayjs | undefined {
  return alsZeitpunkt(s)?.local();
}

/** Zeitpunkt → Wire (UTC ohne Zonenkennung). */
export function alsBackendZeit(d: Dayjs): string {
  return d.utc().format(WIRE);
}

/** Zeitpunkt → browserlokales `Dayjs` mit der Wanduhr der Anzeigezone (für den Picker). */
export function zuWanduhr(zeitpunkt: Dayjs, zone: string | null | undefined): Dayjs {
  const z = effektiveZone(zone);
  if (!z) return zeitpunkt.local();
  // Fehlt die Wanduhr in der Browserzone (Lücke einer Umstellung, die die Anzeigezone nicht
  // hat), schiebt `Date` sie nach vorn — gültig und nie früher als gewünscht (Test pinnt das).
  return dayjs(zeitpunkt.tz(z).format(WIRE));
}

/** Picker-Wert (browserlokal) → Zeitpunkt: seine Wanduhr gilt in der Anzeigezone. */
export function ausWanduhr(wanduhr: Dayjs, zone: string | null | undefined): Dayjs {
  const z = effektiveZone(zone);
  if (!z) return wanduhr;
  return dayjs.tz(wanduhr.format(WIRE), z);
}

/** Kalendertag `YYYY-MM-DD` eines Zeitpunkts in der Anzeigezone. */
export function tagInZone(zeitpunkt: Dayjs, zone: string | null | undefined): string {
  const z = effektiveZone(zone);
  return (z ? zeitpunkt.tz(z) : zeitpunkt.local()).format(TAG);
}

/** Heutiger Kalendertag `YYYY-MM-DD` in der Anzeigezone. */
export function heuteInZone(zone: string | null | undefined, jetzt: Dayjs = dayjs()): string {
  return tagInZone(jetzt, zone);
}

/** Liegt der Kalendertag einer Picker-Wanduhr nach „heute“ der Anzeigezone? (`disabledDate`) */
export function istZukunftstag(
  wanduhr: Dayjs,
  zone: string | null | undefined,
  jetzt: Dayjs = dayjs(),
): boolean {
  return wanduhr.format(TAG) > heuteInZone(zone, jetzt);
}
