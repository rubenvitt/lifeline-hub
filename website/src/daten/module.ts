/**
 * Die Module der Anwendung, wie sie Modulmenü und Sprungpalette zeigen.
 *
 * KOPIE aus `frontend/src/einsatz/modulRegistry.ts` in `module.json`: Bereich
 * (`Kategorie.label`), Name (`label`) und zweite Zeile (`beschreibung`) wörtlich, Reihenfolge wie
 * dort, nur Module mit Status `fertig`, ohne die Kategorie „Einstellungen“ am Fuß der Rail. Ein
 * neues oder umbenanntes Modul zieht dort nach (website/AGENTS.md); der Wächter
 * `frontend/src/einsatz/websiteModule.guard.test.ts` schlägt an, sobald beide auseinanderlaufen.
 * JSON statt TypeScript, damit der Wächter die Datei ohne die Abhängigkeiten der Website liest:
 * eine `.ts`-Datei hier übersetzte Vitest mit `website/tsconfig.json`, und deren Basis
 * `astro/tsconfigs/strict` gibt es ohne `website/node_modules` nicht (LLH-1378).
 */

import daten from './module.json';

export interface Modul {
  name: string;
  beschreibung: string;
}

export interface Bereich {
  name: string;
  module: Modul[];
}

export const bereiche: Bereich[] = daten;

export const modulAnzahl = bereiche.reduce((summe, b) => summe + b.module.length, 0);
