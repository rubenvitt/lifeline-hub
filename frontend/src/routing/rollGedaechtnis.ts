/**
 * Rollposition je Verlaufseintrag (`location.key`) für das Zurück (LLH-1826, Entwurf
 * `docs/superpowers/specs/2026-11-19-yht1wcsw-ansicht-filter-rueckweg-design.md` D5). Liegt in
 * `sessionStorage`, damit sie ein Neuladen übersteht; ohne Speicher (gehärteter Rechner) trägt
 * eine Map im Modul die Sitzung. Leser und Schreiber: `components/RollWiederherstellung.tsx`.
 */

const SCHLUESSEL = 'lfh:rolle';
/** Mehr Einträge braucht kein Zurück; die ältesten fallen heraus. */
export const ROLL_HOECHSTENS = 50;
/** So lange wartet die Wiederherstellung auf eine Seite, die hoch genug ist. */
export const ROLL_FRIST_MS = 2000;

/**
 * Deeplink-Parameter, mit denen eine Seite selbst ein Ziel ansteuert (`frontend/AGENTS.md`,
 * „Deeplink-Muster“); dann hält die Wiederherstellung still.
 */
const ZIEL_PARAMETER = [
  'meldung',
  'auftrag',
  'befehl',
  'eintrag',
  'erinnerung',
  'fahrzeug',
  'abschnitt',
  'gefahrengebiet',
  'personal',
  'einheit',
] as const;

let ersatz = new Map<string, number>();

function lies(): Map<string, number> {
  try {
    const roh = globalThis.sessionStorage?.getItem(SCHLUESSEL);
    if (roh == null) return ersatz;
    const liste: unknown = JSON.parse(roh);
    if (!Array.isArray(liste)) return ersatz;
    return new Map(
      liste.filter(
        (e): e is [string, number] =>
          Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number',
      ),
    );
  } catch {
    return ersatz;
  }
}

/** Merkt die Position; der jüngste Eintrag steht hinten. */
export function merkeRolle(key: string, y: number): void {
  const eintraege = lies();
  eintraege.delete(key);
  eintraege.set(key, y);
  while (eintraege.size > ROLL_HOECHSTENS) {
    const aeltester = eintraege.keys().next().value;
    if (aeltester === undefined) break;
    eintraege.delete(aeltester);
  }
  ersatz = eintraege;
  try {
    globalThis.sessionStorage?.setItem(SCHLUESSEL, JSON.stringify([...eintraege]));
  } catch {
    /* sessionStorage gesperrt: die Map trägt die Sitzung */
  }
}

export function liesRolle(key: string): number | undefined {
  return lies().get(key);
}

/** Räumer für `geraetRaeumen` (`offline/geraetRaeumung.ts`). */
export function rollGedaechtnisRaeumen(): void {
  ersatz = new Map();
  try {
    globalThis.sessionStorage?.removeItem(SCHLUESSEL);
  } catch {
    /* sessionStorage gesperrt — dann liegt dort auch nichts */
  }
}

/** Steuert die Adresse ein eigenes Ziel an (Deeplink), statt einer Rollposition zu folgen? */
export function traegtZiel(params: URLSearchParams): boolean {
  return ZIEL_PARAMETER.some((p) => params.has(p));
}
