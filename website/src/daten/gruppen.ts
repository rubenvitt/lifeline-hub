/**
 * Lesergruppen der Anwenderdokumentation.
 *
 * KOPIE aus `frontend/src/hilfe/gruppen.ts` (LFH-1096): Schlüssel und Namen wörtlich, Reihenfolge
 * wie dort. Eine neue oder umbenannte Gruppe zieht hier nach (website/AGENTS.md).
 */
export const GRUPPEN = [
  { key: 'alle', name: 'Alle' },
  { key: 'fuehrung', name: 'Führung' },
  { key: 'administration', name: 'Administration' },
  { key: 'geraete', name: 'Gekoppelte Geräte' },
] as const;

export type Gruppe = (typeof GRUPPEN)[number]['key'];
