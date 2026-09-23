/**
 * Selbsttest der KI-Release-Notizen (`ki-notizen.mjs`) — läuft in Schritt 8 des Gates.
 *
 * Ohne Netz und ohne installierte Release-Werkzeuge: beide Generatoren sind Attrappen. Geprüft
 * wird nicht, was Claude schreibt, sondern was die Hülle mit dem Ergebnis tut. Die tragenden
 * Aussagen sind die Rückfälle — jeder davon ist im Betrieb still, ein Fehler dort stünde
 * dauerhaft in CHANGELOG.md und im GitHub-Release.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KI_FEHLTEXTE,
  commitsFuerPrompt,
  erzeugeNotizen,
  istBrauchbar,
  kopfzeileAus,
  mitKopfzeile,
} from './ki-notizen.mjs';

const KOPF =
  '## [1.0.0-alpha.36](https://github.com/rubenvitt/lifeline-hub/compare/v1.0.0-alpha.35...v1.0.0-alpha.36) (2026-09-23)';
const KONVENTIONELL = `${KOPF}\n\n### Features\n\n* **etb:** etwas (LFH-1)\n`;
const KI_TEXT = '## Einsatztagebuch\n\nDas ETB kann jetzt etwas.\n\n### Details\n\n- Punkt';

function stille() {
  const zeilen = [];
  const merk = (art) => (text) => zeilen.push([art, text]);
  return { log: merk('log'), warn: merk('warn'), error: merk('error'), zeilen };
}

function kontext(ueberschreiben = {}) {
  return {
    logger: stille(),
    env: { ANTHROPIC_API_KEY: 'sk-test' },
    nextRelease: { version: '1.0.0-alpha.36' },
    commits: [{ message: 'feat(etb): etwas (LFH-1)\n\nText', hash: 'abc1234' }],
    ...ueberschreiben,
  };
}

function hülle({ ki = async () => KI_TEXT } = {}) {
  const aufrufe = { ki: [], konventionell: 0 };
  const generateNotes = erzeugeNotizen({
    ki: async (config, context) => {
      aufrufe.ki.push({ config, context });
      return ki(config, context);
    },
    konventionell: async () => {
      aufrufe.konventionell += 1;
      return KONVENTIONELL;
    },
  });
  return { generateNotes, aufrufe };
}

const CONFIG = { preset: 'conventionalcommits', promptTemplate: 'Vorlage {{commits}}' };

test('KI-Text bekommt die Kopfzeile der konventionellen Notizen, Überschriften eine Ebene tiefer', async () => {
  const { generateNotes } = hülle();
  const notizen = await generateNotes(CONFIG, kontext());
  assert.equal(
    notizen,
    `${KOPF}\n\n### Einsatztagebuch\n\nDas ETB kann jetzt etwas.\n\n#### Details\n\n- Punkt\n`,
  );
});

test('der zweite Aufruf derselben Version liefert denselben Text, ohne zweiten Modellaufruf', async () => {
  // semantic-release ruft generateNotes nach dem Versions-Commit erneut auf — der Text des
  // GitHub-Releases muss der aus CHANGELOG.md sein, nicht eine zweite Formulierung.
  let n = 0;
  const { generateNotes, aufrufe } = hülle({ ki: async () => `## Fassung ${++n}\n\nText` });
  const erster = await generateNotes(CONFIG, kontext());
  const zweiter = await generateNotes(CONFIG, kontext());
  assert.equal(zweiter, erster);
  assert.equal(aufrufe.ki.length, 1);
});

test('der Rückfall wird ebenfalls gemerkt — kein zweiter Versuch nach dem Push', async () => {
  const { generateNotes, aufrufe } = hülle({ ki: async () => KI_FEHLTEXTE[1] });
  assert.equal(await generateNotes(CONFIG, kontext()), KONVENTIONELL);
  assert.equal(await generateNotes(CONFIG, kontext()), KONVENTIONELL);
  assert.equal(aufrufe.ki.length, 1);
});

test('ohne ANTHROPIC_API_KEY: konventionelle Notizen, Claude wird gar nicht gefragt', async () => {
  const { generateNotes, aufrufe } = hülle();
  const k = kontext({ env: {} });
  assert.equal(await generateNotes(CONFIG, k), KONVENTIONELL);
  assert.equal(aufrufe.ki.length, 0);
  assert.ok(k.logger.zeilen.some(([art]) => art === 'warn'));
});

for (const fehltext of KI_FEHLTEXTE) {
  test(`Fehltext des Plugins wird nicht zum Release-Text: ${JSON.stringify(fehltext)}`, async () => {
    const { generateNotes } = hülle({ ki: async () => fehltext });
    assert.equal(await generateNotes(CONFIG, kontext()), KONVENTIONELL);
  });
}

test('ein geworfener Fehler endet in den konventionellen Notizen, nicht im Abbruch', async () => {
  const { generateNotes } = hülle({
    ki: async () => {
      throw new Error('kaputt');
    },
  });
  const k = kontext();
  assert.equal(await generateNotes(CONFIG, k), KONVENTIONELL);
  assert.ok(k.logger.zeilen.some(([art, text]) => art === 'error' && text.includes('kaputt')));
});

test('an Claude gehen Vorlage, keine Shell-Maskierung, EIN Zug und ALLE Commits', async () => {
  const { generateNotes, aufrufe } = hülle();
  const commits = Array.from({ length: 250 }, (_, i) => ({ message: `fix: ${i}`, hash: `h${i}` }));
  await generateNotes(CONFIG, kontext({ commits }));
  const [{ config, context }] = aufrufe.ki;
  assert.equal(config.promptTemplate, CONFIG.promptTemplate);
  assert.equal(config.escaping, 'none');
  // Ein Zug: kein Werkzeugaufruf, also auch kein Lesen von .git/config samt Token.
  assert.equal(config.maxTurns, 1);
  // Die Vorgabe des Plugins (100) schnitte die älteren 150 still ab.
  assert.equal(config.maxCommits, 250);
  assert.equal(context.commits.length, 250);
  assert.equal('preset' in config, false);
});

test('commitsFuerPrompt: voll, dann Kopfzeilen, dann nichts', () => {
  const lang = [
    { message: 'feat: a\n\n' + 'x'.repeat(60) },
    { message: 'fix: b\n\n' + 'y'.repeat(60) },
  ];
  assert.equal(commitsFuerPrompt(lang, 1000).form, 'voll');
  const koepfe = commitsFuerPrompt(lang, 100);
  assert.equal(koepfe.form, 'kopfzeilen');
  assert.deepEqual(
    koepfe.commits.map((c) => c.message),
    ['feat: a', 'fix: b'],
  );
  assert.deepEqual(commitsFuerPrompt(lang, 5), { form: null, commits: [] });
});

test("ein `$'` im Commit-Text übersteht das replace() des Plugins unverändert", () => {
  const message = "fix: Preis $' und $& und $$ und $1";
  const [maskiert] = commitsFuerPrompt([{ message }]).commits;
  // So setzt das Plugin die Commits ein (`lib/generate-notes.js`).
  const vorlage = 'A {{commits}} B';
  const ergebnis = vorlage.replace('{{commits}}', JSON.stringify(maskiert.message));
  assert.equal(ergebnis, `A ${JSON.stringify(message)} B`);
});

test('istBrauchbar verlangt Gliederung', () => {
  assert.equal(istBrauchbar(''), false);
  assert.equal(istBrauchbar(undefined), false);
  assert.equal(istBrauchbar('Nur ein Satz ohne Überschrift.'), false);
  assert.equal(istBrauchbar(KI_TEXT), true);
});

test('mitKopfzeile lässt Code-Blöcke und die unterste Ebene in Ruhe', () => {
  const text = '## A\n\n```md\n## bleibt\n```\n\n###### Boden';
  assert.equal(
    mitKopfzeile('## K', text),
    '## K\n\n### A\n\n```md\n## bleibt\n```\n\n###### Boden\n',
  );
});

test('kopfzeileAus fällt ohne Überschrift auf die nackte Version zurück', () => {
  assert.equal(kopfzeileAus(KONVENTIONELL, 'x'), KOPF);
  assert.equal(kopfzeileAus('', '1.0.0'), '## 1.0.0');
});
