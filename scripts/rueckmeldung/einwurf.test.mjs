// Selbsttest des Einwurfs (LLH-1549): node --test scripts/rueckmeldung/einwurf.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BESCHREIBUNG_MAX,
  FELDER,
  VERSUCHE,
  baueEinwurf,
  einwerfen,
  kennzeichnen,
  warteAus,
  zerlegeFormular,
} from './einwurf.mjs';

/** So schreibt GitHub ein ausgefülltes Issue-Formular in den Issue-Text. */
function formularText(werte) {
  const voll = {
    art: 'Fehler',
    version: '1.0.0-beta.1',
    oberflaeche: 'Desktop-App',
    seite: '/einsatz/:id/etb',
    beschreibung: 'Der Filter springt zurück.',
    schritte: '_No response_',
    erwartet: '_No response_',
    ...werte,
  };
  const teile = Object.entries(FELDER).map(([id, label]) => `### ${label}\n\n${voll[id]}`);
  teile.push('### Öffentlich\n\n- [X] Text und Bilder enthalten keine Namen …');
  return teile.join('\n\n');
}

function issue(werte = {}, mehr = {}) {
  return {
    number: 12,
    title: 'ETB-Filter springt zurück',
    html_url: 'https://github.com/rubenvitt/lifeline-hub/issues/12',
    user: { login: 'tester' },
    body: formularText(werte),
    ...mehr,
  };
}

test('Formular-Labels stimmen mit rueckmeldung.yml überein', () => {
  const pfad = fileURLToPath(new URL('../../.github/ISSUE_TEMPLATE/rueckmeldung.yml', import.meta.url));
  const vorlage = readFileSync(pfad, 'utf8');
  for (const [id, label] of Object.entries(FELDER)) {
    assert.ok(vorlage.includes(`id: ${id}\n    attributes:\n      label: ${label}\n`), id);
  }
});

test('zerlegt ein Formular, leere Felder werden leer', () => {
  const werte = zerlegeFormular(formularText({ schritte: '1. ETB öffnen\n2. Filter setzen' }));
  assert.equal(werte.art, 'Fehler');
  assert.equal(werte.version, '1.0.0-beta.1');
  assert.equal(werte.schritte, '1. ETB öffnen\n2. Filter setzen');
  assert.equal(werte.erwartet, '');
});

test('eigene ###-Überschriften in einer Antwort bleiben in der Antwort', () => {
  const beschreibung = 'Kurz.\n\n### Details\n\n```\n### kein Feld\n```';
  const werte = zerlegeFormular(formularText({ beschreibung, erwartet: 'Ruhe.' }));
  assert.equal(werte.beschreibung, beschreibung);
  assert.equal(werte.erwartet, 'Ruhe.');
  assert.match(baueEinwurf(issue({ beschreibung })).description, /### Details/);
});

test('ein freies Issue ist keine Rückmeldung', () => {
  assert.equal(zerlegeFormular('Bitte Dark Mode'), null);
  assert.equal(baueEinwurf({ ...issue(), body: '### Irgendwas\n\nText' }), null);
  assert.equal(baueEinwurf({ ...issue(), body: null }), null);
});

test('Einwurf: external_id, Titel, Link, kein type', () => {
  const einwurf = baueEinwurf(issue());
  assert.equal(einwurf.external_id, 'github-issue-12');
  assert.match(einwurf.external_id, /^[A-Za-z0-9_-]{1,128}$/);
  assert.equal(einwurf.title, 'ETB-Filter springt zurück');
  assert.deepEqual(einwurf.links, [
    { url: 'https://github.com/rubenvitt/lifeline-hub/issues/12', title: 'GitHub-Issue #12' },
  ]);
  assert.equal('type' in einwurf, false);
});

test('Kontextblock unter dem Text, leere Felder fehlen', () => {
  const { description } = baueEinwurf(issue({ erwartet: 'Filter bleibt stehen.' }));
  assert.ok(description.startsWith('Der Filter springt zurück.'));
  assert.match(description, /\*\*Erwartet\*\*\n\nFilter bleibt stehen\./);
  assert.doesNotMatch(description, /Schritte zum Nachstellen/);
  assert.match(description, /\*\*Art:\*\* Fehler/);
  assert.match(description, /\*\*Gemeldet von:\*\* @tester/);
  assert.match(description, /\*\*Version:\*\* `1\.0\.0-beta\.1` · \*\*Oberfläche:\*\* Desktop-App · \*\*Bereich:\*\* `\/einsatz\/:id\/etb`/);
  assert.match(description, /\*\*Eingang:\*\* GitHub-Issue #12$/);
});

test('Kontextfelder bleiben einzeilig, Backticks brechen den Code nicht', () => {
  const { description } = baueEinwurf(issue({ version: '1.0`\n**Art:** Wunsch', oberflaeche: '' }));
  const kontext = description.split('\n---\n')[1];
  assert.equal((kontext.match(/^\*\*Art:\*\*/gm) ?? []).length, 1);
  assert.match(kontext, /\*\*Version:\*\* `1\.0' \*\*Art:\*\* Wunsch`/);
  assert.doesNotMatch(kontext, /Oberfläche/);
});

test('Grenzen des Eingangs: Titel 200, Beschreibung 20 000', () => {
  const lang = baueEinwurf(issue({ beschreibung: 'x'.repeat(30_000) }, { title: 't'.repeat(300) }));
  assert.equal(lang.title.length, 200);
  assert.ok(lang.description.length <= BESCHREIBUNG_MAX);
  assert.match(lang.description, /gekürzt, vollständig im Issue\./);
  assert.match(lang.description, /\*\*Eingang:\*\* GitHub-Issue #12$/);
  assert.equal(baueEinwurf(issue({}, { title: '   ' })).title, 'Rückmeldung #12');
});

function antwort(status, daten, kopf = {}) {
  return {
    status,
    ok: status < 300,
    headers: { get: (name) => kopf[name.toLowerCase()] ?? null },
    json: async () => daten,
  };
}

/** Wartezeiten mitschreiben statt schlafen. */
function uhr() {
  const pausen = [];
  return { pausen, warte: async (ms) => void pausen.push(ms) };
}

test('einwerfen: schickt an den Eingang mit Bearer, liefert die Kennung', async () => {
  const aufrufe = [];
  const abruf = async (adresse, optionen) => {
    aufrufe.push({ adresse, optionen });
    return antwort(201, { id: 'abc', ref: 'LLHE-1' });
  };
  const einwurf = baueEinwurf(issue());
  const ergebnis = await einwerfen(einwurf, { zunderUrl: 'https://zunder.example/', token: 'zi_x', abruf });
  assert.deepEqual(ergebnis, { ok: true, status: 201, ref: 'LLHE-1' });
  assert.equal(aufrufe[0].adresse, 'https://zunder.example/intake/v1/tasks');
  assert.equal(aufrufe[0].optionen.headers.Authorization, 'Bearer zi_x');
  assert.deepEqual(JSON.parse(aufrufe[0].optionen.body), einwurf);
});

test('einwerfen: Wiederholung (200) gilt als aufgenommen', async () => {
  const ergebnis = await einwerfen(baueEinwurf(issue()), {
    zunderUrl: 'https://z',
    token: 'zi_x',
    abruf: async () => antwort(200, { id: 'abc', ref: 'LLHE-1' }),
  });
  assert.equal(ergebnis.ok, true);
});

test('einwerfen: Ablehnung, Netzfehler und fehlendes Secret werfen nicht und nennen den Token nie', async () => {
  const einwurf = baueEinwurf(issue());
  const abgelehnt = await einwerfen(einwurf, {
    zunderUrl: 'https://z',
    token: 'zi_geheim',
    abruf: async () => antwort(429, { error: 'too_many_requests' }, { 'retry-after': '3600' }),
    warte: uhr().warte,
  });
  assert.equal(abgelehnt.ok, false);
  assert.match(abgelehnt.fehler, /429 too_many_requests/);
  const netz = await einwerfen(einwurf, {
    zunderUrl: 'https://z',
    token: 'zi_geheim',
    abruf: async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    },
    warte: uhr().warte,
  });
  assert.match(netz.fehler, /nicht erreichbar/);
  const ohne = await einwerfen(einwurf, { zunderUrl: '', token: '' });
  assert.match(ohne.fehler, /fehlt/);
  for (const e of [abgelehnt, netz, ohne]) assert.doesNotMatch(e.fehler, /zi_geheim/);
});

test('einwerfen: vorübergehende Fehler werden begrenzt wiederholt, 4xx nicht', async () => {
  const einwurf = baueEinwurf(issue());
  let n = 0;
  const { pausen, warte } = uhr();
  const erholt = await einwerfen(einwurf, {
    zunderUrl: 'https://z',
    token: 'zi_x',
    abruf: async () => (++n < 3 ? antwort(503, {}) : antwort(201, { ref: 'LLHE-2' })),
    warte,
  });
  assert.deepEqual(erholt, { ok: true, status: 201, ref: 'LLHE-2' });
  assert.deepEqual(pausen, [2_000, 4_000]);

  n = 0;
  const kurz = uhr();
  await einwerfen(einwurf, {
    zunderUrl: 'https://z',
    token: 'zi_x',
    abruf: async () => (++n < 2 ? antwort(429, {}, { 'retry-after': '5' }) : antwort(200, { ref: 'LLHE-2' })),
    warte: kurz.warte,
  });
  assert.deepEqual(kurz.pausen, [5_000]);

  n = 0;
  const immer = await einwerfen(einwurf, {
    zunderUrl: 'https://z',
    token: 'zi_x',
    abruf: async () => (n++, antwort(502, {})),
    warte: uhr().warte,
  });
  assert.equal(immer.ok, false);
  assert.equal(n, VERSUCHE);

  n = 0;
  await einwerfen(einwurf, {
    zunderUrl: 'https://z',
    token: 'zi_x',
    abruf: async () => (n++, antwort(400, { error: 'bad_request' })),
    warte: uhr().warte,
  });
  assert.equal(n, 1);
});

test('einwerfen: hängende Antwort läuft in die Frist', async () => {
  const ergebnis = await einwerfen(baueEinwurf(issue()), {
    zunderUrl: 'https://z',
    token: 'zi_x',
    frist: 50,
    versuche: 1,
    abruf: async (_adresse, { signal }) =>
      new Promise((_fertig, abbruch) => signal.addEventListener('abort', () => abbruch(signal.reason))),
  });
  assert.equal(ergebnis.ok, false);
  assert.match(ergebnis.fehler, /keine Antwort in 0\.05 s/);
});

test('kennzeichnen: setzt den Status und nimmt das Gegenlabel ab, 404 zählt nicht', async () => {
  const aufrufe = [];
  await kennzeichnen({
    repo: 'o/r',
    nummer: 12,
    labels: ['rückmeldung', 'aufgenommen'],
    entfernen: ['nicht-aufgenommen'],
    ghToken: 'gh',
    abruf: async (adresse, optionen) => {
      aufrufe.push(`${optionen.method} ${adresse}`);
      return antwort(optionen.method === 'DELETE' ? 404 : 200, []);
    },
  });
  assert.deepEqual(aufrufe, [
    'POST https://api.github.com/repos/o/r/issues/12/labels',
    'DELETE https://api.github.com/repos/o/r/issues/12/labels/nicht-aufgenommen',
  ]);
  await assert.rejects(
    kennzeichnen({
      repo: 'o/r',
      nummer: 12,
      labels: ['aufgenommen'],
      entfernen: ['nicht-aufgenommen'],
      ghToken: 'gh',
      abruf: async (_a, o) => antwort(o.method === 'DELETE' ? 500 : 200, []),
    }),
    /500 beim Entfernen/,
  );
});

test('Retry-After: Sekunden, HTTP-Datum, fehlend', async () => {
  const jetzt = Date.parse('2026-11-11T08:00:00Z');
  assert.equal(warteAus('5', jetzt), 5_000);
  assert.equal(warteAus('0', jetzt), 0);
  assert.equal(warteAus('Wed, 11 Nov 2026 08:00:10 GMT', jetzt), 10_000);
  assert.equal(warteAus('Wed, 11 Nov 2026 07:59:00 GMT', jetzt), 0);
  assert.equal(warteAus(null, jetzt), null);
  assert.equal(warteAus('bald', jetzt), null);

  let n = 0;
  const ohne = await einwerfen(baueEinwurf(issue()), {
    zunderUrl: 'https://z',
    token: 'zi_x',
    abruf: async () => (n++, antwort(429, {})),
    warte: uhr().warte,
  });
  assert.equal(ohne.ok, false);
  assert.equal(n, 1, '429 ohne Retry-After wird nicht wiederholt');

  n = 0;
  const null_s = uhr();
  await einwerfen(baueEinwurf(issue()), {
    zunderUrl: 'https://z',
    token: 'zi_x',
    abruf: async () => (++n < 2 ? antwort(429, {}, { 'retry-after': '0' }) : antwort(201, {})),
    warte: null_s.warte,
  });
  assert.deepEqual(null_s.pausen, [0]);
});
