/**
 * Selbsttest der PR-Kommentare nach der Freigabe (`pr-kommentare.mjs`) — läuft in Schritt 8 des
 * Gates. Ohne Netz und ohne Git: GitHub und das Repository sind Attrappen.
 *
 * Die tragenden Aussagen: kommentiert wird ab dem letzten VERÖFFENTLICHTEN Release desselben
 * Kanals (ein Entwurf zählt nicht), nur gemergte PRs dieses Bereichs, und keiner zweimal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  kanalVon,
  kommentarText,
  kommentiereRelease,
  vergleicheVersion,
  vorgaenger,
} from './pr-kommentare.mjs';

const REPO = 'rubenvitt/lifeline-hub';

test('kanalVon: stabil ist null, Vorabversion trägt ihren Kanal', () => {
  assert.equal(kanalVon('v1.2.0'), null);
  assert.equal(kanalVon('v1.0.0-alpha.99'), 'alpha');
  assert.equal(kanalVon('v1.0.0-beta.3'), 'beta');
  assert.throws(() => kanalVon('1.0.0'), /Release-Tag/);
  assert.throws(() => kanalVon('v1.0.0; rm -rf /'), /Release-Tag/);
});

test('vergleicheVersion: Zahlen numerisch, Vorabversion vor stabil', () => {
  assert.ok(vergleicheVersion('v1.0.0-alpha.100', 'v1.0.0-alpha.99') > 0);
  assert.ok(vergleicheVersion('v1.0.0-alpha.9', 'v1.0.0-alpha.10') < 0);
  assert.ok(vergleicheVersion('v1.0.0', 'v1.0.0-alpha.99') > 0);
  assert.ok(vergleicheVersion('v1.10.0', 'v1.9.3') > 0);
  assert.equal(vergleicheVersion('v2.0.0', 'v2.0.0'), 0);
});

test('vorgaenger: jüngstes veröffentlichtes Release desselben Kanals, Entwürfe zählen nicht', () => {
  const releases = [
    { tag_name: 'v1.0.0-alpha.99', draft: true },
    { tag_name: 'v1.0.0-alpha.98', draft: true },
    { tag_name: 'v1.0.0-alpha.97', draft: false },
    { tag_name: 'v1.0.0-alpha.96', draft: false },
    { tag_name: 'v1.0.0-beta.2', draft: false },
    { tag_name: 'v0.9.0', draft: false },
    { tag_name: 'v1.0.0-alpha.101', draft: false },
  ];
  assert.equal(vorgaenger({ tag: 'v1.0.0-alpha.100', releases }), 'v1.0.0-alpha.97');
  assert.equal(vorgaenger({ tag: 'v1.0.0-beta.3', releases }), 'v1.0.0-beta.2');
  assert.equal(vorgaenger({ tag: 'v1.0.0', releases }), 'v0.9.0');
  assert.equal(vorgaenger({ tag: 'v0.9.0', releases }), null);
  // Fremde Tags (etwa von Hand angelegte) überspringen statt abbrechen.
  assert.equal(
    vorgaenger({ tag: 'v1.0.0-alpha.2', releases: [{ tag_name: 'test', draft: false }] }),
    null,
  );
});

test('kommentarText: Vorabversion nennt Kanal und den Weg zur stabilen Version', () => {
  const text = kommentarText({ tag: 'v1.0.0-alpha.99', repo: REPO });
  assert.match(
    text,
    /^🚀 Dieser Pull Request ist in der Vorabversion \[v1\.0\.0-alpha\.99\]\(https:\/\/github\.com\/rubenvitt\/lifeline-hub\/releases\/tag\/v1\.0\.0-alpha\.99\) enthalten \(Kanal `alpha`\)\./,
  );
  assert.match(text, /stabile Version entsteht erst, wenn dieser Stand nach `main` gemergt wird/);
  assert.match(text, /<!-- lifeline-release:v1\.0\.0-alpha\.99 -->$/);
});

test('kommentarText: stabile Version ohne Kanal und ohne Nachsatz', () => {
  const text = kommentarText({ tag: 'v1.2.0', repo: REPO });
  assert.match(text, /^🚀 Dieser Pull Request ist in Version \[v1\.2\.0\]\(.*\) enthalten\.\n/);
  assert.doesNotMatch(text, /Kanal|stabile Version entsteht/);
});

function attrappe({ releases, commits, prs }) {
  const aufrufe = { bereich: [], kommentiert: [], gefragt: [] };
  const log = [];
  return {
    aufrufe,
    log,
    abhaengigkeiten: {
      releases: async () => releases,
      commitsImBereich: async (von, bis) => {
        aufrufe.bereich.push([von, bis]);
        return commits;
      },
      prsZuCommits: async (shas) => {
        aufrufe.gefragt.push(shas);
        return prs;
      },
      kommentieren: async (nummer, text) => {
        aufrufe.kommentiert.push({ nummer, text });
      },
      warnen: (text) => log.push(text),
      melden: (text) => log.push(text),
    },
  };
}

test('kommentiereRelease: nur gemergte PRs, deren Merge-Commit im Bereich liegt, jeder einmal', async () => {
  const { aufrufe, abhaengigkeiten } = attrappe({
    releases: [
      { tag_name: 'v1.0.0-alpha.99', draft: true },
      { tag_name: 'v1.0.0-alpha.98', draft: false },
    ],
    commits: ['a1', 'b2', 'c3'],
    prs: [
      { number: 600, merged: true, mergeCommit: 'a1', kommentare: [] },
      { number: 600, merged: true, mergeCommit: 'a1', kommentare: [] },
      // offen oder geschlossen ohne Merge: kein Release enthält ihn
      { number: 601, merged: false, mergeCommit: null, kommentare: [] },
      // gemergt, aber woanders: der Commit liegt nur zufällig auch in seinem Verlauf
      { number: 602, merged: true, mergeCommit: 'zz', kommentare: [] },
      { number: 603, merged: true, mergeCommit: 'c3', kommentare: ['Danke!'] },
    ],
  });
  const ergebnis = await kommentiereRelease({ tag: 'v1.0.0-alpha.100', repo: REPO, ...abhaengigkeiten });
  assert.deepEqual(aufrufe.bereich, [['v1.0.0-alpha.98', 'v1.0.0-alpha.100']]);
  assert.deepEqual(
    aufrufe.kommentiert.map(({ nummer }) => nummer),
    [600, 603],
  );
  assert.match(aufrufe.kommentiert[0].text, /alpha\.100/);
  assert.deepEqual(ergebnis, { kommentiert: 2, vorhanden: 0, fehler: 0 });
});

test('kommentiereRelease: ein vorhandener Kommentar zu diesem Tag verhindert den zweiten', async () => {
  const marke = kommentarText({ tag: 'v1.0.0-alpha.100', repo: REPO });
  const { aufrufe, abhaengigkeiten } = attrappe({
    releases: [{ tag_name: 'v1.0.0-alpha.98', draft: false }],
    commits: ['a1', 'b2'],
    prs: [
      { number: 600, merged: true, mergeCommit: 'a1', kommentare: [marke] },
      // Kommentar eines ANDEREN Releases hält nicht auf
      {
        number: 604,
        merged: true,
        mergeCommit: 'b2',
        kommentare: [kommentarText({ tag: 'v1.0.0-alpha.98', repo: REPO })],
      },
    ],
  });
  const ergebnis = await kommentiereRelease({ tag: 'v1.0.0-alpha.100', repo: REPO, ...abhaengigkeiten });
  assert.deepEqual(
    aufrufe.kommentiert.map(({ nummer }) => nummer),
    [604],
  );
  assert.deepEqual(ergebnis, { kommentiert: 1, vorhanden: 1, fehler: 0 });
});

test('kommentiereRelease: ohne Vorgänger gilt der ganze Verlauf bis zum Tag', async () => {
  const { aufrufe, abhaengigkeiten } = attrappe({ releases: [], commits: [], prs: [] });
  await kommentiereRelease({ tag: 'v1.0.0', repo: REPO, ...abhaengigkeiten });
  assert.deepEqual(aufrufe.bereich, [[null, 'v1.0.0']]);
  // Ohne Commits wird GitHub gar nicht erst gefragt.
  assert.deepEqual(aufrufe.gefragt, []);
});

test('kommentiereRelease: ein gescheiterter Kommentar ist eine Warnung, die übrigen gehen raus', async () => {
  const { aufrufe, abhaengigkeiten, log } = attrappe({
    releases: [],
    commits: ['a1', 'b2'],
    prs: [
      { number: 1, merged: true, mergeCommit: 'a1', kommentare: [] },
      { number: 2, merged: true, mergeCommit: 'b2', kommentare: [] },
    ],
  });
  const kommentieren = abhaengigkeiten.kommentieren;
  abhaengigkeiten.kommentieren = async (nummer, text) => {
    if (nummer === 1) throw new Error('403 Resource not accessible');
    return kommentieren(nummer, text);
  };
  const ergebnis = await kommentiereRelease({ tag: 'v1.0.0', repo: REPO, ...abhaengigkeiten });
  assert.deepEqual(
    aufrufe.kommentiert.map(({ nummer }) => nummer),
    [2],
  );
  assert.deepEqual(ergebnis, { kommentiert: 1, vorhanden: 0, fehler: 1 });
  assert.ok(log.some((zeile) => /#1.*403/.test(zeile)));
});
