/**
 * Selbsttest des Alpha-Kanals der Desktop-Hülle (`desktop-kanal.mjs`, LLH-1280) — läuft in
 * Schritt 8 des Gates.
 *
 * Der Kanal entscheidet still, welche Version jede Alpha-Hülle als nächstes angeboten bekommt.
 * Ein Rückschritt (überholter Lauf, Nachbau) oder ein Manifest ohne die eigene Plattform fiele
 * erst auf, wenn jemand die Versionsnummer liest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { entscheide } from './desktop-kanal.mjs';

const BEIDE = { 'darwin-aarch64': {}, 'windows-x86_64': {} };
const manifest = (version, platforms = BEIDE) => ({ version, platforms });

test('leerer Kanal: hochladen', () => {
  assert.equal(entscheide({ neu: manifest('1.0.0-alpha.130'), alt: null }).entscheidung, 'hochladen');
});

test('nächste Alpha: hochladen', () => {
  const e = entscheide({ neu: manifest('1.0.0-alpha.131'), alt: manifest('1.0.0-alpha.130') });
  assert.equal(e.entscheidung, 'hochladen');
  assert.match(e.grund, /alpha\.130 → 1\.0\.0-alpha\.131/);
});

test('Nummern numerisch: alpha.100 ist neuer als alpha.99', () => {
  assert.equal(entscheide({ neu: manifest('1.0.0-alpha.100'), alt: manifest('1.0.0-alpha.99') }).entscheidung, 'hochladen');
});

test('überholter Lauf oder Nachbau: behalten', () => {
  assert.equal(entscheide({ neu: manifest('1.0.0-alpha.129'), alt: manifest('1.0.0-alpha.130') }).entscheidung, 'behalten');
  assert.equal(entscheide({ neu: manifest('1.0.0-alpha.130'), alt: manifest('1.0.0-alpha.130') }).entscheidung, 'behalten');
});

test('stabiles Release schreibt den Kanal fort, ältere Alpha danach nicht', () => {
  assert.equal(entscheide({ neu: manifest('1.0.0'), alt: manifest('1.0.0-alpha.140') }).entscheidung, 'hochladen');
  assert.equal(entscheide({ neu: manifest('1.0.0-alpha.141'), alt: manifest('1.0.0') }).entscheidung, 'behalten');
  assert.equal(entscheide({ neu: manifest('1.1.0-alpha.1'), alt: manifest('1.0.0') }).entscheidung, 'hochladen');
});

test('fehlt eine Plattform, die der Kanal trägt: behalten', () => {
  const e = entscheide({
    neu: manifest('1.0.0-alpha.131', { 'windows-x86_64': {} }),
    alt: manifest('1.0.0-alpha.130'),
  });
  assert.equal(e.entscheidung, 'behalten');
  assert.match(e.grund, /darwin-aarch64/);
});

test('neue Plattform darf dazukommen', () => {
  const e = entscheide({
    neu: manifest('1.0.0-alpha.131'),
    alt: manifest('1.0.0-alpha.130', { 'windows-x86_64': {} }),
  });
  assert.equal(e.entscheidung, 'hochladen');
});

test('kaputtes Manifest bricht ab', () => {
  assert.throws(() => entscheide({ neu: manifest('v1.0.0'), alt: null }), /neu: keine zulässige Version/);
  assert.throws(() => entscheide({ neu: manifest('1.0.0', {}), alt: null }), /ohne Plattform/);
  assert.throws(() => entscheide({ neu: manifest('1.0.1'), alt: { platforms: BEIDE } }), /Kanal: keine/);
});
