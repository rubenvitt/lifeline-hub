/**
 * Selbsttest des Update-Manifests der Desktop-Hülle (`desktop-manifest.mjs`, LFH-721) — läuft in
 * Schritt 8 des Gates.
 *
 * Das Manifest `latest.json` entscheidet, was jede installierte Hülle als nächstes installiert.
 * Seine Fehler sind im Betrieb still: ein Eintrag ohne passendes Archiv am Release lässt die
 * Hüllen ins Leere laden, eine falsche Version bietet ein Update an, das keins ist. Geprüft wird
 * deshalb, was in das Manifest hineinkommt und was draußen bleibt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { baueManifest, manifestAusVerzeichnis } from './desktop-manifest.mjs';

const REPO = 'rubenvitt/lifeline-hub';
const TAG = 'v1.2.0';
const JETZT = new Date('2026-09-29T12:00:00Z');
const MAC = 'lifeline-hub-desktop-1.2.0-macos-arm64.app.tar.gz';
const WIN = 'lifeline-hub-desktop-1.2.0-windows-x64-setup.exe';

function eingabe(dateien) {
  return { dateien, tag: TAG, repo: REPO, jetzt: JETZT };
}

test('beide Plattformen: Version ohne v, Signatur und URL je Plattform', () => {
  const m = baueManifest(
    eingabe({ [MAC]: null, [`${MAC}.sig`]: 'c2lnLW1hYw==\n', [WIN]: null, [`${WIN}.sig`]: 'c2lnLXdpbg==' }),
  );
  assert.equal(m.version, '1.2.0');
  assert.equal(m.pub_date, '2026-09-29T12:00:00.000Z');
  assert.deepEqual(Object.keys(m.platforms).sort(), ['darwin-aarch64', 'windows-x86_64']);
  assert.deepEqual(m.platforms['darwin-aarch64'], {
    signature: 'c2lnLW1hYw==',
    url: `https://github.com/${REPO}/releases/download/${TAG}/${MAC}`,
  });
  assert.equal(m.platforms['windows-x86_64'].url, `https://github.com/${REPO}/releases/download/${TAG}/${WIN}`);
  assert.match(m.notes, /releases\/tag\/v1\.2\.0/);
});

test('eine gescheiterte Plattform fehlt im Manifest, statt ins Leere zu zeigen', () => {
  const m = baueManifest(eingabe({ [MAC]: null, [`${MAC}.sig`]: 'c2ln' }));
  assert.deepEqual(Object.keys(m.platforms), ['darwin-aarch64']);
});

test('ein Archiv ohne Signatur zählt nicht', () => {
  const m = baueManifest(eingabe({ [MAC]: null, [`${MAC}.sig`]: 'c2ln', [WIN]: null }));
  assert.deepEqual(Object.keys(m.platforms), ['darwin-aarch64']);
});

test('eine Signatur ohne Archiv zählt nicht', () => {
  const m = baueManifest(eingabe({ [MAC]: null, [`${MAC}.sig`]: 'c2ln', [`${WIN}.sig`]: 'c2ln' }));
  assert.deepEqual(Object.keys(m.platforms), ['darwin-aarch64']);
});

test('eine leere Signatur zählt nicht', () => {
  const m = baueManifest(eingabe({ [MAC]: null, [`${MAC}.sig`]: 'c2ln', [WIN]: null, [`${WIN}.sig`]: ' \n' }));
  assert.deepEqual(Object.keys(m.platforms), ['darwin-aarch64']);
});

test('ohne ein einziges Paar bricht das Skript ab', () => {
  assert.throws(() => baueManifest(eingabe({ 'lifeline-hub-1.2.0-x86_64-unknown-linux-gnu': null })), /keine Plattform/);
});

test('ein Archiv einer anderen Version wird nicht aufgenommen', () => {
  const alt = 'lifeline-hub-desktop-1.1.0-macos-arm64.app.tar.gz';
  const m = baueManifest(eingabe({ [alt]: null, [`${alt}.sig`]: 'c2ln', [WIN]: null, [`${WIN}.sig`]: 'c2ln' }));
  assert.deepEqual(Object.keys(m.platforms), ['windows-x86_64']);
});

test('zwei Archive für dieselbe Plattform sind ein Fehler, keine Wahl', () => {
  const zweit = 'lifeline-hub-desktop-1.2.0-kopie-macos-arm64.app.tar.gz';
  assert.throws(
    () => baueManifest(eingabe({ [MAC]: null, [`${MAC}.sig`]: 'a', [zweit]: null, [`${zweit}.sig`]: 'b' })),
    /darwin-aarch64/,
  );
});

test('Vorabversionen behalten ihre Kennung', () => {
  const vorab = 'lifeline-hub-desktop-1.3.0-alpha.4-macos-arm64.app.tar.gz';
  const m = baueManifest({ ...eingabe({ [vorab]: null, [`${vorab}.sig`]: 'c2ln' }), tag: 'v1.3.0-alpha.4' });
  assert.equal(m.version, '1.3.0-alpha.4');
});

test('ungültiger Tag bricht ab', () => {
  assert.throws(() => baueManifest({ ...eingabe({ [MAC]: null, [`${MAC}.sig`]: 'c2ln' }), tag: '1.2.0' }), /Tag/);
});

test('aus dem Verzeichnis: liest Signaturen von der Platte und schreibt latest.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-manifest-'));
  writeFileSync(join(dir, MAC), 'archiv');
  writeFileSync(join(dir, `${MAC}.sig`), 'c2lnLW1hYw==\n');
  writeFileSync(join(dir, 'lifeline-hub-desktop-1.2.0-macos-arm64.dmg'), 'dmg');
  const m = manifestAusVerzeichnis({ dir, tag: TAG, repo: REPO, jetzt: JETZT });
  assert.equal(m.platforms['darwin-aarch64'].signature, 'c2lnLW1hYw==');
  const geschrieben = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));
  assert.deepEqual(geschrieben, m);
});
