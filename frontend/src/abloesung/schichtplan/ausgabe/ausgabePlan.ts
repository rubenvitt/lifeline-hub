/**
 * Der Schichtplan zum Ausgeben (LLH-1557, Change `jwqanxja-schichtplan-ausgeben`, design D1):
 * eine fachneutrale Form, aus der Aushang je Posten und Zettel je Person entstehen. Der Plan eines
 * Einsatzes kommt über `ausEinsatzPlan.ts` herein, die Vorplanung über `planung/ausPlanung.ts`. Gerechnet wird hier nur, was die Blätter ordnen und summieren; offene Plätze liefert
 * der Server.
 */

/** Ein Posten in der Reihenfolge der Gliederung (Einsatz) bzw. der Planung. */
export interface AusgabePosten {
  schluessel: string;
  titel: string;
  /** Name des Abschnitts; `null` = ohne Abschnitt. */
  abschnitt: string | null;
  /** Die Pause hat keinen Aushang und zählt nicht zu den Stunden. */
  isPause: boolean;
}

/** Eine eingeteilte Person. */
export interface AusgabePerson {
  /** Eindeutig im Plan, etwa `stamm:12` oder `helfer:3`. */
  schluessel: string;
  name: string;
  /** Nur bei Helfern des Plans. */
  organisation: string | null;
  /** Nur bei Helfern des Plans; für Stamm-Personal liefert der Plan keins. */
  telefon: string | null;
  /** Kennungen im Katalog der Organisation. */
  qualifikationen: readonly number[];
}

/** Ein Qualifikationssoll mit Bezeichnung. */
export interface AusgabeQualiSoll {
  label: string;
  anzahl: number;
}

/** Eine Schicht (ein Block des Plans). */
export interface AusgabeSchicht {
  id: string;
  posten: string;
  /** UTC-Wire wie vom Server. */
  von: string;
  bis: string;
  /** Millisekunden seit Epoche, für Ordnung und Dauer. */
  vonMs: number;
  bisMs: number;
  sollAnzahl: number | null;
  qualiSoll: readonly AusgabeQualiSoll[];
  offen: number;
  /** Anzahl Eingeteilter, auch ohne Namen. */
  personenAnzahl: number;
  /** Schlüssel der Eingeteilten; `null` ohne Freigabe des Moduls Personal. */
  personen: readonly string[] | null;
}

export interface AusgabePlan {
  posten: readonly AusgabePosten[];
  schichten: readonly AusgabeSchicht[];
  /** `null` ohne Freigabe des Moduls Personal: dann gibt es keine Namen und keine Zettel. */
  personen: readonly AusgabePerson[] | null;
}

// ── Aushang je Posten ──────────────────────────────────────────────────────────────────────

export interface AushangZeile {
  schicht: AusgabeSchicht;
  /** Die Eingeteilten in Namensfolge; leer ohne Namen. */
  personen: readonly AusgabePerson[];
}

export interface Aushang {
  posten: AusgabePosten;
  zeilen: readonly AushangZeile[];
  /** Das Soll des Postens, wenn alle Schichten dasselbe haben; sonst steht es je Schicht. */
  soll: { anzahl: number | null; quali: readonly AusgabeQualiSoll[] } | null;
}

const namensfolge = (a: AusgabePerson, b: AusgabePerson) =>
  a.name.localeCompare(b.name, 'de') || a.schluessel.localeCompare(b.schluessel);

const zeitfolge = (a: AusgabeSchicht, b: AusgabeSchicht) =>
  a.vonMs - b.vonMs || a.bisMs - b.bisMs || a.id.localeCompare(b.id);

function personenVon(plan: AusgabePlan): Map<string, AusgabePerson> {
  return new Map((plan.personen ?? []).map((p) => [p.schluessel, p]));
}

function eingeteilt(schicht: AusgabeSchicht, personen: Map<string, AusgabePerson>) {
  return (schicht.personen ?? [])
    .map((s) => personen.get(s))
    .filter((p): p is AusgabePerson => p != null)
    .sort(namensfolge);
}

const sollGleich = (a: AusgabeSchicht, b: AusgabeSchicht) =>
  a.sollAnzahl === b.sollAnzahl &&
  a.qualiSoll.length === b.qualiSoll.length &&
  a.qualiSoll.every(
    (q, i) => q.label === b.qualiSoll[i].label && q.anzahl === b.qualiSoll[i].anzahl,
  );

/** Ein Aushang je Posten mit Schichten, in der Reihenfolge der Posten; ohne Pause. */
export function aushaenge(plan: AusgabePlan): Aushang[] {
  const personen = personenVon(plan);
  return plan.posten
    .filter((p) => !p.isPause)
    .map((posten) => {
      const schichten = plan.schichten
        .filter((s) => s.posten === posten.schluessel)
        .sort(zeitfolge);
      const erste = schichten[0];
      const einheitlich = erste != null && schichten.every((s) => sollGleich(s, erste));
      return {
        posten,
        zeilen: schichten.map((schicht) => ({ schicht, personen: eingeteilt(schicht, personen) })),
        soll: einheitlich ? { anzahl: erste.sollAnzahl, quali: erste.qualiSoll } : null,
      };
    })
    .filter((a) => a.zeilen.length > 0);
}

// ── Zettel je Person ───────────────────────────────────────────────────────────────────────

export interface ZettelZeile {
  schicht: AusgabeSchicht;
  posten: AusgabePosten;
  /** Wer sonst in dieser Schicht steht, in Namensfolge; bei der Pause leer. */
  mit: readonly AusgabePerson[];
}

export interface Zettel {
  person: AusgabePerson;
  zeilen: readonly ZettelZeile[];
  /** Schichten ohne Pause. */
  schichten: number;
  /** Minuten ohne Pause. */
  minuten: number;
}

/** Ein Zettel je eingeteilter Person, nach Namen; ohne Freigabe Personal keine. */
export function zettel(plan: AusgabePlan): Zettel[] {
  if (plan.personen == null) return [];
  const personen = personenVon(plan);
  const posten = new Map(plan.posten.map((p) => [p.schluessel, p]));
  const jePerson = new Map<string, ZettelZeile[]>();
  for (const schicht of [...plan.schichten].sort(zeitfolge)) {
    const p = posten.get(schicht.posten);
    if (!p) continue;
    const alle = eingeteilt(schicht, personen);
    for (const person of alle) {
      const liste = jePerson.get(person.schluessel) ?? [];
      liste.push({
        schicht,
        posten: p,
        mit: p.isPause ? [] : alle.filter((o) => o.schluessel !== person.schluessel),
      });
      jePerson.set(person.schluessel, liste);
    }
  }
  return [...jePerson.entries()]
    .map(([schluessel, zeilen]) => {
      const dienst = zeilen.filter((z) => !z.posten.isPause);
      return {
        person: personen.get(schluessel)!,
        zeilen,
        schichten: dienst.length,
        minuten: dienst.reduce(
          (n, z) => n + Math.round((z.schicht.bisMs - z.schicht.vonMs) / 60_000),
          0,
        ),
      };
    })
    .sort((a, b) => namensfolge(a.person, b.person));
}

// ── Gemeinsames ────────────────────────────────────────────────────────────────────────────

/**
 * Ob die Schichten des Plans auf mehr als einem Kalendertag beginnen oder enden; dann tragen die
 * Blätter eine Spalte „Tag“. `tagVon` liefert den Kalendertag eines Zeitpunkts (ms) in der Zone
 * der Anzeige (vom Aufrufer, damit die Zonenrechnung bei `anzeige/` bleibt).
 */
export function mehrereTage(plan: AusgabePlan, tagVon: (ms: number) => string): boolean {
  const tage = new Set<string>();
  for (const s of plan.schichten) {
    tage.add(tagVon(s.vonMs));
    // Eine Schicht bis Mitternacht endet nicht am nächsten Tag.
    tage.add(tagVon(s.bisMs - 1));
    if (tage.size > 1) return true;
  }
  return false;
}

/** „Soll 4, davon 1 × Rettungssanitäter“; ohne Soll `null`. */
export function sollText(anzahl: number | null, quali: readonly AusgabeQualiSoll[]): string | null {
  const q = quali.map((e) => `${e.anzahl} × ${e.label}`).join(', ');
  if (anzahl == null) return q ? `Soll ${q}` : null;
  return q ? `Soll ${anzahl}, davon ${q}` : `Soll ${anzahl}`;
}

/** Besetzung ohne Namen: „3 von 4 besetzt“ bzw. „3 eingeteilt“. */
export function besetzungText(schicht: AusgabeSchicht): string {
  if (schicht.sollAnzahl == null)
    return schicht.personenAnzahl === 0 ? 'unbesetzt' : `${schicht.personenAnzahl} eingeteilt`;
  return `${schicht.personenAnzahl} von ${schicht.sollAnzahl} besetzt`;
}
