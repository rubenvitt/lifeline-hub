/**
 * Selbsttest des gleitenden Abbild-Tags (`abbild-kanal.mjs`, LLH-1545) — läuft in Schritt 8 des
 * Gates. Ein `:beta`, das auf eine ältere Beta zurückspringt, fiele erst beim Tester auf.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { abbildTag } from './abbild-kanal.mjs';

test('stabil → latest, Alpha → alpha, Beta → beta', () => {
  assert.equal(abbildTag({ tag: 'v1.0.0', veroeffentlicht: ['v1.0.0'] }), 'latest');
  assert.equal(abbildTag({ tag: 'v1.0.0-alpha.180', veroeffentlicht: [] }), 'alpha');
  assert.equal(abbildTag({ tag: 'v1.0.0-beta.2', veroeffentlicht: ['v1.0.0-beta.1'] }), 'beta');
});

test('andere Vorabkennung: kein Tag', () => {
  assert.equal(abbildTag({ tag: 'v1.0.0-rc.1', veroeffentlicht: [] }), null);
});

test('ein neueres veröffentlichtes Release im selben Kanal: kein Tag (nur vorwärts)', () => {
  assert.equal(abbildTag({ tag: 'v1.0.0-alpha.99', veroeffentlicht: ['v1.0.0-alpha.100'] }), null);
  assert.equal(abbildTag({ tag: 'v1.0.0', veroeffentlicht: ['v1.0.1'] }), null);
});

test('Kanäle zählen parallel: eine Beta hält Alpha nicht auf und umgekehrt', () => {
  // Nach SemVer ist 1.0.0-beta.1 „neuer“ als 1.0.0-alpha.181 — für :alpha zählt das nicht.
  assert.equal(abbildTag({ tag: 'v1.0.0-alpha.181', veroeffentlicht: ['v1.0.0-beta.1'] }), 'alpha');
  assert.equal(abbildTag({ tag: 'v1.0.0-beta.1', veroeffentlicht: ['v1.1.0-alpha.1'] }), 'beta');
  // Ein stabiles Release hält keinen Vorabkanal auf.
  assert.equal(abbildTag({ tag: 'v1.0.0-beta.3', veroeffentlicht: ['v1.0.0'] }), 'beta');
});

test('Leerzeilen und Fremdes in der Liste stören nicht, kaputter Tag bricht ab', () => {
  assert.equal(abbildTag({ tag: 'v1.0.0-beta.2', veroeffentlicht: ['', 'desktop-beta', 'v1.0.0-beta.1'] }), 'beta');
  assert.throws(() => abbildTag({ tag: '1.0.0', veroeffentlicht: [] }), /Kein zulässiger Release-Tag/);
});
