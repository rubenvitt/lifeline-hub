/**
 * Selbsttest des Lauf-Verzeichnisses der Playwright-Läufe (`frontend/e2e/run-dir.ts`, LLH-1666,
 * Spec `e2e-lauf-aufraeumen`) — läuft in Schritt 11 des Gates.
 *
 * Ein Lauf legt DB und `karten/` in ein Temp-Verzeichnis. Auf einem dauerhaften Rechner (eigener
 * CI-Runner, Laptop) füllt jedes vergessene Verzeichnis die Platte; ein zu eifriges Aufräumen
 * dagegen zöge einem parallelen Lauf die Datenbank weg. Geprüft wird beides.
 *
 * Liegt unter `scripts/`, nicht neben dem Modul: im Projekt `chromium` ohne Anteil greift
 * Playwrights Standard-Muster, und das nähme eine `*.test.ts` unter `e2e/` als Spec.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRunDir } from '../frontend/e2e/run-dir.ts';

const MODUL = fileURLToPath(new URL('../frontend/e2e/run-dir.ts', import.meta.url));

const STUNDE = 60 * 60 * 1000;

function sandbox() {
  return mkdtempSync(join(tmpdir(), 'run-dir-test-'));
}

/** Legt ein Verzeichnis mit Inhalt an und setzt seine Änderungszeit `alterMs` zurück. */
function altesVerzeichnis(basis, name, alterMs) {
  const pfad = join(basis, name);
  mkdirSync(join(pfad, 'karten'), { recursive: true });
  writeFileSync(join(pfad, 'lifeline.db'), 'x');
  const zeit = new Date(Date.now() - alterMs);
  utimesSync(pfad, zeit, zeit);
  return pfad;
}

/** Fängt `console.warn` für die Dauer von `fn` ab. */
function mitWarnungen(fn) {
  const warnungen = [];
  const original = console.warn;
  console.warn = (...args) => warnungen.push(args.join(' '));
  try {
    return { ergebnis: fn(), warnungen };
  } finally {
    console.warn = original;
  }
}

test('legt ein neues Verzeichnis mit dem Präfix an', () => {
  const basis = sandbox();
  const pfad = createRunDir('lifeline-e2e-', { baseDir: basis });
  assert.ok(existsSync(pfad));
  assert.equal(dirname(pfad), basis);
  assert.match(pfad, /lifeline-e2e-[^/]+$/);
  rmSync(basis, { recursive: true, force: true });
});

test('räumt verwaiste Verzeichnisse desselben Präfixes ab, die älter als 24 h sind', () => {
  const basis = sandbox();
  const alt = altesVerzeichnis(basis, 'lifeline-e2e-alt', 48 * STUNDE);
  createRunDir('lifeline-e2e-', { baseDir: basis });
  assert.equal(existsSync(alt), false);
  rmSync(basis, { recursive: true, force: true });
});

test('lässt jüngere Verzeichnisse stehen: ein paralleler Lauf benutzt sie', () => {
  const basis = sandbox();
  const parallel = altesVerzeichnis(basis, 'lifeline-e2e-parallel', 10 * 60 * 1000);
  const knapp = altesVerzeichnis(basis, 'lifeline-e2e-knapp', 23 * STUNDE);
  createRunDir('lifeline-e2e-', { baseDir: basis });
  assert.ok(existsSync(join(parallel, 'lifeline.db')));
  assert.ok(existsSync(knapp));
  rmSync(basis, { recursive: true, force: true });
});

test('fasst nur das eigene Präfix an, auch bei alten fremden Verzeichnissen', () => {
  const basis = sandbox();
  const doku = altesVerzeichnis(basis, 'lifeline-doku-alt', 48 * STUNDE);
  const fremd = altesVerzeichnis(basis, 'anderes-werkzeug', 48 * STUNDE);
  createRunDir('lifeline-e2e-', { baseDir: basis });
  assert.ok(existsSync(doku));
  assert.ok(existsSync(fremd));
  rmSync(basis, { recursive: true, force: true });
});

test('ein nicht löschbares altes Verzeichnis lässt den Lauf nicht scheitern, nur warnen', (t) => {
  if (process.getuid?.() === 0) {
    t.skip('als root greift der Schreibschutz nicht');
    return;
  }
  const basis = sandbox();
  const gesperrt = altesVerzeichnis(basis, 'lifeline-e2e-gesperrt', 48 * STUNDE);
  chmodSync(gesperrt, 0o500);
  const { ergebnis, warnungen } = mitWarnungen(() =>
    createRunDir('lifeline-e2e-', { baseDir: basis }),
  );
  assert.ok(existsSync(ergebnis));
  assert.equal(warnungen.length, 1);
  assert.match(warnungen[0], /lifeline-e2e-gesperrt/);
  chmodSync(gesperrt, 0o700);
  rmSync(basis, { recursive: true, force: true });
});

test('ein Fehler beim Löschen wird zur Warnung (Fehlerpfad ohne Schreibschutz)', () => {
  const basis = sandbox();
  altesVerzeichnis(basis, 'lifeline-e2e-kaputt', 48 * STUNDE);
  const { ergebnis, warnungen } = mitWarnungen(() =>
    createRunDir('lifeline-e2e-', {
      baseDir: basis,
      remove: () => {
        throw new Error('EACCES');
      },
    }),
  );
  assert.ok(existsSync(ergebnis));
  assert.equal(warnungen.length, 1);
  assert.match(warnungen[0], /lifeline-e2e-kaputt.*EACCES/);
  rmSync(basis, { recursive: true, force: true });
});

/**
 * Startet einen Node-Prozess, der wie die Playwright-Config ein Lauf-Verzeichnis anlegt und dann
 * auf `ende` endet; liefert den Pfad. Das Löschen beim Beenden lässt sich nur am Prozessende
 * prüfen, also in einem eigenen Prozess.
 */
function prozessMitLaufVerzeichnis(basis, ende) {
  const code = `
    import { createRunDir } from ${JSON.stringify(MODUL)};
    const pfad = createRunDir('lifeline-e2e-', { baseDir: ${JSON.stringify(basis)}, deleteOnExit: true });
    console.log(pfad);
    ${ende}
  `;
  const lauf = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  return { pfad: lauf.stdout.trim().split('\n')[0], status: lauf.status };
}

test('deleteOnExit: ein normal endender Lauf hinterlässt sein Verzeichnis nicht', () => {
  const basis = sandbox();
  const { pfad, status } = prozessMitLaufVerzeichnis(
    basis,
    `import { writeFileSync, mkdirSync } from 'node:fs';
     mkdirSync(pfad + '/karten'); writeFileSync(pfad + '/lifeline.db', 'x');`,
  );
  assert.equal(status, 0);
  assert.match(pfad, /lifeline-e2e-/);
  assert.equal(existsSync(pfad), false);
  rmSync(basis, { recursive: true, force: true });
});

test('deleteOnExit: auch ein roter Lauf (Exit 1) räumt', () => {
  const basis = sandbox();
  const { pfad, status } = prozessMitLaufVerzeichnis(basis, 'process.exitCode = 1;');
  assert.equal(status, 1);
  assert.equal(existsSync(pfad), false);
  rmSync(basis, { recursive: true, force: true });
});

test('deleteOnExit: auch ein Abbruch vor den Tests (Webserver startet nicht, Fehler in der Config)', () => {
  const basis = sandbox();
  const geworfen = prozessMitLaufVerzeichnis(basis, "throw new Error('Webserver startet nicht');");
  assert.notEqual(geworfen.status, 0);
  assert.equal(existsSync(geworfen.pfad), false);
  const beendet = prozessMitLaufVerzeichnis(basis, 'process.exit(1);');
  assert.equal(existsSync(beendet.pfad), false);
  rmSync(basis, { recursive: true, force: true });
});

test('deleteOnExit: ein Verzeichnis, das ein anderer Lauf angelegt hat, bleibt', () => {
  const basis = sandbox();
  const fremd = createRunDir('lifeline-e2e-', { baseDir: basis });
  prozessMitLaufVerzeichnis(basis, '');
  assert.ok(existsSync(fremd));
  rmSync(basis, { recursive: true, force: true });
});

test('ohne deleteOnExit bleibt das Verzeichnis nach dem Prozessende stehen', () => {
  const basis = sandbox();
  const code = `
    import { createRunDir } from ${JSON.stringify(MODUL)};
    console.log(createRunDir('lifeline-e2e-', { baseDir: ${JSON.stringify(basis)} }));
  `;
  const lauf = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.ok(existsSync(lauf.stdout.trim()));
  rmSync(basis, { recursive: true, force: true });
});

test('ohne baseDir gilt das Temp-Verzeichnis des Systems', () => {
  const pfad = createRunDir('lifeline-run-dir-test-');
  assert.equal(dirname(pfad), tmpdir());
  rmSync(pfad, { recursive: true, force: true });
});
