/**
 * Selbsttest des Aufräumens der Entwicklungszertifikate (`entwicklungszertifikate.mjs`, LLH-2149) —
 * läuft in Schritt 8 des Gates. Gegen eine nachgebaute App-Store-Connect-API, ohne Netz. Ein
 * widerrufenes Verteilungszertifikat oder das Zertifikat eines parallelen Laufs fiele sonst erst
 * am nächsten roten TestFlight-Lauf auf.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ARTEN, ausstellung, entwicklungszertifikate, nachher, vorher } from './entwicklungszertifikate.mjs';

const JETZT = Date.parse('2026-11-26T20:00:00Z');
const stunden = (h) => new Date(JETZT - h * 3_600_000);

/** Nachgebaute API: `seiten` sind die Antworten der Liste der Reihe nach; DELETE entfernt. */
function api(zertifikate, { seitengroesse = 200 } = {}) {
  const vorhanden = [...zertifikate];
  const aufrufe = [];
  const request = async (method, path) => {
    aufrufe.push({ method, path });
    if (method === 'DELETE') {
      const id = path.split('/').pop();
      const i = vorhanden.findIndex((z) => z.id === id);
      assert.ok(i >= 0, `DELETE auf unbekanntes ${id}`);
      vorhanden.splice(i, 1);
      return null;
    }
    assert.equal(method, 'GET');
    const [, query] = path.split('?');
    const params = new URLSearchParams(query);
    assert.equal(params.get('filter[certificateType]'), ARTEN.join(','));
    const ab = Number(params.get('cursor') ?? 0);
    const seite = vorhanden.slice(ab, ab + seitengroesse);
    const next = ab + seitengroesse < vorhanden.length
      ? `https://api.appstoreconnect.apple.com/v1/certificates?filter[certificateType]=${ARTEN.join(',')}&limit=200&cursor=${ab + seitengroesse}`
      : undefined;
    return {
      data: seite.map((z) => ({ id: z.id, attributes: { displayName: z.name, certificateContent: z.id } })),
      links: next ? { next } : {},
    };
  };
  const lies = (inhalt) => zertifikate.find((z) => z.id === inhalt)?.ausgestellt ?? null;
  return { request, aufrufe, vorhanden, lies };
}

function merkdatei() {
  const dir = mkdtempSync(join(tmpdir(), 'entwicklungszertifikate-'));
  return { pfad: join(dir, 'merke.json'), weg: () => rmSync(dir, { recursive: true, force: true }) };
}

const still = () => {};

test('fragt nur Entwicklungszertifikate ab, Verteilung ist nie darunter', () => {
  assert.deepEqual(ARTEN, ['DEVELOPMENT', 'IOS_DEVELOPMENT']);
  assert.ok(!ARTEN.some((a) => /DISTRIBUTION/.test(a)));
});

test('vorher widerruft ältere, behält jüngere und merkt sie', async () => {
  const m = merkdatei();
  try {
    const a = api([
      { id: 'alt1', name: 'Created via API', ausgestellt: stunden(30) },
      { id: 'grenze', name: 'Created via API', ausgestellt: stunden(2) },
      { id: 'jung', name: 'Created via API', ausgestellt: stunden(0.5) },
      { id: 'unlesbar', name: 'ohne Inhalt', ausgestellt: null },
    ]);
    const r = await vorher({ request: a.request, merke: m.pfad, jetzt: JETZT, lies: a.lies, log: still });
    assert.deepEqual(r.widerrufen.sort(), ['alt1', 'grenze', 'unlesbar']);
    assert.deepEqual(a.vorhanden.map((z) => z.id), ['jung']);
    assert.deepEqual(JSON.parse(readFileSync(m.pfad, 'utf8')), ['jung']);
  } finally {
    m.weg();
  }
});

test('nachher widerruft nur, was der Lauf angelegt hat', async () => {
  const m = merkdatei();
  try {
    writeFileSync(m.pfad, JSON.stringify(['parallel']));
    const a = api([
      { id: 'parallel', name: 'anderer Lauf', ausgestellt: stunden(0.5) },
      { id: 'neu', name: 'dieser Lauf', ausgestellt: stunden(0.1) },
    ]);
    const r = await nachher({ request: a.request, merke: m.pfad, lies: a.lies, log: still });
    assert.deepEqual(r.widerrufen, ['neu']);
    assert.deepEqual(a.vorhanden.map((z) => z.id), ['parallel']);
  } finally {
    m.weg();
  }
});

test('nachher ohne Merkdatei widerruft nichts', async () => {
  const a = api([{ id: 'x', name: 'x', ausgestellt: stunden(0.1) }]);
  const r = await nachher({ request: a.request, merke: '/gibt/es/nicht.json', lies: a.lies, log: still });
  assert.deepEqual(r.widerrufen, []);
  assert.equal(a.aufrufe.length, 0);
});

test('liest alle Seiten der Liste', async () => {
  const viele = Array.from({ length: 5 }, (_, i) => ({ id: `z${i}`, name: `z${i}`, ausgestellt: stunden(10) }));
  const a = api(viele, { seitengroesse: 2 });
  const liste = await entwicklungszertifikate(a.request, a.lies);
  assert.deepEqual(liste.map((z) => z.id), ['z0', 'z1', 'z2', 'z3', 'z4']);
  assert.ok(a.aufrufe.every((c) => c.path.startsWith('/v1/certificates?')), 'Folgeseiten ohne Host');
});

test('ausstellung liest validFrom aus dem DER-Inhalt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zert-'));
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
      '-subj', '/CN=Apple Development: Test', '-keyout', join(dir, 'k.pem'), '-outform', 'DER', '-out', join(dir, 'z.der'),
    ], { stdio: 'ignore' });
    const inhalt = readFileSync(join(dir, 'z.der')).toString('base64');
    const t = ausstellung(inhalt);
    assert.ok(t instanceof Date && Math.abs(Date.now() - t.getTime()) < 10 * 60_000, `validFrom ${t}`);
    assert.equal(ausstellung('kein-zertifikat'), null);
    assert.equal(ausstellung(undefined), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
