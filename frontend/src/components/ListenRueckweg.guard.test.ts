import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Ortspfad zur Liste über `ListenRueckweg` (LLH-1997, `frontend/AGENTS.md`, Deeplink-Muster).
 *
 * Der Wächter scannt QUELLTEXT nach Ortspfad-Gliedern (`title:` eines Breadcrumb-Eintrags, auch
 * `pfad` von `AdminPage`), die ein nackter `<Link to=…>` sind. Erlaubt bleiben die Glieder
 * „Einsätze“ und der Einsatz selbst: sie sind keine Rückwege auf die Seite, von der man kam.
 *
 * Was er NICHT sieht (Teil des Vertrags):
 *  - Glieder, die als Variable gebaut und erst später in `items` gesteckt werden
 *  - Test-Dateien
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `title: <Link to=…` oder `title: (` mit `<Link to=…` in der nächsten Zeile. */
const GLIED = /title:\s*\(?\s*<Link\s+to=\{?([^\n]+)/g;
/** Die beiden Glieder, die kein Rückweg sind. */
const ERLAUBT = [/^"\/einsaetze"/, /^einsaetzePfad\(\)/, /^einsatzPfad\(/];

function dateien(pfad: string): string[] {
  return readdirSync(pfad).flatMap((eintrag) => {
    const voll = join(pfad, eintrag);
    if (statSync(voll).isDirectory()) return dateien(voll);
    if (!/\.tsx$/.test(eintrag) || /\.test\.tsx$/.test(eintrag)) return [];
    return [voll];
  });
}

export function findeNackteGlieder(quelle: string): string[] {
  return [...quelle.matchAll(GLIED)]
    .map((m) => m[1].trim().slice(0, 60))
    .filter((ziel) => !ERLAUBT.some((r) => r.test(ziel)));
}

describe('Ortspfad zur Liste', () => {
  it('erkennt ein nacktes Glied, auch über zwei Zeilen, und lässt Einsätze und Einsatz durch', () => {
    expect(findeNackteGlieder('{ title: <Link to={listenPfad}>Liste</Link> }')).toEqual([
      'listenPfad}>Liste</Link> }',
    ]);
    expect(findeNackteGlieder('title: (\n  <Link to={personalPfad(id, { personal: 1 })}>')).toEqual(
      ['personalPfad(id, { personal: 1 })}>'],
    );
    expect(findeNackteGlieder('{ title: <Link to="/einsaetze">Einsätze</Link> }')).toEqual([]);
    expect(findeNackteGlieder('{ title: <Link to={einsatzPfad(einsatzId)}>E</Link> }')).toEqual([]);
    expect(findeNackteGlieder('{ title: <ListenRueckweg to={x}>L</ListenRueckweg> }')).toEqual([]);
  });

  it('führt jedes Ortspfad-Glied auf eine Liste über ListenRueckweg', () => {
    const treffer = dateien(SRC).flatMap((datei) =>
      findeNackteGlieder(readFileSync(datei, 'utf8')).map(
        (ziel) => `${relative(SRC, datei)}: ${ziel}`,
      ),
    );
    expect(treffer).toEqual([]);
  });
});
