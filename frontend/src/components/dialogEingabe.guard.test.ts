/**
 * Dialog-Eingabe-Guard (LLH-2010): ein handgebautes `<Modal>` mit Eingabe schließt nicht über die
 * Maske (`frontend/AGENTS.md`, „Erfassungs-Norm“).
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Ein Tap 60 px neben den Dialog am Tablet hat getippte Angaben still verworfen (LLH-1755).
 * `ErfassungsModal` sperrt die Maske selbst; ein eigenes `<Modal>` muss es ausdrücklich tun,
 * mit `mask={{ closable: false }}` oder über `useVerwerfenSchutz` (`{...x.modalProps}`), das
 * zusätzlich vor dem Verwerfen getippter Eingaben fragt.
 *
 * ── Was geprüft wird ────────────────────────────────────────────────────────────
 * Jedes `<Modal` in einer `.tsx` unter `src/` (ohne Tests), dessen Inhalt bis zum passenden
 * `</Modal>` ein Eingabeelement trägt (`<Form`, `<Input`, `TextArea`, `<InputNumber`, `<Select`,
 * `<Checkbox`, `<Feld`), MUST im Kopf `mask={{ closable: false }}` oder `{...<x>.modalProps}`
 * haben. Ausnahmen stehen mit Grund in `AUSNAHMEN`; ein Eintrag braucht im Review einen Grund,
 * der sagt, warum dort nichts verloren geht. Eine Schuldliste für „später“ gibt es nicht.
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 *   • Eingaben in einer Kindkomponente (`<MeinFormular />` im Modal): nur, was im Block steht;
 *   • `Modal.confirm(…)` und `modal.confirm(…)`;
 *   • einen Kopf mit `{...props}`, der die Maske erst zur Laufzeit sperrt;
 *   • ob die Rückfrage wirklich kommt: das belegen die Tests der Dialoge.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Dialoge, die zu Recht über die Maske schließen. Schlüssel: Pfad unter `src/` und Titel-Ausschnitt
 * (`datei#titel`), Wert: warum dort nichts verloren geht.
 */
const AUSNAHMEN: Record<string, string> = {
  'aufbewahrung/PersonensucheDialog.tsx#Person suchen':
    'Suche: ein Suchbegriff ist keine Eingabe, die verloren geht; tippt man ihn neu, ist nichts weg.',
  'command-palette/CommandPalette.tsx#?':
    'Sprungpalette: Suchfeld zum Springen, schließt gewollt mit jedem Weg hinaus.',
  'fernmeldewesen/skizze/SkizzenDialoge.tsx#ziel ? `Verbindung ${name':
    'Verbinden: Suche und Wahl einer Gegenstelle, nichts Getipptes außer dem Suchbegriff.',
};

const EINGABE = /<(?:Form|Input|Input\.TextArea|TextArea|InputNumber|Select|Checkbox|Feld)[\s>/.]/;
const GESPERRT = /\bmask=\{\{\s*closable:\s*false\s*\}\}|\{\s*\.\.\.\s*[\w.]+\.modalProps\s*\}/;

function lieseQuellen(verzeichnis: string, praefix = ''): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    const relativ = praefix ? `${praefix}/${eintrag.name}` : eintrag.name;
    if (eintrag.isDirectory()) Object.assign(treffer, lieseQuellen(pfad, relativ));
    else if (eintrag.name.endsWith('.tsx') && !eintrag.name.includes('.test.')) {
      treffer[relativ] = readFileSync(pfad, 'utf8');
    }
  }
  return treffer;
}

/** Kommentare entfernen; `//` nur am Zeilenanfang oder nach Leerraum (nicht in `https://`). */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** Ende des Kopfes ab `start`: erstes `>` außerhalb von `{…}` und Anführungszeichen. */
function kopfEnde(text: string, start: number): number {
  let tiefe = 0;
  let anfuehrung: string | null = null;
  for (let i = start; i < text.length; i += 1) {
    const z = text[i];
    if (anfuehrung) {
      if (z === '\\') i += 1;
      else if (z === anfuehrung) anfuehrung = null;
      continue;
    }
    if (z === '"' || z === "'" || z === '`') anfuehrung = z;
    else if (z === '{') tiefe += 1;
    else if (z === '}') tiefe -= 1;
    else if (z === '>' && tiefe === 0) return i;
  }
  return text.length - 1;
}

export interface ModalBlock {
  kopf: string;
  inhalt: string;
}

/** Alle `<Modal …>…</Modal>`-Blöcke einer Quelle; verschachtelte zählen einzeln. */
export function bloecke(quelle: string): ModalBlock[] {
  const text = ohneKommentare(quelle);
  const ergebnis: ModalBlock[] = [];
  for (const treffer of text.matchAll(/<Modal(?=[\s/>{])/g)) {
    const ende = kopfEnde(text, treffer.index + treffer[0].length);
    const kopf = text.slice(treffer.index, ende + 1);
    if (kopf.endsWith('/>')) {
      ergebnis.push({ kopf, inhalt: '' });
      continue;
    }
    // Inhalt bis zum passenden `</Modal>`; ein inneres `<Modal …>` erhöht die Tiefe.
    const muster = /<Modal(?=[\s/>{])|<\/Modal>/g;
    muster.lastIndex = ende + 1;
    let tiefe = 1;
    let schluss = text.length;
    for (let m = muster.exec(text); m; m = muster.exec(text)) {
      if (m[0] === '</Modal>') tiefe -= 1;
      else if (!text.slice(m.index, kopfEnde(text, m.index + 6) + 1).endsWith('/>')) tiefe += 1;
      if (tiefe === 0) {
        schluss = m.index;
        break;
      }
    }
    ergebnis.push({ kopf, inhalt: text.slice(ende + 1, schluss) });
  }
  return ergebnis;
}

/** Titel-Ausschnitt eines Kopfes, für Meldung und Ausnahmeschlüssel. */
function titel(kopf: string): string {
  const m = /\btitle=(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/.exec(kopf);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '?').trim().slice(0, 60);
}

/** Ein Block mit Eingabe, dessen Maske noch schließt? */
export function offen(block: ModalBlock): boolean {
  return EINGABE.test(block.inhalt) && !GESPERRT.test(block.kopf);
}

export function funde(dateien: Record<string, string>): string[] {
  const ergebnis: string[] = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    for (const block of bloecke(inhalt).filter(offen)) {
      const schluessel = `${pfad}#${titel(block.kopf)}`;
      if (!(schluessel in AUSNAHMEN)) ergebnis.push(schluessel);
    }
  }
  return ergebnis.sort();
}

const dateien = lieseQuellen(SRC);

describe('Dialoge mit Eingabe schließen nicht über die Maske (LLH-2010)', () => {
  it('der Scanner sieht die Dialoge des Frontends', () => {
    const alle = Object.values(dateien).flatMap(bloecke);
    expect(alle.length).toBeGreaterThan(50);
    expect(alle.filter((b) => EINGABE.test(b.inhalt)).length).toBeGreaterThan(5);
  });

  it('kein Dialog mit Eingabe, dessen Maske schließt', () => {
    expect(funde(dateien)).toEqual([]);
  });

  it('jede Ausnahme trifft noch einen Dialog', () => {
    const offeneSchluessel = new Set(
      Object.entries(dateien).flatMap(([pfad, inhalt]) =>
        bloecke(inhalt)
          .filter(offen)
          .map((b) => `${pfad}#${titel(b.kopf)}`),
      ),
    );
    expect(Object.keys(AUSNAHMEN).filter((k) => !offeneSchluessel.has(k))).toEqual([]);
  });

  // ── Selbstbeweise ─────────────────────────────────────────────────────────────
  it('meldet ein Modal mit Eingabe ohne Sperre', () => {
    const [b] = bloecke('<Modal open title="X" onCancel={zu}><Input value={v} /></Modal>');
    expect(offen(b)).toBe(true);
  });

  it('lässt gesperrte Maske, Schutz-Spread und Modals ohne Eingabe durch', () => {
    const gesperrt = bloecke(
      '<Modal open mask={{ closable: false }} onCancel={() => a > b}><Input /></Modal>',
    );
    const schutz = bloecke('<Modal open {...schutz.modalProps}><Input.TextArea /></Modal>');
    const ohne = bloecke('<Modal open title="Löschen?">Wirklich?</Modal>');
    expect([...gesperrt, ...schutz, ...ohne].map(offen)).toEqual([false, false, false]);
  });

  it('trennt verschachtelte Modals: der äußere Kopf zählt nicht für den inneren', () => {
    const b = bloecke(
      '<Modal open mask={{ closable: false }}><Input /><Modal open title="Innen"><Select /></Modal></Modal>',
    );
    expect(b.map(offen)).toEqual([false, true]);
  });
});
