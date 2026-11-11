#!/usr/bin/env node
/**
 * Rückmeldung aus einem GitHub-Issue in Zunder einwerfen (LLH-1549).
 *
 *   GITHUB_EVENT_PATH=… GITHUB_REPOSITORY=owner/name GH_TOKEN=… \
 *   ZUNDER_URL=https://zunder.rubeen.dev ZUNDER_EINGANG_TOKEN=zi_… \
 *   node scripts/rueckmeldung/einwurf.mjs
 *
 * Aufgerufen vom Workflow `.github/workflows/rueckmeldung.yml` bei `issues: opened`; der
 * Selbsttest (`einwurf.test.mjs`) läuft in Schritt 8 von `scripts/check-all.sh`.
 *
 * DER WEG: Tester melden über das Formular `.github/ISSUE_TEMPLATE/rueckmeldung.yml` im
 * öffentlichen Repo. Dieses Skript schickt jede Meldung an den Zunder-Eingang
 * (`POST /intake/v1/tasks`, Token `zi_…` nur als Actions-Secret) in das Eingangsprojekt
 * „Lifeline Hub Eingang“; dort wird sie triagiert. Das Issue bleibt der Gesprächsort, die
 * Zunder-Aufgabe verweist darauf. Später bearbeitete Texte und Kommentare wandern nicht nach.
 *
 * NUR FORMULAR-ISSUES: Ein Issue ohne die Überschriften des Formulars (per API angelegt, von
 * Hand mit Rechten am Repo) bleibt liegen. Kein Label als Filter: ein Label im Formular, das es
 * im Repo nicht gibt, lässt GitHub still weg.
 *
 * KEIN `type`: Das Eingangsprojekt ist ein Standardprojekt, dort lehnt Zunder `bug`/`feature`
 * mit 400 ab (Lehre aus IDA-251). Die Art steht im Kontextblock, den Typ setzt die Triage.
 *
 * IDEMPOTENT: `external_id` = `github-issue-<nummer>`; ein wiederholter Lauf bekommt von Zunder
 * 200 mit derselben Aufgabe zurück, statt eine zweite anzulegen.
 *
 * ERGEBNIS AM ISSUE: Label `aufgenommen`, sonst `nicht-aufgenommen` und ein roter Lauf. Der
 * Tester bekommt keine Fehlermeldung; „Re-run“ wirft erneut ein. Fremde Texte gehen nur als
 * Daten in JSON, nie in eine Shell, und der Token erscheint in keiner Ausgabe.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Überschriften der Formularfelder (`label` in `rueckmeldung.yml`), je `id`. */
export const FELDER = {
  art: 'Art',
  version: 'Version',
  oberflaeche: 'Oberfläche',
  seite: 'Bereich der App',
  beschreibung: 'Was ist passiert, was wünschst du dir?',
  schritte: 'Schritte zum Nachstellen',
  erwartet: 'Erwartet',
};

/** Grenzen des Zunder-Eingangs (Vertrag 3.3): Titel 200, Beschreibung 20 000 Zeichen. */
export const TITEL_MAX = 200;
export const BESCHREIBUNG_MAX = 20_000;

/** Was GitHub in ein leer gelassenes Feld schreibt. */
const LEER = '_No response_';

/**
 * Zerlegt den Text eines Formular-Issues in `id → Wert`. Felder, die fehlen oder leer blieben,
 * sind `''`. Gibt `null` zurück, wenn der Text nicht aus dem Formular stammt (Art, Version und
 * Beschreibung fehlen).
 */
export function zerlegeFormular(text) {
  const abschnitte = new Map();
  let ueberschrift = null;
  let zeilen = [];
  const abschliessen = () => {
    if (ueberschrift !== null) abschnitte.set(ueberschrift, zeilen.join('\n').trim());
  };
  for (const zeile of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const treffer = /^### (.+?)\s*$/.exec(zeile);
    if (treffer) {
      abschliessen();
      ueberschrift = treffer[1];
      zeilen = [];
    } else if (ueberschrift !== null) {
      zeilen.push(zeile);
    }
  }
  abschliessen();

  const werte = {};
  for (const [id, label] of Object.entries(FELDER)) {
    const wert = abschnitte.get(label) ?? '';
    werte[id] = wert === LEER ? '' : wert;
  }
  const pflicht = [FELDER.art, FELDER.version, FELDER.beschreibung];
  if (!pflicht.every((label) => abschnitte.has(label))) return null;
  return werte;
}

/** Eine Zeile des Kontextblocks: Steuerzeichen und Zeilenumbrüche raus, Länge begrenzt. */
function einzeilig(wert, max = 120) {
  const flach = String(wert ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flach.length > max ? `${flach.slice(0, max - 1)}…` : flach;
}

/** Inline-Code, der einen Backtick im Wert übersteht. */
function code(wert) {
  return `\`${einzeilig(wert).replace(/`/g, "'")}\``;
}

/**
 * Baut den Body für `POST /intake/v1/tasks` aus einem Issue des Events (`event.issue`).
 * Gibt `null` zurück, wenn das Issue nicht aus dem Formular stammt.
 */
export function baueEinwurf(issue) {
  const werte = zerlegeFormular(issue?.body);
  if (werte === null) return null;

  const abschnitte = [werte.beschreibung];
  if (werte.schritte) abschnitte.push(`**Schritte zum Nachstellen**\n\n${werte.schritte}`);
  if (werte.erwartet) abschnitte.push(`**Erwartet**\n\n${werte.erwartet}`);

  const ort = [`**Version:** ${code(werte.version)}`];
  if (werte.oberflaeche) ort.push(`**Oberfläche:** ${einzeilig(werte.oberflaeche)}`);
  if (werte.seite) ort.push(`**Bereich:** ${code(werte.seite)}`);
  const kontext = [
    `**Art:** ${einzeilig(werte.art) || 'unbekannt'}  `,
    `**Gemeldet von:** @${einzeilig(issue.user?.login) || 'unbekannt'}  `,
    `${ort.join(' · ')}  `,
    `**Eingang:** GitHub-Issue #${issue.number}`,
  ].join('\n');

  const fuss = `\n\n---\n\n${kontext}`;
  let text = abschnitte.join('\n\n');
  const platz = BESCHREIBUNG_MAX - fuss.length;
  if (text.length > platz) {
    const hinweis = '\n\n… gekürzt, vollständig im Issue.';
    text = text.slice(0, platz - hinweis.length) + hinweis;
  }

  const titel = einzeilig(issue.title, TITEL_MAX) || `Rückmeldung #${issue.number}`;
  return {
    external_id: `github-issue-${issue.number}`,
    title: titel,
    description: text + fuss,
    links: [{ url: issue.html_url, title: `GitHub-Issue #${issue.number}` }],
  };
}

/**
 * Schickt den Einwurf an Zunder. Ergebnis `{ ok, status, ref?, fehler? }`; wirft nie, damit der
 * Aufrufer das Issue in jedem Fall kennzeichnen kann.
 */
export async function einwerfen(einwurf, { zunderUrl, token, abruf = fetch }) {
  if (!zunderUrl || !token) {
    return { ok: false, status: 0, fehler: 'ZUNDER_URL oder ZUNDER_EINGANG_TOKEN fehlt.' };
  }
  const adresse = `${zunderUrl.replace(/\/+$/, '')}/intake/v1/tasks`;
  let antwort;
  try {
    antwort = await abruf(adresse, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(einwurf),
    });
  } catch (fehler) {
    return { ok: false, status: 0, fehler: `Zunder nicht erreichbar: ${fehler?.message ?? fehler}` };
  }
  let daten = null;
  try {
    daten = await antwort.json();
  } catch {
    // kein JSON: Status reicht für die Meldung
  }
  if (antwort.status === 200 || antwort.status === 201) {
    return { ok: true, status: antwort.status, ref: daten?.ref ?? null };
  }
  const grund = daten?.message ?? daten?.error ?? '';
  return { ok: false, status: antwort.status, fehler: `Zunder antwortet ${antwort.status} ${grund}`.trim() };
}

/** Setzt Labels am Issue; fehlende Labels legt GitHub dabei an. */
export async function kennzeichnen({ repo, nummer, labels, ghToken, abruf = fetch }) {
  const antwort = await abruf(`https://api.github.com/repos/${repo}/issues/${nummer}/labels`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ labels }),
  });
  if (!antwort.ok) throw new Error(`GitHub antwortet ${antwort.status} beim Setzen der Labels.`);
}

async function main() {
  const umgebung = process.env;
  const event = JSON.parse(readFileSync(umgebung.GITHUB_EVENT_PATH, 'utf8'));
  const issue = event.issue;
  const einwurf = baueEinwurf(issue);
  if (einwurf === null) {
    console.log(`::notice::Issue #${issue?.number} stammt nicht aus dem Formular, nichts eingeworfen.`);
    return;
  }
  const ergebnis = await einwerfen(einwurf, {
    zunderUrl: umgebung.ZUNDER_URL,
    token: umgebung.ZUNDER_EINGANG_TOKEN,
  });
  const labels = ['rückmeldung', ergebnis.ok ? 'aufgenommen' : 'nicht-aufgenommen'];
  await kennzeichnen({
    repo: umgebung.GITHUB_REPOSITORY,
    nummer: issue.number,
    labels,
    ghToken: umgebung.GH_TOKEN,
  });
  if (!ergebnis.ok) {
    console.log(`::error::Issue #${issue.number} nicht eingeworfen: ${ergebnis.fehler}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Issue #${issue.number} eingeworfen als ${ergebnis.ref ?? '(ohne Kennung)'} (${ergebnis.status}).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((fehler) => {
    console.log(`::error::${fehler?.message ?? fehler}`);
    process.exitCode = 1;
  });
}
