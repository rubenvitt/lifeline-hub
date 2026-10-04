import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Kein Inline-Template-Literal für Einsatzpfade (Spec `deeplink-quelle`, `frontend/AGENTS.md`,
 * Deeplink-Muster).
 *
 * Der Guard scannt QUELLTEXT: ein geänderter Pfad bricht nichts sichtbar, er führt bloß
 * woanders hin. Er gilt für ganz `src/`, seit LFH-797 die letzten fünf Inline-Pfade auf die
 * Builder umgestellt hat; vorher war er auf den Navigationsrahmen (`einsatz/`,
 * `command-palette/`) gescopt.
 *
 * Was er NICHT sieht (Teil des Vertrags):
 *  - Pfade, die über eine Variable zusammengesetzt werden (`const p = '/einsaetze/' + id`)
 *  - die Deeplink-Quelle selbst (`routing/deeplinks.ts`, dort entstehen die Pfade)
 *  - Test-Dateien (dort sind Literale die ehrlichere Erwartung)
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUELLE = join(SRC, 'routing', 'deeplinks.ts');
/**
 * Eine Frontend-Route steht am Anfang des Literals. `/api/einsaetze/${…}` und
 * `${BASIS}/einsaetze/${…}` (API-Clients) sind Server-Pfade und bleiben außen vor.
 */
const VERBOTEN = /`\/einsaetze\/\$\{/;

function dateien(pfad: string): string[] {
  return readdirSync(pfad).flatMap((eintrag) => {
    const voll = join(pfad, eintrag);
    if (statSync(voll).isDirectory()) return dateien(voll);
    if (!/\.tsx?$/.test(eintrag) || /\.test\.tsx?$/.test(eintrag)) return [];
    if (voll === QUELLE) return [];
    return [voll];
  });
}

describe('Einsatzpfade', () => {
  it('baut keinen Pfad als Inline-Template-Literal außerhalb von routing/deeplinks.ts', () => {
    const treffer = dateien(SRC)
      .filter((datei) => VERBOTEN.test(readFileSync(datei, 'utf8')))
      .map((datei) => relative(SRC, datei));
    expect(treffer, 'Builder aus routing/deeplinks.ts benutzen').toEqual([]);
  });
});
