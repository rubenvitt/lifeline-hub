import type { Sichtungskategorie, Uhs } from '../api/types';
import type { PersonAnlegenEingabe } from '../api/einsatzPerson';
import { parseKoordinate } from './koordinate';

/**
 * Der Parser der Betroffenen-Schnellerfassungszeile (Neuentwurf S7 „Das Formular wird zur
 * Zeile"). Rein — ohne Render prüfbar; die Zeile (`personen/BetroffeneZeile.tsx`) zeigt
 * nur an, was diese Datei erkennt.
 *
 * ── DIE KÜRZEL ──────────────────────────────────────────────────────────────────────────
 *
 *  · Name          „Nachname, Vorname" (Komma trennt), ohne Komma nur Nachname.
 *                  „unbekannt" und „?" bedeuten ausdrücklich: kein Name.
 *  · Geschlecht    `m` / `w` / `d` als eigenes Wort, direkt gefolgt vom Alter (`w 34`,
 *                  `m ~50`) oder zusammengeschrieben (`w34`).
 *  · Alter         `34` oder `~50`, 0–120. Das Datenmodell kennt nur das GESCHÄTZTE
 *                  Alter (`alter_geschaetzt`) — die Tilde ist deshalb Schreibhilfe, keine
 *                  zweite Genauigkeitsstufe; beide Formen landen im selben Feld.
 *  · Sichtung      `sk1`–`sk4`, `skt` (tot), `sku` (unverletzt), römisch `SKIII` oder
 *                  getrennt `SK III` / `SK 3`. Groß-/Kleinschreibung egal.
 *  · Unfallhilfsstelle  `@` + Bezeichnung (`@Weserstadion`, `@UHS Weserstadion`). `uhs_id`
 *                  geht im SELBEN Anlege-POST mit (LFH-458, Wartebereich-Eintritt in
 *                  derselben Transaktion). Das `@` nimmt alle folgenden Wörter bis zur
 *                  nächsten Sichtung, zum nächsten Geschlecht oder zum nächsten `@`/`#`
 *                  — es gehört also ans Ende oder vor diese Kürzel. Zahlen gehören zur
 *                  Bezeichnung („@UHS 2").
 *  · Koordinate    `#` + Breite/Länge (`#52.2691/9.1342`, `#52,2691/9,1342`, Minus
 *                  erlaubt) — der Fundort als WGS84-Paar (LFH-613). Geht als
 *                  `antreff_lat`/`antreff_lon` im SELBEN Anlege-POST mit (Offline-Queue,
 *                  `client_id`); gelesen über `personen/koordinate.ts`, dieselbe Funktion
 *                  wie in Maske und Detailseite. Ein `#`-Wort wird nie als Namensteil
 *                  geschluckt — sonst stünde die Koordinate als Nachname im Register.
 *
 * ── UNERKANNTES SPERRT DAS ABSENDEN ─────────────────────────────────────────────────────
 *
 * Doppelte Angaben (zwei Sichtungen, zwei Koordinaten), ein Alter außerhalb 0–120, ein
 * unbrauchbares `#` (halbes Paar, außerhalb des Bereichs), ein `@` ohne Bezeichnung und
 * eine nicht eindeutige Unfallhilfsstelle erzeugen je ein PROBLEM. Mit Problemen wird
 * nicht gesendet: ein halb verstandener Befehl legte eine Person mit
 * falscher Sichtung oder in der falschen UHS an — und die Sichtung ist genau die Angabe,
 * an der die Lage hängt. Dieselbe Regel wie `parsePlatzierenAuftrag`: Unbrauchbares ganz
 * verwerfen, nicht halb übernehmen.
 */

export type BefehlTeil =
  | { art: 'name'; text: string; name: string | null; vorname: string | null }
  | { art: 'geschlecht'; text: string; wert: GeschlechtWert; alter?: number }
  | { art: 'alter'; text: string; wert: number }
  | { art: 'sichtung'; text: string; wert: Sichtungskategorie }
  | { art: 'uhs'; text: string; suche: string }
  | { art: 'koordinate'; text: string; lat: number; lon: number }
  | { art: 'unerkannt'; text: string; grund: string };

export type GeschlechtWert = 'maennlich' | 'weiblich' | 'divers';

export interface PersonBefehl {
  /** Erkannte Teile in Eingabereihenfolge (der Name als EIN Teil an seiner ersten Stelle). */
  teile: BefehlTeil[];
  /** Die Felder der Anlage — ohne `uhs_id`, die braucht die UHS-Liste ({@link loeseBefehl}). */
  eingabe: Pick<
    PersonAnlegenEingabe,
    | 'name'
    | 'vorname'
    | 'geschlecht'
    | 'alter_geschaetzt'
    | 'sichtung'
    | 'antreff_lat'
    | 'antreff_lon'
  >;
  /** Suchtext hinter `@`, oder `null`. */
  uhsSuche: string | null;
  /** Gründe, aus denen nicht gesendet wird. */
  probleme: string[];
  /** Nichts eingegeben (nur Leerraum). */
  leer: boolean;
}

const GESCHLECHT: Record<string, GeschlechtWert> = {
  m: 'maennlich',
  w: 'weiblich',
  d: 'divers',
};

/** Kurzform für Anzeige und Quittung — Umkehrung von {@link GESCHLECHT}. */
export const GESCHLECHT_KURZ: Record<string, string> = {
  maennlich: 'm',
  weiblich: 'w',
  divers: 'd',
  unbekannt: '?',
};

const ROEMISCH: Record<string, Sichtungskategorie> = {
  i: 'sk1',
  ii: 'sk2',
  iii: 'sk3',
  iv: 'sk4',
  '1': 'sk1',
  '2': 'sk2',
  '3': 'sk3',
  '4': 'sk4',
  t: 'tot',
  u: 'unverletzt',
};

const ALTER_MUSTER = /^~?(\d{1,3})$/;
const GESCHLECHT_ALTER_MUSTER = /^([mwd])(~?\d{1,3})$/i;
const SK_EIN_WORT = /^sk(i{1,3}|iv|[1-4tu])$/i;

/** Liest ein Alterswort; `null`, wenn es keines ist; `NaN`, wenn außerhalb 0–120. */
function alterAus(wort: string): number | null {
  const m = ALTER_MUSTER.exec(wort);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 120 ? n : Number.NaN;
}

/** Sichtung aus einem Wort (`sk3`, `SKIII`) — sonst `null`. */
function sichtungAus(wort: string): Sichtungskategorie | null {
  const m = SK_EIN_WORT.exec(wort);
  return m ? (ROEMISCH[m[1].toLowerCase()] ?? null) : null;
}

/**
 * Beendet dieses Wort einen `@`-Suchtext? Sichtung, Geschlecht (auch `w34`), `@`, `#`.
 * Eine NACKTE Zahl dagegen nicht: Bezeichnungen wie „UHS 2" oder „BHP 1" sind üblich, und
 * ein Alter steht in der Zeile ohnehin hinter dem Geschlecht (`w 34`).
 */
function beendetUhsSuche(wort: string, naechstes: string | undefined): boolean {
  const klein = wort.toLowerCase();
  if (sichtungAus(wort) != null) return true;
  if (klein === 'sk' && naechstes != null && ROEMISCH[naechstes.toLowerCase()] != null) return true;
  if (GESCHLECHT[klein] != null) return true;
  if (GESCHLECHT_ALTER_MUSTER.test(wort)) return true;
  return wort.startsWith('@') || wort.startsWith('#');
}

/** „Nachname, Vorname" → Teile; `unbekannt`/`?` → kein Name. */
export function nameAus(text: string): { name: string | null; vorname: string | null } {
  const roh = text.trim();
  if (roh === '' || /^(unbekannt|\?)$/i.test(roh)) return { name: null, vorname: null };
  const komma = roh.indexOf(',');
  if (komma < 0) return { name: roh, vorname: null };
  const name = roh.slice(0, komma).trim();
  const vorname = roh.slice(komma + 1).trim();
  return { name: name === '' ? null : name, vorname: vorname === '' ? null : vorname };
}

export function parsePersonBefehl(eingabe: string): PersonBefehl {
  const woerter = eingabe
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '');
  const teile: BefehlTeil[] = [];
  const probleme: string[] = [];
  const namensWoerter: string[] = [];
  let namensIndex = -1;
  let sichtung: Sichtungskategorie | undefined;
  let geschlecht: GeschlechtWert | undefined;
  let alter: number | undefined;
  let uhsSuche: string | null = null;
  let koordinate: { lat: number; lon: number } | undefined;

  const setzeSichtung = (wert: Sichtungskategorie, text: string) => {
    if (sichtung != null) {
      teile.push({ art: 'unerkannt', text, grund: 'Sichtung doppelt' });
      probleme.push(`Sichtung doppelt angegeben („${text}")`);
      return;
    }
    sichtung = wert;
    teile.push({ art: 'sichtung', text, wert });
  };
  const setzeAlter = (wert: number, text: string): boolean => {
    if (Number.isNaN(wert)) {
      probleme.push(`Alter außerhalb 0–120 („${text}")`);
      return false;
    }
    if (alter != null) {
      probleme.push(`Alter doppelt angegeben („${text}")`);
      return false;
    }
    alter = wert;
    return true;
  };

  for (let i = 0; i < woerter.length; i++) {
    const wort = woerter[i];
    const klein = wort.toLowerCase();
    const naechstes = woerter[i + 1];

    if (wort.startsWith('#')) {
      const k = parseKoordinate(wort);
      if (!k.ok) {
        teile.push({ art: 'unerkannt', text: wort, grund: k.grund });
        probleme.push(`Koordinate unbrauchbar („${wort}": ${k.grund})`);
      } else if (koordinate != null) {
        teile.push({ art: 'unerkannt', text: wort, grund: 'Koordinate doppelt' });
        probleme.push(`Koordinate doppelt angegeben („${wort}")`);
      } else {
        koordinate = { lat: k.lat, lon: k.lon };
        teile.push({ art: 'koordinate', text: wort, lat: k.lat, lon: k.lon });
      }
      continue;
    }

    if (wort.startsWith('@')) {
      const suchWoerter = [wort.slice(1)];
      while (i + 1 < woerter.length && !beendetUhsSuche(woerter[i + 1], woerter[i + 2])) {
        suchWoerter.push(woerter[++i]);
      }
      const suche = suchWoerter.join(' ').trim();
      const text = `@${suche}`;
      if (suche === '') {
        teile.push({ art: 'unerkannt', text: '@', grund: 'Unfallhilfsstelle fehlt' });
        probleme.push('„@" ohne Bezeichnung der Unfallhilfsstelle');
      } else if (uhsSuche != null) {
        teile.push({ art: 'unerkannt', text, grund: 'Unfallhilfsstelle doppelt' });
        probleme.push(`Unfallhilfsstelle doppelt angegeben („${text}")`);
      } else {
        uhsSuche = suche;
        teile.push({ art: 'uhs', text, suche });
      }
      continue;
    }

    const skEin = sichtungAus(wort);
    if (skEin != null) {
      setzeSichtung(skEin, wort);
      continue;
    }
    if (klein === 'sk' && naechstes != null && ROEMISCH[naechstes.toLowerCase()] != null) {
      setzeSichtung(ROEMISCH[naechstes.toLowerCase()], `${wort} ${naechstes}`);
      i++;
      continue;
    }

    const zusammen = GESCHLECHT_ALTER_MUSTER.exec(wort);
    const geschlechtWort = zusammen ? zusammen[1].toLowerCase() : klein;
    if (GESCHLECHT[geschlechtWort] != null) {
      // Zusammengeschrieben (`w34`) oder als Paar (`w 34`); das Alter hängt dann am Teil.
      const alterWort = zusammen ? zusammen[2] : naechstes;
      const alterWert = alterWort != null ? alterAus(alterWort) : null;
      const text = zusammen ? wort : alterWert != null ? `${wort} ${alterWort}` : wort;
      if (!zusammen && alterWert != null) i++;
      if (geschlecht != null) {
        teile.push({ art: 'unerkannt', text, grund: 'Geschlecht doppelt' });
        probleme.push(`Geschlecht doppelt angegeben („${text}")`);
        continue;
      }
      geschlecht = GESCHLECHT[geschlechtWort];
      const alterOk = alterWert != null && setzeAlter(alterWert, text);
      teile.push({
        art: 'geschlecht',
        text,
        wert: geschlecht,
        ...(alterOk ? { alter: alterWert } : {}),
      });
      continue;
    }

    const alterWert = alterAus(wort);
    if (alterWert != null) {
      if (setzeAlter(alterWert, wort)) teile.push({ art: 'alter', text: wort, wert: alterWert });
      else teile.push({ art: 'unerkannt', text: wort, grund: 'Alter ungültig' });
      continue;
    }

    if (namensIndex < 0) namensIndex = teile.length;
    namensWoerter.push(wort);
  }

  const namensText = namensWoerter.join(' ');
  const { name, vorname } = nameAus(namensText);
  if (namensWoerter.length > 0) {
    teile.splice(namensIndex, 0, { art: 'name', text: namensText, name, vorname });
  }

  return {
    teile,
    eingabe: {
      ...(name != null ? { name } : {}),
      ...(vorname != null ? { vorname } : {}),
      ...(geschlecht != null ? { geschlecht } : {}),
      ...(alter != null ? { alter_geschaetzt: alter } : {}),
      ...(sichtung != null ? { sichtung } : {}),
      ...(koordinate != null ? { antreff_lat: koordinate.lat, antreff_lon: koordinate.lon } : {}),
    },
    uhsSuche,
    probleme,
    leer: woerter.length === 0,
  };
}

/** Wählbar ist eine UHS, die nicht aufgelöst und nicht storniert ist. */
export function istWaehlbareUhs(u: Pick<Uhs, 'status' | 'storniert_at'>): boolean {
  return u.status !== 'aufgeloest' && !u.storniert_at;
}

export type UhsAufloesung = { uhs: Uhs } | { problem: string };

/**
 * `@`-Suchtext → Unfallhilfsstelle. Nur ein EINDEUTIGER Treffer gilt: zuerst exakt
 * (ohne Groß-/Kleinschreibung, mit oder ohne vorangestelltes „UHS"), dann als Teilwort.
 * Mehrdeutig oder unbekannt → Problem, kein Raten.
 */
export function loeseUhsAuf(suche: string, liste: readonly Uhs[]): UhsAufloesung {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/^uhs\s+/, '')
      .trim();
  const s = norm(suche);
  const kandidaten = liste.filter(istWaehlbareUhs);
  const exakt = kandidaten.filter((u) => norm(u.bezeichnung) === s);
  if (exakt.length === 1) return { uhs: exakt[0] };
  const teil = kandidaten.filter((u) => norm(u.bezeichnung).includes(s));
  if (teil.length === 1) return { uhs: teil[0] };
  if (teil.length === 0) return { problem: `Keine Unfallhilfsstelle „${suche}"` };
  return { problem: `„${suche}" ist mehrdeutig (${teil.length} Unfallhilfsstellen)` };
}

export type BefehlErgebnis =
  { ok: true; eingabe: PersonAnlegenEingabe; uhs: Uhs | null } | { ok: false; probleme: string[] };

/**
 * Befehl + UHS-Liste → Anlage oder Probleme. Leere Eingabe ist KEIN Problem, sondern
 * „noch nichts" — sie liefert `ok: false` ohne Grund, und die Zeile tut dann nichts.
 */
export function loeseBefehl(befehl: PersonBefehl, uhsListe: readonly Uhs[]): BefehlErgebnis {
  if (befehl.leer) return { ok: false, probleme: [] };
  const probleme = [...befehl.probleme];
  let uhs: Uhs | null = null;
  if (befehl.uhsSuche != null) {
    const a = loeseUhsAuf(befehl.uhsSuche, uhsListe);
    if ('problem' in a) probleme.push(a.problem);
    else uhs = a.uhs;
  }
  if (probleme.length > 0) return { ok: false, probleme };
  return {
    ok: true,
    eingabe: { ...befehl.eingabe, ...(uhs ? { uhs_id: uhs.id } : {}) },
    uhs,
  };
}
