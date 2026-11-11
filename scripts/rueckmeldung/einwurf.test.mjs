// Selbsttest des Einwurfs (LLH-1549): node --test scripts/rueckmeldung/einwurf.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BESCHREIBUNG_MAX,
  FELDER,
  baueEinwurf,
  einwerfen,
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
    assert.match(vorlage, new RegExp(`id: ${id}\\n    attributes:\\n      label: ${label.replace(/[?]/g, '\\?')}\\n`), id);
  }
});

test('zerlegt ein Formular, leere Felder werden leer', () => {
  const werte = zerlegeFormular(formularText({ schritte: '1. ETB öffnen\n2. Filter setzen' }));
  assert.equal(werte.art, 'Fehler');
  assert.equal(werte.version, '1.0.0-beta.1');
  assert.equal(werte.schritte, '1. ETB öffnen\n2. Filter setzen');
  assert.equal(werte.erwartet, '');
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

function antwort(status, daten) {
  return { status, ok: status < 300, json: async () => daten };
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
    abruf: async () => antwort(429, { error: 'too_many_requests' }),
  });
  assert.equal(abgelehnt.ok, false);
  assert.match(abgelehnt.fehler, /429 too_many_requests/);
  const netz = await einwerfen(einwurf, {
    zunderUrl: 'https://z',
    token: 'zi_geheim',
    abruf: async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    },
  });
  assert.match(netz.fehler, /nicht erreichbar/);
  const ohne = await einwerfen(einwurf, { zunderUrl: '', token: '' });
  assert.match(ohne.fehler, /fehlt/);
  for (const e of [abgelehnt, netz, ohne]) assert.doesNotMatch(e.fehler, /zi_geheim/);
});
