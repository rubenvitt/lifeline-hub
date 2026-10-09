#!/usr/bin/env node
/**
 * PR-Kommentare nach der Freigabe eines Releases (LFH-1054).
 *
 *   GH_TOKEN=… node scripts/release/pr-kommentare.mjs --tag v1.0.0-alpha.99 --repo owner/name
 *
 * Aufgerufen vom Job `freigeben` in `.github/workflows/artefakte.yml`, NACHDEM der Entwurf
 * veröffentlicht ist; der Selbsttest (`pr-kommentare.test.mjs`) läuft in Schritt 8 von
 * `scripts/check-all.sh`. Braucht einen Checkout mit voller Historie (`git rev-list`).
 *
 * Die Rückrichtung des Changelogs: wer eine Änderung sucht, landet über die Suche zuerst beim PR.
 *
 * WARUM NICHT MEHR `@semantic-release/github`: das Release entsteht als Entwurf
 * (`draftRelease`), das Plugin kommentiert aber trotzdem sofort und verlinkt den für alle
 * anderen unsichtbaren Entwurf — auch wenn der Bau danach rot wird und das Release nie erscheint.
 *
 * GERECHNET WIRD SEIT DEM LETZTEN VERÖFFENTLICHTEN RELEASE DESSELBEN KANALS, nicht seit dem
 * letzten Tag: blieb ein Release nach rotem Bau Entwurf, sind seine PRs im nächsten grünen
 * enthalten und werden dort kommentiert. Kommentiert wird jeder gemergte PR, dessen
 * Merge-Commit in diesem Bereich liegt — wie beim Plugin also auch zweimal je PR im Normalfall
 * (Vorabversion auf `alpha`, dann stabil nach `alpha → main`).
 *
 * KEIN PR ZWEIMAL ZUM SELBEN TAG: der Text trägt eine unsichtbare Marke mit dem Tag; liegt sie
 * schon am PR, entfällt der Kommentar. Ein wiederholter Freigabe-Job ist damit harmlos.
 *
 * FEHLER MACHEN DEN LAUF NICHT ROT: das Release ist schon veröffentlicht, ein roter Job hieße
 * nur „Re-run" ohne Wirkung auf das Release. Jeder Fehler steht als `::warning::` im Protokoll.
 * Issues, die ein PR per Schlüsselwort schließt, kommentiert das Skript nicht (die Aufgaben
 * liegen in ClickUp).
 */
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const TAG_MUSTER = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/;
const SHA_MUSTER = /^[0-9a-f]{40}$/;

function zerlege(tag) {
  const treffer = TAG_MUSTER.exec(tag);
  if (!treffer) {
    throw new Error(`Kein zulässiger Release-Tag: '${tag}' (erwartet vX.Y.Z[-vorab]).`);
  }
  const [, major, minor, patch, vorab] = treffer;
  return { kern: [major, minor, patch].map(Number), vorab: vorab ? vorab.split('.') : [] };
}

/** `null` für ein stabiles Tag, sonst der Kanal (`alpha`, `beta`). */
export function kanalVon(tag) {
  const { vorab } = zerlege(tag);
  return vorab.length ? vorab[0] : null;
}

/** SemVer-Reihenfolge zweier Tags: < 0, 0, > 0. */
export function vergleicheVersion(a, b) {
  const x = zerlege(a);
  const y = zerlege(b);
  for (let i = 0; i < 3; i += 1) {
    if (x.kern[i] !== y.kern[i]) return x.kern[i] - y.kern[i];
  }
  // Ohne Vorabkennung ist eine Version größer als jede Vorabversion desselben Kerns.
  if (!x.vorab.length || !y.vorab.length) return y.vorab.length - x.vorab.length;
  for (let i = 0; i < Math.max(x.vorab.length, y.vorab.length); i += 1) {
    const p = x.vorab[i];
    const q = y.vorab[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const zahlP = /^\d+$/.test(p);
    const zahlQ = /^\d+$/.test(q);
    if (zahlP && zahlQ && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (zahlP !== zahlQ) return zahlP ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Tag des jüngsten veröffentlichten Releases desselben Kanals vor `tag`, sonst `null`. */
export function vorgaenger({ tag, releases }) {
  const kanal = kanalVon(tag);
  let bester = null;
  for (const { tag_name: kandidat, draft } of releases) {
    if (draft || !TAG_MUSTER.test(kandidat) || kanalVon(kandidat) !== kanal) continue;
    if (vergleicheVersion(kandidat, tag) >= 0) continue;
    if (!bester || vergleicheVersion(kandidat, bester) > 0) bester = kandidat;
  }
  return bester;
}

const marke = (tag) => `<!-- lifeline-release:${tag} -->`;

/** Der Kommentar — Wortlaut wie zuvor `SUCCESS_COMMENT_TEMPLATE` in release.config.mjs. */
export function kommentarText({ tag, repo }) {
  const kanal = kanalVon(tag);
  const ziel = `[${tag}](https://github.com/${repo}/releases/tag/${tag})`;
  const satz = kanal
    ? `Dieser Pull Request ist in der Vorabversion ${ziel} enthalten (Kanal \`${kanal}\`).`
    : `Dieser Pull Request ist in Version ${ziel} enthalten.`;
  const nachsatz = kanal
    ? '\n\nEine stabile Version entsteht erst, wenn dieser Stand nach `main` gemergt wird.'
    : '';
  return `🚀 ${satz}${nachsatz}\n\n${marke(tag)}`;
}

/**
 * Der Ablauf, mit allen Zugriffen nach außen als Parameter.
 *
 * `prsZuCommits(shas)` liefert je zugeordnetem PR `{ number, merged, mergeCommit, kommentare }`
 * (`kommentare`: die Texte der jüngsten Kommentare), Doppelte sind erlaubt.
 */
export async function kommentiereRelease({
  tag,
  repo,
  releases,
  commitsImBereich,
  prsZuCommits,
  kommentieren,
  warnen,
  melden,
}) {
  const von = vorgaenger({ tag, releases: await releases() });
  melden(`Bereich: ${von ?? '(Anfang)'} .. ${tag}`);
  const shas = await commitsImBereich(von, tag);
  const imBereich = new Set(shas);
  const ergebnis = { kommentiert: 0, vorhanden: 0, fehler: 0 };
  if (!shas.length) return ergebnis;

  const gesehen = new Set();
  const text = kommentarText({ tag, repo });
  for (const pr of await prsZuCommits(shas)) {
    if (gesehen.has(pr.number)) continue;
    // Merge-Commit im Bereich: ein PR, dessen Commits nur zufällig auch hier liegen (etwa ein
    // Rückport), gehört nicht zu diesem Release.
    if (!pr.merged || !imBereich.has(pr.mergeCommit)) continue;
    gesehen.add(pr.number);
    if (pr.kommentare.some((k) => k.includes(marke(tag)))) {
      ergebnis.vorhanden += 1;
      continue;
    }
    try {
      await kommentieren(pr.number, text);
      ergebnis.kommentiert += 1;
    } catch (fehler) {
      ergebnis.fehler += 1;
      warnen(`Kommentar an #${pr.number} gescheitert: ${fehler.message}`);
    }
  }
  return ergebnis;
}

// ── Zugriffe auf Git und GitHub ─────────────────────────────────────────────────────────

function gitBereich(von, bis) {
  const bereich = von ? `${von}..${bis}` : bis;
  const ausgabe = execFileSync('git', ['rev-list', bereich], { encoding: 'utf8' });
  return ausgabe.split('\n').filter((zeile) => SHA_MUSTER.test(zeile));
}

function github({ token, repo }) {
  const kopf = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const anfrage = async (pfad, optionen = {}, nochmal = true) => {
    const antwort = await fetch(`https://api.github.com${pfad}`, { ...optionen, headers: kopf });
    // Sekundäre Ratenbegrenzung beim Kommentieren vieler PRs (erstes stabiles Release): einmal
    // so lange warten, wie GitHub sagt, höchstens eine Minute.
    const warte = Number(antwort.headers.get('retry-after'));
    if (nochmal && (antwort.status === 403 || antwort.status === 429) && warte > 0) {
      await new Promise((r) => setTimeout(r, Math.min(warte, 60) * 1000));
      return anfrage(pfad, optionen, false);
    }
    if (!antwort.ok) {
      throw new Error(`${antwort.status} ${(await antwort.text()).slice(0, 200)}`);
    }
    return antwort.json();
  };
  const [owner, name] = repo.split('/');

  return {
    async releases() {
      const alle = [];
      for (let seite = 1; ; seite += 1) {
        const teil = await anfrage(`/repos/${repo}/releases?per_page=100&page=${seite}`);
        alle.push(...teil);
        if (teil.length < 100) return alle;
      }
    },
    async prsZuCommits(shas) {
      const prs = [];
      for (let i = 0; i < shas.length; i += 100) {
        const felder = shas
          .slice(i, i + 100)
          .map(
            (sha, j) => `c${j}: object(oid: "${sha}") { ... on Commit {
              associatedPullRequests(first: 10) { nodes {
                number merged mergeCommit { oid } comments(last: 50) { nodes { body } }
              } } } }`,
          )
          .join('\n');
        const { data, errors } = await anfrage('/graphql', {
          method: 'POST',
          body: JSON.stringify({
            query: `query($owner: String!, $name: String!) {
              repository(owner: $owner, name: $name) { ${felder} } }`,
            variables: { owner, name },
          }),
        });
        if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '));
        for (const commit of Object.values(data.repository)) {
          for (const pr of commit?.associatedPullRequests?.nodes ?? []) {
            prs.push({
              number: pr.number,
              merged: pr.merged,
              mergeCommit: pr.mergeCommit?.oid ?? null,
              kommentare: pr.comments.nodes.map((k) => k.body),
            });
          }
        }
      }
      return prs;
    },
    async kommentieren(nummer, body) {
      await anfrage(`/repos/${repo}/issues/${nummer}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { tag: { type: 'string' }, repo: { type: 'string' } },
  });
  const { tag, repo } = values;
  const token = process.env.GH_TOKEN;
  if (!tag || !repo || !token || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error('Aufruf: GH_TOKEN=… pr-kommentare.mjs --tag vX.Y.Z[-vorab] --repo owner/name');
    process.exit(2);
  }
  kanalVon(tag); // bricht bei einem unzulässigen Tag ab, bevor git oder GitHub ihn sehen
  const gh = github({ token, repo });
  try {
    const ergebnis = await kommentiereRelease({
      tag,
      repo,
      releases: gh.releases,
      commitsImBereich: async (von, bis) => gitBereich(von, bis),
      prsZuCommits: gh.prsZuCommits,
      kommentieren: gh.kommentieren,
      warnen: (text) => console.log(`::warning::${text}`),
      melden: (text) => console.log(text),
    });
    console.log(
      `PR-Kommentare zu ${tag}: ${ergebnis.kommentiert} neu, ${ergebnis.vorhanden} schon vorhanden, ${ergebnis.fehler} gescheitert.`,
    );
  } catch (fehler) {
    console.log(`::warning::PR-Kommentare zu ${tag} nicht geschrieben: ${fehler.message}`);
  }
}
