/**
 * Bereiche der Anwenderdokumentation (LFH-1096, `docs/anwender/README.md`). Jeder Bereich hat
 * einen Hunderterblock der `reihenfolge` (Einstieg 0–99, Führungsmittel 100–199 …), daraus
 * ergibt sich die Gruppierung der Navigation und der Übersicht.
 *
 * Eigenes Modul ohne Kapiteltexte, wie `gruppen.ts`. KOPIE für die Website:
 * `website/src/daten/bereiche.ts` (website/AGENTS.md, „Kopien statt zweiter Quelle“).
 */
export const BEREICHE = [
  'Einstieg',
  'Führungsmittel',
  'Lage',
  'Kräfte',
  'Stab',
  'Betroffene',
  'Einstellungen und Verwaltung',
  'Gekoppelte Geräte',
] as const;

/** Name des Bereichs, zu dem eine `reihenfolge` gehört. */
export function bereichVon(reihenfolge: number): string {
  return BEREICHE[Math.floor(reihenfolge / 100)] ?? 'Sonstige';
}

/**
 * Kurztext für Karten: der erste Absatz des Abschnitts „Überblick“, ohne Markdown-Auszeichnung.
 * Ein Absatz ist eine Zeile, die auf eine Leerzeile folgt; mehr als einen Absatz zeigt die
 * Karte nicht.
 */
export function kurztext(text: string): string {
  const m = /(?:^|\n)## Überblick\n+([\s\S]*?)(?:\n\s*\n|$)/.exec(text);
  if (!m) return '';
  return m[1]
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
