/**
 * Selbsttest der Vorabkanäle der Desktop-Hülle (`desktop-kanal.mjs`, LLH-1280, LLH-1545) — läuft
 * in Schritt 8 des Gates.
 *
 * Der Kanal entscheidet still, welche Version jede Vorab-Hülle als nächstes angeboten bekommt.
 * Ein Rückschritt (überholter Lauf, Nachbau) oder ein Manifest ohne die eigene Plattform fiele
 * erst auf, wenn jemand die Versionsnummer liest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { entscheide as entscheideIn, kanaeleFuer } from './desktop-kanal.mjs';

const BEIDE = { 'darwin-aarch64': {}, 'windows-x86_64': {} };
const manifest = (version, platforms = BEIDE) => ({ version, platforms });
// Die bisherigen Fälle gelten für den Alpha-Kanal; die Beta-Fälle stehen unten.
const entscheide = (e) => entscheideIn({ kanal: 'desktop-alpha', ...e });

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

test('Kanäle je Version: Alpha, Beta, stabil in beide, fremde Vorabkennung in keinen', () => {
  assert.deepEqual(kanaeleFuer('1.0.0-alpha.180'), ['desktop-alpha']);
  assert.deepEqual(kanaeleFuer('1.0.0-beta.3'), ['desktop-beta']);
  assert.deepEqual(kanaeleFuer('1.0.0'), ['desktop-alpha', 'desktop-beta']);
  assert.deepEqual(kanaeleFuer('1.0.0-rc.1'), []);
  assert.throws(() => kanaeleFuer('v1.0.0'), /Keine zulässige Version/);
});

test('Beta-Kanal: nächste Beta hochladen, überholte behalten', () => {
  const beta = (neu, alt) => entscheideIn({ kanal: 'desktop-beta', neu: manifest(neu), alt: alt && manifest(alt) });
  assert.equal(beta('1.0.0-beta.1', null).entscheidung, 'hochladen');
  assert.equal(beta('1.0.0-beta.2', '1.0.0-beta.1').entscheidung, 'hochladen');
  assert.equal(beta('1.0.0-beta.1', '1.0.0-beta.2').entscheidung, 'behalten');
  assert.equal(beta('1.0.0', '1.0.0-beta.4').entscheidung, 'hochladen');
});

test('Fremdkanal: eine Beta schreibt nie in den Alpha-Kanal, eine Alpha nie in den Beta-Kanal', () => {
  // Ohne diese Sperre sprängen alle Alpha-Hüllen auf 1.0.0-beta.1 (nach SemVer neuer als jede
  // 1.0.0-alpha.N), und jede weitere Alpha würde danach als „nicht neuer“ verworfen.
  const inAlpha = entscheideIn({ kanal: 'desktop-alpha', neu: manifest('1.0.0-beta.1'), alt: manifest('1.0.0-alpha.180') });
  assert.equal(inAlpha.entscheidung, 'behalten');
  assert.match(inAlpha.grund, /gehört nicht in desktop-alpha/);
  const inBeta = entscheideIn({ kanal: 'desktop-beta', neu: manifest('1.0.0-alpha.181'), alt: null });
  assert.equal(inBeta.entscheidung, 'behalten');
});

test('Alpha zählt nach der ersten Beta im eigenen Kanal weiter', () => {
  assert.equal(entscheide({ neu: manifest('1.0.0-alpha.181'), alt: manifest('1.0.0-alpha.180') }).entscheidung, 'hochladen');
});

test('unbekannter Kanal bricht ab', () => {
  assert.throws(() => entscheideIn({ kanal: 'desktop-rc', neu: manifest('1.0.0'), alt: null }), /Unbekannter Kanal/);
});
