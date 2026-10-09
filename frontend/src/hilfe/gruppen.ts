/**
 * Lesergruppen der Anwenderdokumentation (LFH-1096). Eigenes Modul ohne die Kapiteltexte, damit
 * Adressen und Menüs es laden können, ohne die Hilfe in den Haupt-Chunk zu ziehen.
 *
 * Eine Gruppe ist ein Filter, kein Recht: jede Person sieht jedes Kapitel. Kopie für die Website:
 * `website/src/daten/gruppen.ts` (website/AGENTS.md, „Kopien statt zweiter Quelle“).
 */
export const GRUPPEN = [
  { key: 'alle', name: 'Alle' },
  { key: 'fuehrung', name: 'Führung' },
  { key: 'administration', name: 'Administration' },
  { key: 'geraete', name: 'Gekoppelte Geräte' },
] as const;

export type Gruppe = (typeof GRUPPEN)[number]['key'];

export function istGruppe(wert: string): wert is Gruppe {
  return GRUPPEN.some((g) => g.key === wert);
}

export function gruppenName(gruppe: Gruppe): string {
  return GRUPPEN.find((g) => g.key === gruppe)!.name;
}
