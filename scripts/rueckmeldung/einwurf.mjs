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

/** Überschrift hinter den Feldern: das Pflicht-Häkchen „Öffentlich“. */
const SCHLUSS = 'Öffentlich';

/**
 * Markiert ab `von` die Zeilen, die in einem Markdown-Codeblock (``` oder ~~~) liegen, die
 * Zäune eingeschlossen. Eine Feldüberschrift von GitHub steht nie in einem Codeblock.
 */
function codeZeilen(zeilen, von) {
  const markiert = new Array(zeilen.length).fill(false);
  let zaun = null;
  for (let nr = von; nr < zeilen.length; nr += 1) {
    const treffer = /^ {0,3}(`{3,}|~{3,})/.exec(zeilen[nr]);
    if (zaun === null) {
      if (treffer) {
        zaun = treffer[1];
        markiert[nr] = true;
      }
      continue;
    }
    markiert[nr] = true;
    const schluss = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(zeilen[nr]);
    if (schluss && schluss[1][0] === zaun[0] && schluss[1].length >= zaun.length) zaun = null;
  }
  return markiert;
}

/**
 * Zerlegt den Text eines Formular-Issues in `id → Wert`. Felder, die fehlen oder leer blieben,
 * sind `''`. Gibt `null` zurück, wenn der Text nicht aus dem Formular stammt (Art, Version und
 * Beschreibung fehlen).
 *
 * GitHub schreibt alle Felder in ihrer Reihenfolge, jedes mit seiner Überschrift. Vor der
 * Beschreibung stehen nur einzeilige Felder (Auswahl, Eingabe); ihre Überschriften und die der
 * Beschreibung werden von vorn gesucht. Hinter der Beschreibung liegen die übrigen Textfelder und
 * das Häkchen „Öffentlich“; sie werden von hinten gesucht, höchstens bis zur Beschreibung. Eine
 * `###`-Zeile in einer Antwort, auch mit dem Namen eines Feldes, bleibt so Text. Hinten zählen
 * Überschriften in Codeblöcken nur, wenn außerhalb keine passende steht (offener Zaun). Mehrdeutig
 * bleibt nur eine Feldüberschrift der hinteren Textfelder außerhalb eines Codeblocks in deren
 * eigenen Antworten: Dann landet Text im Textfeld davor, geht aber nie verloren.
 */
export function zerlegeFormular(text) {
  const zeilen = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const ist = (stelle, label) => zeilen[stelle].trimEnd() === `### ${label}`;
  const vorn = [FELDER.art, FELDER.version, FELDER.oberflaeche, FELDER.seite, FELDER.beschreibung];
  const hinten = [FELDER.schritte, FELDER.erwartet, SCHLUSS];
  const koepfe = [];

  let stelle = 0;
  for (const label of vorn) {
    let fund = stelle;
    while (fund < zeilen.length && !ist(fund, label)) fund += 1;
    if (fund === zeilen.length) continue;
    koepfe.push({ label, stelle: fund });
    stelle = fund + 1;
  }
  const untergrenze = stelle;
  const imCode = codeZeilen(zeilen, untergrenze);
  const sucheZurueck = (label, von, auchImCode) => {
    let fund = von;
    while (fund >= untergrenze && !(ist(fund, label) && (auchImCode || !imCode[fund]))) fund -= 1;
    return fund;
  };
  stelle = zeilen.length - 1;
  for (const label of [...hinten].reverse()) {
    let fund = sucheZurueck(label, stelle, false);
    if (fund < untergrenze) fund = sucheZurueck(label, stelle, true);
    if (fund < untergrenze) continue;
    koepfe.push({ label, stelle: fund });
    stelle = fund - 1;
  }

  koepfe.sort((a, b) => a.stelle - b.stelle);
  const abschnitte = new Map();
  koepfe.forEach(({ label, stelle: von }, nr) => {
    const bis = koepfe[nr + 1]?.stelle ?? zeilen.length;
    abschnitte.set(label, zeilen.slice(von + 1, bis).join('\n').trim());
  });

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

/** Frist je Anfrage (inklusive Antwortkörper) und Versuche beim Zunder-Eingang. */
export const FRIST_MS = 20_000;
export const VERSUCHE = 3;
/** Längste Wartezeit aus `Retry-After`, die noch abgewartet wird; sonst gleich aufgeben. */
const WARTE_MAX_MS = 30_000;

/** Wartet `ms` Millisekunden. */
const schlafen = (ms) => new Promise((fertig) => setTimeout(fertig, ms));

/**
 * `Retry-After` in Millisekunden: Sekunden oder HTTP-Datum (RFC 9110). `null`, wenn der Kopf
 * fehlt oder ungültig ist; ein Datum in der Vergangenheit ergibt 0.
 */
export function warteAus(kopf, jetzt = Date.now()) {
  const wert = String(kopf ?? '').trim();
  if (!wert) return null;
  if (/^\d+$/.test(wert)) return Number(wert) * 1000;
  const datum = Date.parse(wert);
  return Number.isFinite(datum) ? Math.max(0, datum - jetzt) : null;
}

/**
 * Ein Versuch: `{ status, daten, warteMs }`, Status 0 bei Netzfehler oder abgelaufener Frist
 * (dann mit `grund`). `gegenueber` nennt die Gegenstelle in der Meldung.
 */
async function versuch(adresse, optionen, abruf, frist, gegenueber) {
  try {
    const antwort = await abruf(adresse, { ...optionen, signal: AbortSignal.timeout(frist) });
    let daten = null;
    try {
      daten = await antwort.json();
    } catch (fehler) {
      // kein JSON reicht, eine abgelaufene Frist beim Lesen nicht
      if (fehler?.name === 'TimeoutError' || fehler?.name === 'AbortError') throw fehler;
    }
    return { status: antwort.status, daten, warteMs: warteAus(antwort.headers?.get?.('retry-after')) };
  } catch (fehler) {
    const grund = fehler?.name === 'TimeoutError' ? `keine Antwort in ${frist / 1000} s` : (fehler?.message ?? fehler);
    return { status: 0, daten: null, warteMs: null, grund: `${gegenueber} nicht erreichbar: ${grund}` };
  }
}

/**
 * Wiederholt `versuch`, solange der Fehler vorübergehend ist: Netzfehler, Frist, 5xx und 429 mit
 * gültigem, kurzem `Retry-After` (ohne Angabe wäre jeder Versuch geraten). Höchstens `versuche`
 * Versuche; `fertig(status)` sagt, welcher Status kein Fehler ist. Liefert den letzten Versuch.
 */
async function wiederholt(adresse, optionen, { abruf, frist, versuche, warte, gegenueber, fertig }) {
  let letzter;
  for (let nr = 1; nr <= versuche; nr += 1) {
    letzter = await versuch(adresse, optionen, abruf, frist, gegenueber);
    const { status, warteMs } = letzter;
    if (fertig(status)) return letzter;
    const kurzGedrosselt = status === 429 && warteMs !== null && warteMs <= WARTE_MAX_MS;
    const voruebergehend = status === 0 || status >= 500 || kurzGedrosselt;
    if (!voruebergehend || nr === versuche) break;
    await warte(status === 429 ? warteMs : 2_000 * nr);
  }
  return letzter;
}

/**
 * Schickt den Einwurf an Zunder. Ergebnis `{ ok, status, ref?, fehler? }`; wirft nie, damit der
 * Aufrufer das Issue in jedem Fall kennzeichnen kann.
 *
 * Jeder Versuch hat eine Frist (`FRIST_MS`, inklusive Antwortkörper), wiederholt wird nur
 * Vorübergehendes (`wiederholt`). Höchstens `VERSUCHE` Versuche, zusammen gut eine Minute, damit
 * im 5-Minuten-Job Zeit für die Kennzeichnung bleibt. Wiederholen ist sicher, weil
 * `external_id` den Einwurf idempotent macht.
 */
export async function einwerfen(
  einwurf,
  { zunderUrl, token, abruf = fetch, frist = FRIST_MS, versuche = VERSUCHE, warte = schlafen },
) {
  if (!zunderUrl || !token) {
    return { ok: false, status: 0, fehler: 'ZUNDER_URL oder ZUNDER_EINGANG_TOKEN fehlt.' };
  }
  const adresse = `${zunderUrl.replace(/\/+$/, '')}/intake/v1/tasks`;
  const optionen = {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(einwurf),
  };
  const fertig = (status) => status === 200 || status === 201;
  const { status, daten, grund } = await wiederholt(adresse, optionen, {
    abruf,
    frist,
    versuche,
    warte,
    gegenueber: 'Zunder',
    fertig,
  });
  if (fertig(status)) return { ok: true, status, ref: daten?.ref ?? null };
  const fehler = grund ?? `Zunder antwortet ${status} ${daten?.message ?? daten?.error ?? ''}`.trim();
  return { ok: false, status, fehler };
}

export const STATUS_LABELS = ['aufgenommen', 'nicht-aufgenommen'];

/**
 * Setzt Labels am Issue (fehlende legt GitHub dabei an) und nimmt `entfernen` ab, falls
 * vorhanden. So steht nach einem Re-run nur der letzte Status am Issue; übrige Labels bleiben.
 * Frist und Wiederholung wie beim Einwurf; beide Anfragen sind idempotent. Wirft, wenn eine
 * Anfrage endgültig scheitert.
 */
export async function kennzeichnen({
  repo,
  nummer,
  labels,
  entfernen = [],
  ghToken,
  abruf = fetch,
  frist = FRIST_MS,
  versuche = VERSUCHE,
  warte = schlafen,
}) {
  const basis = `https://api.github.com/repos/${repo}/issues/${nummer}/labels`;
  const kopf = {
    Authorization: `Bearer ${ghToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const art = { abruf, frist, versuche, warte, gegenueber: 'GitHub' };
  const gesetzt = await wiederholt(
    basis,
    { method: 'POST', headers: { ...kopf, 'Content-Type': 'application/json' }, body: JSON.stringify({ labels }) },
    { ...art, fertig: (status) => status >= 200 && status < 300 },
  );
  if (!(gesetzt.status >= 200 && gesetzt.status < 300)) {
    throw new Error(gesetzt.grund ?? `GitHub antwortet ${gesetzt.status} beim Setzen der Labels.`);
  }
  for (const name of entfernen) {
    // 404: das Label hing nicht am Issue
    const fertig = (status) => (status >= 200 && status < 300) || status === 404;
    const weg = await wiederholt(`${basis}/${encodeURIComponent(name)}`, { method: 'DELETE', headers: kopf }, {
      ...art,
      fertig,
    });
    if (!fertig(weg.status)) {
      throw new Error(weg.grund ?? `GitHub antwortet ${weg.status} beim Entfernen von „${name}“.`);
    }
  }
}

/** Workflow-Einstieg: Event lesen, einwerfen, Issue kennzeichnen, bei Fehler rot beenden. */
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
  const [ja, nein] = STATUS_LABELS;
  await kennzeichnen({
    repo: umgebung.GITHUB_REPOSITORY,
    nummer: issue.number,
    labels: ['rückmeldung', ergebnis.ok ? ja : nein],
    entfernen: [ergebnis.ok ? nein : ja],
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
