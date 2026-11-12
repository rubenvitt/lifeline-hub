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
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createRunDir, deleteRunDir } from '../frontend/e2e/run-dir.ts';

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

test('deleteRunDir löscht das Verzeichnis zum DB-Pfad aus der Lauf-Variablen samt Inhalt', () => {
  const basis = sandbox();
  const pfad = createRunDir('lifeline-e2e-', { baseDir: basis });
  mkdirSync(join(pfad, 'karten'));
  writeFileSync(join(pfad, 'lifeline.db'), 'x');
  writeFileSync(join(pfad, 'lifeline.db-wal'), 'x');
  process.env.TEST_LAUF = JSON.stringify({ datenbank: join(pfad, 'lifeline.db') });
  deleteRunDir('TEST_LAUF', { baseDir: basis });
  assert.equal(existsSync(pfad), false);
  delete process.env.TEST_LAUF;
  rmSync(basis, { recursive: true, force: true });
});

test('deleteRunDir ohne Lauf-Variable tut nichts und wirft nicht', () => {
  delete process.env.TEST_LAUF;
  assert.doesNotThrow(() => deleteRunDir('TEST_LAUF'));
});

test('deleteRunDir löscht nichts außerhalb des Temp-Verzeichnisses', () => {
  const basis = sandbox();
  const anderswo = sandbox();
  writeFileSync(join(anderswo, 'lifeline.db'), 'x');
  process.env.TEST_LAUF = JSON.stringify({ datenbank: join(anderswo, 'lifeline.db') });
  const { warnungen } = mitWarnungen(() => deleteRunDir('TEST_LAUF', { baseDir: basis }));
  assert.ok(existsSync(join(anderswo, 'lifeline.db')));
  assert.equal(warnungen.length, 1);
  delete process.env.TEST_LAUF;
  rmSync(basis, { recursive: true, force: true });
  rmSync(anderswo, { recursive: true, force: true });
});

test('ohne baseDir gilt das Temp-Verzeichnis des Systems', () => {
  const pfad = createRunDir('lifeline-run-dir-test-');
  assert.equal(dirname(pfad), tmpdir());
  process.env.TEST_LAUF = JSON.stringify({ datenbank: join(pfad, 'lifeline.db') });
  deleteRunDir('TEST_LAUF');
  assert.equal(existsSync(pfad), false);
  assert.equal(
    readdirSync(tmpdir()).some((n) => n === pfad.split('/').pop()),
    false,
  );
  delete process.env.TEST_LAUF;
});
