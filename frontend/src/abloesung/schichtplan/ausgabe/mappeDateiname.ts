/**
 * Dateiname der Excel-Mappe eines Schichtplans (LLH-1557, design D4):
 * `schichtplan-<einsatz-oder-planung>-<JJJJ-MM-TT>.xlsx`, nur ASCII, Umlaute aufgelöst. Der Server
 * schickt keinen Dateinamen; der Tag ist der lokale des Geräts, wie bei den CSV-Exporten.
 */

const UMLAUTE: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
};

/** Höchstlänge des Namensteils: der ganze Dateiname bleibt unter 90 Zeichen. */
const NAME_MAX = 60;

/** „ÜBUNG – Sanitätsdienst Stadtfest“ → „uebung-sanitaetsdienst-stadtfest“. */
export function dateinamenTeil(text: string): string {
  const teil = text
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTE[c])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_MAX)
    .replace(/-+$/, '');
  return teil;
}

const zweistellig = (n: number) => String(n).padStart(2, '0');

export function mappeDateiname(bezeichnung: string, ersatz: string, jetzt = new Date()): string {
  const name = dateinamenTeil(bezeichnung) || ersatz;
  const tag = `${jetzt.getFullYear()}-${zweistellig(jetzt.getMonth() + 1)}-${zweistellig(jetzt.getDate())}`;
  return `schichtplan-${name}-${tag}.xlsx`;
}
