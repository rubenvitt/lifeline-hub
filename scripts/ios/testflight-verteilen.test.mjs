/**
 * Selbsttest der TestFlight-Verteilung (`testflight-verteilen.mjs`, LLH-1988, ADR-0078) — läuft in
 * Schritt 8 des Gates. Gegen eine nachgebaute App-Store-Connect-API, ohne Netz. Ein Alpha-Build bei
 * externen Testern, eine doppelte Beta-Prüfung oder ein Tippfehler im Gruppennamen fielen sonst
 * erst nach einer halben Stunde Warten am echten Release auf.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';

import { client, gruppenFuer, kanal, token, verteilen, wasTesten } from './testflight-verteilen.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });

/** Nachgebaute API: antwortet je Pfad und schreibt jeden Aufruf mit. */
function api({ zustaende = ['VALID'], gruppen = [], sprachen = [], pruefung = null } = {}) {
  const aufrufe = [];
  const vorhanden = gruppen.map((g) => ({ id: g.id, attributes: { name: g.name, isInternalGroup: g.intern } }));
  const request = async (method, path, body) => {
    aufrufe.push({ method, path, body });
    if (path.startsWith('/v1/apps?')) return { data: [{ id: 'app1', attributes: { bundleId: 'dev.rubeen.lifeline.ios' } }] };
    if (path === '/v1/apps/app1/betaGroups?limit=200') return { data: vorhanden };
    if (method === 'POST' && path === '/v1/betaGroups') {
      const neu = { id: `neu-${body.data.attributes.name}`, attributes: { ...body.data.attributes } };
      vorhanden.push(neu);
      return { data: neu };
    }
    if (path.startsWith('/v1/builds?')) {
      const zustand = zustaende.length > 1 ? zustaende.shift() : zustaende[0];
      return { data: zustand ? [{ id: 'b1', attributes: { processingState: zustand } }] : [] };
    }
    if (path === '/v1/builds/b1/betaBuildLocalizations') return { data: sprachen };
    if (path === '/v1/builds/b1/betaAppReviewSubmission') return { data: pruefung };
    return null;
  };
  return { request, aufrufe };
}

const BEIDE = [
  { id: 'gi', name: 'Intern', intern: true },
  { id: 'ge', name: 'Extern', intern: false },
];

const lauf = (a, opts = {}) => verteilen({
  request: a.request, bundleId: 'dev.rubeen.lifeline.ios', buildNummer: '202611221005',
  gruppen: ['Intern', 'Extern'], wasTesten: 'Lifeline 1.0.0-beta.3', schlafe: async () => {}, log: () => {}, ...opts,
});

const schreibend = (aufrufe) => aufrufe.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);

test('token: ES256-JWT mit Schlüssel-ID, Issuer und Zielgruppe', () => {
  const jwt = token({ keyId: 'KEY', issuerId: 'ISS', privateKey: pem, now: 1_000_000 });
  const [kopf, nutzlast, signatur] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(kopf, 'base64url')), { alg: 'ES256', kid: 'KEY', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(nutzlast, 'base64url')), { iss: 'ISS', iat: 1000, exp: 1900, aud: 'appstoreconnect-v1' });
  assert.ok(verify('sha256', Buffer.from(`${kopf}.${nutzlast}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signatur, 'base64url')));
});

test('client: Fehler nennt Status und Apples Begründung', async () => {
  const fetch = async () => new Response(JSON.stringify({ errors: [{ detail: 'Beta App Review Information fehlt' }] }), { status: 409 });
  const request = client({ keyId: 'KEY', issuerId: 'ISS', privateKey: pem, fetch });
  await assert.rejects(request('POST', '/v1/betaAppReviewSubmissions', {}), (err) => {
    assert.equal(err.status, 409);
    assert.match(err.message, /409 Beta App Review Information fehlt/);
    return true;
  });
});

test('kanal und gruppenFuer: Alpha nur intern, Beta und stabil auch extern', () => {
  assert.equal(kanal('v1.0.0-alpha.196'), 'alpha');
  assert.equal(kanal('v1.0.0-beta.3'), 'beta');
  assert.equal(kanal('v1.0.0'), 'main');
  assert.throws(() => kanal('v1.0.0-rc.1'), /keinen TestFlight-Kanal/);
  assert.throws(() => kanal('1.0.0'), /keinen TestFlight-Kanal/);
  assert.deepEqual(gruppenFuer('alpha'), ['Intern']);
  assert.deepEqual(gruppenFuer('beta'), ['Intern', 'Extern']);
  assert.deepEqual(gruppenFuer('main'), ['Intern', 'Extern']);
});

test('wasTesten: volle Version oben, Notizen als Klartext, höchstens 4000 Zeichen', () => {
  const notizen = '## [1.0.0-alpha.196](https://example.test/x) (2026-11-22)\n\n### Wichtige Änderungen\n\n- **Gleichzeitiges Bearbeiten:** siehe [Doku](https://example.test/d).\n';
  assert.equal(
    wasTesten({ version: '1.0.0-alpha.196', notizen }),
    'Lifeline 1.0.0-alpha.196\n\n1.0.0-alpha.196 (2026-11-22)\n\nWichtige Änderungen\n\n- Gleichzeitiges Bearbeiten: siehe Doku.',
  );
  assert.equal(wasTesten({ version: '1.0.0', notizen: '' }), 'Lifeline 1.0.0');
  assert.equal(wasTesten({ version: '1.0.0' }), 'Lifeline 1.0.0');
  const lang = wasTesten({ version: '1.0.0', notizen: 'x'.repeat(5000) });
  assert.equal(lang.length, 4000);
  assert.ok(lang.endsWith('…'));
});

test('wartet auf die Verarbeitung, setzt „Was testen“, hängt an beide Gruppen und reicht ein', async () => {
  const a = api({ zustaende: [null, 'PROCESSING', 'VALID'], gruppen: BEIDE });
  await lauf(a);
  assert.equal(a.aufrufe.filter((c) => c.path.startsWith('/v1/builds?')).length, 3);
  assert.deepEqual(schreibend(a.aufrufe), [
    'POST /v1/betaBuildLocalizations',
    'POST /v1/betaGroups/gi/relationships/builds',
    'POST /v1/betaGroups/ge/relationships/builds',
    'POST /v1/betaAppReviewSubmissions',
  ]);
  const sprache = a.aufrufe.find((c) => c.path === '/v1/betaBuildLocalizations').body.data;
  assert.deepEqual(sprache.attributes, { locale: 'de-DE', whatsNew: 'Lifeline 1.0.0-beta.3' });
  assert.equal(sprache.relationships.build.data.id, 'b1');
  const filter = new URLSearchParams(a.aufrufe.find((c) => c.path.startsWith('/v1/builds?')).path.split('?')[1]);
  assert.equal(filter.get('filter[version]'), '202611221005');
  assert.equal(filter.get('filter[preReleaseVersion.platform]'), 'IOS');
});

test('vorhandene Sprachen werden aktualisiert statt neu angelegt', async () => {
  const a = api({ gruppen: BEIDE, sprachen: [{ id: 'l1' }, { id: 'l2' }] });
  await lauf(a);
  assert.deepEqual(schreibend(a.aufrufe).slice(0, 2), ['PATCH /v1/betaBuildLocalizations/l1', 'PATCH /v1/betaBuildLocalizations/l2']);
});

test('Alpha: nur die interne Gruppe, keine Beta-Prüfung', async () => {
  const a = api({ gruppen: BEIDE });
  await lauf(a, { gruppen: gruppenFuer('alpha') });
  assert.deepEqual(schreibend(a.aufrufe), ['POST /v1/betaBuildLocalizations', 'POST /v1/betaGroups/gi/relationships/builds']);
});

test('fehlende Gruppen werden vor dem Warten angelegt: Intern intern, Extern ohne öffentlichen Link', async () => {
  const a = api();
  await lauf(a);
  const angelegt = a.aufrufe.filter((c) => c.method === 'POST' && c.path === '/v1/betaGroups');
  assert.deepEqual(angelegt.map((c) => c.body.data.attributes), [
    { name: 'Intern', isInternalGroup: true, hasAccessToAllBuilds: false },
    { name: 'Extern', isInternalGroup: false, publicLinkEnabled: false },
  ]);
  for (const c of angelegt) assert.deepEqual(c.body.data.relationships.app.data, { type: 'apps', id: 'app1' });
  const ersterBuild = a.aufrufe.findIndex((c) => c.path.startsWith('/v1/builds?'));
  assert.ok(a.aufrufe.lastIndexOf(angelegt.at(-1)) < ersterBuild);
  assert.ok(schreibend(a.aufrufe).includes('POST /v1/betaGroups/neu-Extern/relationships/builds'));
});

test('Gruppe mit dem Namen, aber falscher Art: Abbruch vor dem Warten', async () => {
  const a = api({ gruppen: [{ id: 'gx', name: 'Extern', intern: true }, { id: 'gi', name: 'Intern', intern: true }] });
  await assert.rejects(lauf(a), /Gruppe „Extern“ ist intern, erwartet extern/);
  assert.ok(!a.aufrufe.some((c) => c.path.startsWith('/v1/builds')));
});

test('schon eingereicht: kein zweites Einreichen', async () => {
  const a = api({ gruppen: BEIDE, pruefung: { id: 'r1', attributes: { betaReviewState: 'WAITING_FOR_REVIEW' } } });
  await lauf(a);
  assert.ok(!schreibend(a.aufrufe).includes('POST /v1/betaAppReviewSubmissions'));
});

test('ungültiger Build und Zeitüberschreitung brechen mit dem Zustand ab', async () => {
  await assert.rejects(lauf(api({ gruppen: BEIDE, zustaende: ['FAILED'] })), /FAILED/);
  await assert.rejects(
    lauf(api({ gruppen: BEIDE, zustaende: ['PROCESSING'] }), { warteMs: 60_000, pruefMs: 30_000 }),
    /nach 1 Minuten nicht verarbeitet \(PROCESSING\)/,
  );
  await assert.rejects(
    lauf(api({ gruppen: BEIDE, zustaende: [null] }), { warteMs: 30_000, pruefMs: 30_000 }),
    /nicht verarbeitet \(nicht gefunden\)/,
  );
});
