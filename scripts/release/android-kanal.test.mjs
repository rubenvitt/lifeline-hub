/**
 * Selbsttest der Update-Kanäle der Android-App (`android-kanal.mjs`, LLH-1989, Entwurf D9) —
 * läuft in Schritt 8 des Gates.
 *
 * Der Kanal entscheidet still, welche Version jede installierte App als nächstes lädt, und die
 * feste APK im Kanal, was ein QR-Code an der Wand installiert. Ein Rückschritt, eine Beta im
 * Alpha-Kanal oder eine stabile APK unter dem Alpha-Code fiele erst am Gerät auf.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  apkEntscheidung,
  apkErsetzen,
  entscheide as entscheideIn,
  kanaeleFuer,
  manifest as manifestFuer,
} from './android-kanal.mjs';

const SHA = 'a'.repeat(64);
const manifest = (version, version_code = 1000) => ({
  version,
  version_code,
  url: `https://github.com/rubenvitt/lifeline-hub/releases/download/v${version}/lifeline-hub-android-${version}.apk`,
  sha256: SHA,
});
const entscheide = (e) => entscheideIn({ kanal: 'android-alpha', ...e });

test('Kanäle je Version: Alpha nur Alpha, Beta nur Beta, stabil beide, fremde Vorabkennung keinen', () => {
  assert.deepEqual(kanaeleFuer('1.0.0-alpha.180'), ['android-alpha']);
  assert.deepEqual(kanaeleFuer('1.0.0-beta.3'), ['android-beta']);
  assert.deepEqual(kanaeleFuer('1.0.0'), ['android-alpha', 'android-beta']);
  assert.deepEqual(kanaeleFuer('1.0.0-rc.1'), []);
  assert.throws(() => kanaeleFuer('v1.0.0'), /Keine zulässige Version/);
});

test('die APK im Kanal ersetzt nur ein Tag desselben Kanals', () => {
  assert.equal(apkErsetzen('android-alpha', '1.0.0-alpha.181'), true);
  assert.equal(apkErsetzen('android-beta', '1.0.0-beta.4'), true);
  assert.equal(apkErsetzen('android-alpha', '1.0.0-beta.4'), false);
  assert.equal(apkErsetzen('android-beta', '1.0.0-alpha.181'), false);
  assert.equal(apkErsetzen('android-beta', '1.0.0-rc.1'), false);
});

test('stabil ersetzt die APK im Alpha-Kanal nicht', () => {
  // Wer nach einem stabilen Release über den Alpha-Code installiert, bekommt die letzte Alpha,
  // legt damit den Kanal `alpha` fest und wird danach über das Manifest gehoben (Entwurf D9).
  assert.equal(apkErsetzen('android-alpha', '1.0.0'), false);
  assert.equal(apkErsetzen('android-beta', '1.0.0'), false);
});

test('APK-Entscheidung: unbekannter Kanal und kaputte Version brechen ab', () => {
  assert.throws(() => apkErsetzen('desktop-alpha', '1.0.0-alpha.1'), /Unbekannter Kanal/);
  assert.throws(() => apkErsetzen('android-alpha', 'v1.0.0-alpha.1'), /Keine zulässige Version/);
});

test('feste APK nur vorwärts: ein Tag des Kanals, der den Kanal fortschreibt', () => {
  const apk = (kanal, neu, alt) => apkEntscheidung({ kanal, neu: manifest(neu), alt: alt && manifest(alt) }).ersetzen;
  assert.equal(apk('android-alpha', '1.0.0-alpha.131', '1.0.0-alpha.130'), true);
  assert.equal(apk('android-alpha', '1.0.0-alpha.1', null), true);
  assert.equal(apk('android-beta', '1.0.0-beta.2', '1.0.0-beta.1'), true);
  // Stabil schreibt das Manifest fort, die APK bleibt die des Kanals.
  assert.equal(apk('android-alpha', '1.0.0', '1.0.0-alpha.140'), false);
  assert.equal(apk('android-beta', '1.0.0-alpha.141', null), false);
});

test('Handstart eines älteren Tags ersetzt die feste APK nicht', () => {
  const e = apkEntscheidung({ kanal: 'android-alpha', neu: manifest('1.0.0-alpha.129', 9000), alt: manifest('1.0.0-alpha.130') });
  assert.equal(e.ersetzen, false);
  assert.match(e.grund, /nicht neuer/);
  // Derselbe Stand noch einmal (Nachbau) ebenso wenig.
  assert.equal(
    apkEntscheidung({ kanal: 'android-alpha', neu: manifest('1.0.0-alpha.130', 9000), alt: manifest('1.0.0-alpha.130') }).ersetzen,
    false,
  );
  // Eine Alpha hinter einem stabilen Stand im Kanal ist nicht neuer: die APK bleibt.
  assert.equal(apkEntscheidung({ kanal: 'android-alpha', neu: manifest('1.0.0-alpha.141'), alt: manifest('1.0.0') }).ersetzen, false);
});

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

test('älteres Release dreht den Kanal nicht zurück', () => {
  // Überholter Lauf oder Handstart eines älteren Tags: auch mit dem größeren `version_code` des
  // späteren Baus bleibt der Kanal stehen.
  assert.equal(entscheide({ neu: manifest('1.0.0-alpha.129', 9000), alt: manifest('1.0.0-alpha.130') }).entscheidung, 'behalten');
  assert.equal(entscheide({ neu: manifest('1.0.0-alpha.130', 9000), alt: manifest('1.0.0-alpha.130') }).entscheidung, 'behalten');
});

test('stabiles Release schreibt beide Kanäle fort, ältere Vorabversion danach nicht', () => {
  assert.equal(entscheide({ neu: manifest('1.0.0'), alt: manifest('1.0.0-alpha.140') }).entscheidung, 'hochladen');
  assert.equal(
    entscheideIn({ kanal: 'android-beta', neu: manifest('1.0.0'), alt: manifest('1.0.0-beta.4') }).entscheidung,
    'hochladen',
  );
  assert.equal(entscheide({ neu: manifest('1.0.0-alpha.141'), alt: manifest('1.0.0') }).entscheidung, 'behalten');
  assert.equal(entscheide({ neu: manifest('1.1.0-alpha.1'), alt: manifest('1.0.0') }).entscheidung, 'hochladen');
});

test('Fremdkanal: eine Beta schreibt nie in den Alpha-Kanal, eine Alpha nie in den Beta-Kanal', () => {
  const inAlpha = entscheide({ neu: manifest('1.0.0-beta.1'), alt: manifest('1.0.0-alpha.180') });
  assert.equal(inAlpha.entscheidung, 'behalten');
  assert.match(inAlpha.grund, /gehört nicht in android-alpha/);
  const inBeta = entscheideIn({ kanal: 'android-beta', neu: manifest('1.0.0-alpha.181'), alt: null });
  assert.equal(inBeta.entscheidung, 'behalten');
});

test('kaputtes Manifest bricht ab', () => {
  assert.throws(() => entscheide({ neu: manifest('v1.0.0'), alt: null }), /neu: keine zulässige Version/);
  assert.throws(() => entscheide({ neu: manifest('1.0.0', 0), alt: null }), /neu: version_code/);
  assert.throws(() => entscheide({ neu: manifest('1.0.0', '12'), alt: null }), /neu: version_code/);
  assert.throws(() => entscheide({ neu: { ...manifest('1.0.0'), sha256: 'xyz' }, alt: null }), /neu: sha256/);
  assert.throws(
    () => entscheide({ neu: { ...manifest('1.0.0'), url: 'https://example.org/a.apk' }, alt: null }),
    /neu: url/,
  );
  assert.throws(() => entscheide({ neu: manifest('1.0.1'), alt: { version_code: 1 } }), /Kanal: keine zulässige Version/);
});

test('unbekannter Kanal bricht ab', () => {
  assert.throws(() => entscheideIn({ kanal: 'desktop-alpha', neu: manifest('1.0.0'), alt: null }), /Unbekannter Kanal/);
});

test('Manifest zeigt auf die APK des versionierten Release', () => {
  const m = manifestFuer({ version: '1.2.0-beta.3', versionCode: 471234, sha256: SHA, repo: 'rubenvitt/lifeline-hub' });
  assert.deepEqual(m, {
    version: '1.2.0-beta.3',
    version_code: 471234,
    url: 'https://github.com/rubenvitt/lifeline-hub/releases/download/v1.2.0-beta.3/lifeline-hub-android-1.2.0-beta.3.apk',
    sha256: SHA,
  });
  // Was hier entsteht, nimmt die Entscheidung an.
  assert.equal(entscheideIn({ kanal: 'android-beta', neu: m, alt: null }).entscheidung, 'hochladen');
});

test('Manifest: kaputte Eingaben brechen ab', () => {
  const gut = { version: '1.0.0', versionCode: 5, sha256: SHA, repo: 'rubenvitt/lifeline-hub' };
  assert.throws(() => manifestFuer({ ...gut, versionCode: '5' }), /version_code/);
  assert.throws(() => manifestFuer({ ...gut, versionCode: 2 ** 31 }), /version_code/);
  assert.throws(() => manifestFuer({ ...gut, sha256: SHA.toUpperCase() }), /sha256/);
  assert.throws(() => manifestFuer({ ...gut, repo: 'nur-ein-teil' }), /Repository/);
  assert.throws(() => manifestFuer({ ...gut, version: '1.0' }), /Keine zulässige Version/);
});
