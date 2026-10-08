/**
 * Rückfrage-Guard (LFH-960): der rote Bestätigungsknopf einer Rückfrage nennt die Handlung
 * (`frontend/AGENTS.md`, Bedien-Leitlinie „Aktionen“, „Knöpfe nennen die Handlung“).
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Ohne `okText` sagt antds Bestätigungsknopf „OK“. Wer am Führungs-Tablet mit Handschuh daneben
 * tippt, bestätigt ein „Ja“ oder „OK“ reflexhaft; „BR stornieren“ hält ihn an.
 *
 * ── Was geprüft wird ────────────────────────────────────────────────────────────
 * Jede `<Popconfirm>` in einer `.tsx` unter `src/` (ohne Tests), deren Kopf `danger` trägt
 * (`okButtonProps={{ danger: true }}`), MUST ein `okText` haben, das nicht „Ja“, „OK“ oder „Ok“
 * lautet. Ausnahmen gibt es keine; die Altstellen sind abgebaut (LFH-1090).
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 *   • `modal.confirm(…)`, `Modal.confirm(…)` und `<Modal>`-Rückfragen;
 *   • Rückfragen ohne `danger` am Bestätigungsknopf;
 *   • ein `okText` aus Variable oder Ausdruck (gilt als benannt, außer einem Stringliteral);
 *   • ein Kopf mit `{...props}`, der `danger` oder `okText` erst zur Laufzeit trägt;
 *   • ein `okText` mit Bedingung (`{x ? 'Ja' : 'Weg'}`) gilt als benannt, `danger: istX` als rot;
 *   • `/*` oder ` //` in einem String: die Kommentarentfernung kennt keine Strings und schnitte
 *     dort ab (heute kommt beides in keiner `.tsx` vor).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Bestätigungstexte, die keine Handlung nennen (normalisiert: getrimmt, klein). */
const UNBENANNT = new Set(['ja', 'ok']);

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

/**
 * Köpfe aller `<Popconfirm …>`. Der Kopf endet am ersten `>` außerhalb von `{…}` und außerhalb
 * von Anführungszeichen — der Pfeil in `onConfirm={() => …}` beendet ihn nicht.
 */
export function koepfe(quelle: string): string[] {
  const text = ohneKommentare(quelle);
  const ergebnis: string[] = [];
  for (const treffer of text.matchAll(/<Popconfirm(?=[\s/>{])/g)) {
    let tiefe = 0;
    let anfuehrung: string | null = null;
    let i = treffer.index + treffer[0].length;
    for (; i < text.length; i += 1) {
      const z = text[i];
      if (anfuehrung) {
        if (z === '\\') i += 1;
        else if (z === anfuehrung) anfuehrung = null;
        continue;
      }
      if (z === '"' || z === "'" || z === '`') anfuehrung = z;
      else if (z === '{') tiefe += 1;
      else if (z === '}') tiefe -= 1;
      else if (z === '>' && tiefe === 0) break;
    }
    ergebnis.push(text.slice(treffer.index, i + 1));
  }
  return ergebnis;
}

/** Ein roter Kopf ohne benannten Bestätigungstext? */
export function unbenannt(kopf: string): boolean {
  if (!/\bdanger\b(?!\s*:\s*false\b)/.test(kopf)) return false;
  const ok = /\bokText\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:(['"`])([^'"`]*)\3\s*)?([^}]*)\})/.exec(
    kopf,
  );
  if (!ok) return true;
  const literal = ok[1] ?? ok[2] ?? ok[4];
  if (literal === undefined) return false; // Ausdruck: gilt als benannt
  return literal.trim() === '' || UNBENANNT.has(literal.trim().toLocaleLowerCase('de'));
}

export function funde(dateien: Record<string, string>): Record<string, number> {
  const ergebnis: Record<string, number> = {};
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    const anzahl = koepfe(inhalt).filter(unbenannt).length;
    if (anzahl > 0) ergebnis[pfad] = anzahl;
  }
  return ergebnis;
}

const dateien = lieseQuellen(SRC);

describe('Rote Rückfragen nennen die Handlung (LFH-960)', () => {
  it('der Scanner sieht die Rückfragen des Frontends', () => {
    const alle = Object.values(dateien).flatMap(koepfe);
    expect(alle.length).toBeGreaterThan(20);
    expect(alle.filter((k) => /\bdanger\b/.test(k)).length).toBeGreaterThan(10);
  });

  it('keine rote Rückfrage ohne Handlungstext', () => {
    expect(funde(dateien)).toEqual({});
  });

  // ── Selbstbeweise ─────────────────────────────────────────────────────────────
  it('färbt fehlendes okText, „Ja“ und „OK“ rot', () => {
    expect(unbenannt('<Popconfirm title="Weg?" okButtonProps={{ danger: true }}>')).toBe(true);
    expect(unbenannt('<Popconfirm okText="Ja" okButtonProps={{ danger: true }}>')).toBe(true);
    expect(unbenannt("<Popconfirm okText={'OK'} okButtonProps={{ danger: true }}>")).toBe(true);
    expect(unbenannt('<Popconfirm okText=" ok " okButtonProps={{ danger: true }}>')).toBe(true);
  });

  it('lässt benannte, ausgedrückte und nicht-rote Rückfragen in Ruhe', () => {
    expect(unbenannt('<Popconfirm okText="BR stornieren" okButtonProps={{ danger: true }}>')).toBe(
      false,
    );
    expect(unbenannt('<Popconfirm okText={text} okButtonProps={{ danger: true }}>')).toBe(false);
    expect(unbenannt('<Popconfirm title="Weg?">')).toBe(false);
    expect(unbenannt('<Popconfirm okButtonProps={{ danger: false }}>')).toBe(false);
  });

  it('der Pfeil im Kopf beendet ihn nicht, ein Kommentar zählt nicht', () => {
    const quelle = [
      '// <Popconfirm okButtonProps={{ danger: true }}>',
      '<Popconfirm onConfirm={() => weg()} okButtonProps={{ danger: true }} title="a > b">',
      '  <Button danger>Weg</Button>',
      '</Popconfirm>',
    ].join('\n');
    expect(koepfe(quelle)).toHaveLength(1);
    expect(funde({ x: quelle })).toEqual({ x: 1 });
    expect(funde({ x: quelle.replace('title=', 'okText="Weg" title=') })).toEqual({});
  });
});
