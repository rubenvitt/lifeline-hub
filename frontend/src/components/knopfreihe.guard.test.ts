/**
 * Knopfreihen-Wächter (LLH-1973, ADR-0070): zwei oder mehr Knöpfe nebeneinander stehen in
 * `Knopfreihe`, nicht in einem `<Space>`. Regel: `frontend/AGENTS.md`, „Aktionen“, „Knopfreihen
 * über `Knopfreihe`“.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Der Abstand eines `<Space>` hängt daran, ob die Stelle an `size` denkt: ohne `size` stehen die
 * Knöpfe 4 / 4 / 8 px auseinander (antd `paddingXS` = Raster `xs`), ein roter Knopf damit bündig
 * neben einem neutralen. `Knopfreihe` setzt fest `md` und lässt keinen anderen Abstand zu. Sie
 * löst die Wächter `aktionsabstand` (LFH-363) und `aktionenSpace` (LLH-1273) ab.
 *
 * ── Ratsche ─────────────────────────────────────────────────────────────────────
 * Der Bestand steht je Datei in `knopfreihe.schuld.ts`. Die Zahl darf nur sinken, eine neue Datei
 * kommt nicht hinzu; eine gesunkene Zahl wird im selben Commit nachgetragen.
 *
 * ── Was dieser Wächter NICHT sieht ──────────────────────────────────────────────
 *   • Knöpfe, die als Variable in die Reihe kommen (`{aktionen}`, `weitere.map(…)`);
 *   • Reihen aus `Flex`, `Stapel richtung="zeile"` oder einem `div` mit `gap`;
 *   • Knöpfe außer `<Button>` und der FMS-`<StatusWahl>`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KNOPFREIHE_SCHULD } from './knopfreihe.schuld';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function tsxDateien(ordner: string): string[] {
  return readdirSync(ordner).flatMap((name) => {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) return tsxDateien(pfad);
    return pfad.endsWith('.tsx') && !/\.(test|stories)\.tsx$/.test(pfad) ? [pfad] : [];
  });
}

/** Blendet Kommentarinhalt aus, Blockzustand über Zeilengrenzen getragen. */
function ohneKommentare(inhalt: string): string {
  const zeilen: string[] = [];
  let imBlock = false;
  for (const roh of inhalt.split('\n')) {
    let rest = roh;
    let sichtbar = '';
    while (rest.length > 0) {
      if (imBlock) {
        const ende = rest.indexOf('*/');
        if (ende === -1) break;
        imBlock = false;
        rest = rest.slice(ende + 2);
        continue;
      }
      const block = rest.indexOf('/*');
      const einzeilig = rest.indexOf('//');
      if (block === -1 && einzeilig === -1) {
        sichtbar += rest;
        break;
      }
      if (einzeilig !== -1 && (block === -1 || einzeilig < block)) {
        sichtbar += rest.slice(0, einzeilig);
        break;
      }
      sichtbar += rest.slice(0, block);
      rest = rest.slice(block + 2);
      imBlock = true;
    }
    zeilen.push(sichtbar);
  }
  return zeilen.join('\n');
}

/** Ende des öffnenden JSX-Tags ab `start`; zählt Klammern, damit `=>` das Tag nicht beendet. */
function tagEnde(text: string, start: number): number {
  let tiefe = 0;
  let anfuehrung: string | null = null;
  for (let i = start; i < text.length; i++) {
    const z = text[i];
    if (anfuehrung) {
      if (z === '\\') i++;
      else if (z === anfuehrung) anfuehrung = null;
      continue;
    }
    if (z === '"' || z === "'" || z === '`') anfuehrung = z;
    else if (z === '{') tiefe++;
    else if (z === '}') tiefe--;
    else if (z === '>' && tiefe === 0) return i;
  }
  return -1;
}

/**
 * Zeilen aller waagerechten `<Space>`, die zwei oder mehr Knöpfe tragen. Ein Knopf zählt für den
 * nächsten umschließenden `<Space>` bzw. `<Space.Compact>` (Stack), auch wenn ein anderes Element
 * dazwischen steht; `Space.Compact` selbst zählt nie (verbundene Knöpfe, keine Reihe).
 */
export function knopfreihenIn(quelltext: string): number[] {
  const text = ohneKommentare(quelltext);
  const offen: { zeile: number; knoepfe: number; zaehlt: boolean }[] = [];
  const fertig: number[] = [];
  const muster =
    /<Space\.Compact(?=[\s/>{])|<\/Space\.Compact>|<Space(?=[\s/>{])|<\/Space>|<Button(?=[\s/>{])|<StatusWahl(?=[\s/>{<])/g;
  for (const treffer of text.matchAll(muster)) {
    const start = treffer.index;
    if (treffer[0] === '</Space>' || treffer[0] === '</Space.Compact>') {
      const reihe = offen.pop();
      if (reihe && reihe.zaehlt && reihe.knoepfe >= 2) fertig.push(reihe.zeile);
      continue;
    }
    const ende = tagEnde(text, start);
    if (ende === -1) continue;
    const tag = text.slice(start, ende + 1);
    const istSpace = treffer[0] === '<Space' || treffer[0] === '<Space.Compact';
    if (!istSpace) {
      const innerste = offen[offen.length - 1];
      if (innerste) innerste.knoepfe += 1;
      continue;
    }
    if (tag.endsWith('/>')) continue;
    offen.push({
      zeile: text.slice(0, start).split('\n').length,
      knoepfe: 0,
      zaehlt:
        treffer[0] === '<Space' &&
        !/\b(?:orientation|direction)\s*=\s*\{?\s*["']vertical["']/.test(tag),
    });
  }
  return fertig.sort((a, b) => a - b);
}

export function befunde(
  dateien: Record<string, string>,
  schuld: Readonly<Record<string, number>>,
): string[] {
  const meldungen: string[] = [];
  const pfade = new Set([...Object.keys(dateien), ...Object.keys(schuld)]);
  for (const pfad of [...pfade].sort()) {
    const zeilen = pfad in dateien ? knopfreihenIn(dateien[pfad]) : [];
    const erlaubt = schuld[pfad] ?? 0;
    if (zeilen.length > erlaubt) {
      meldungen.push(
        `${pfad}:${zeilen.join(',')}  ${zeilen.length} Knopfreihe(n) aus <Space>, Schuld ${erlaubt}: Knopfreihe nehmen`,
      );
    } else if (zeilen.length < erlaubt) {
      meldungen.push(
        zeilen.length === 0
          ? `${pfad}  keine Knopfreihe aus <Space> mehr: Eintrag in knopfreihe.schuld.ts streichen`
          : `${pfad}  Schuld auf ${zeilen.length} senken (steht auf ${erlaubt})`,
      );
    }
  }
  return meldungen;
}

describe('Knopfreihen-Wächter (LLH-1973)', () => {
  const dateien = Object.fromEntries(
    tsxDateien(SRC).map((p) => [relative(SRC, p), readFileSync(p, 'utf8')] as const),
  );

  it('keine Knopfreihe aus <Space> über der Schuld, und die Schuld ist auf dem Stand', () => {
    const meldungen = befunde(dateien, KNOPFREIHE_SCHULD);
    expect(meldungen, meldungen.join('\n')).toEqual([]);
  });

  it('sieht den Baum wirklich — sonst ist der Wächter eine Attrappe', () => {
    expect(Object.keys(dateien).length).toBeGreaterThan(300);
    expect(dateien['components/instrument/Knopfreihe.tsx']).toContain('export default function');
  });

  describe('Selbstbeweise', () => {
    it('zählt zwei Knöpfe in einem Space als eine Reihe', () => {
      expect(knopfreihenIn('<Space><Button>A</Button><Button danger>B</Button></Space>')).toEqual([
        1,
      ]);
    });

    it('zählt einen einzelnen Knopf nicht', () => {
      expect(knopfreihenIn('<Space wrap><Button>A</Button><span /></Space>')).toEqual([]);
    });

    it('zählt senkrechte Space und Space.Compact nicht', () => {
      expect(
        knopfreihenIn('<Space orientation="vertical"><Button>A</Button><Button>B</Button></Space>'),
      ).toEqual([]);
      expect(
        knopfreihenIn('<Space direction="vertical"><Button>A</Button><Button>B</Button></Space>'),
      ).toEqual([]);
      expect(
        knopfreihenIn('<Space.Compact><Button>A</Button><Button>B</Button></Space.Compact>'),
      ).toEqual([]);
    });

    it('zählt Knöpfe in einem Space.Compact innerhalb eines Space nicht als Reihe', () => {
      const quelle =
        '<Space wrap><Space.Compact><Button>A</Button><Button>B</Button></Space.Compact></Space>';
      expect(knopfreihenIn(quelle)).toEqual([]);
    });

    it('zählt je unmittelbar umschließendem Space', () => {
      const quelle = [
        '<Space>',
        '<Button>A</Button>',
        '<Space><Button>B</Button></Space>',
        '</Space>',
      ].join('\n');
      expect(knopfreihenIn(quelle)).toEqual([]);
    });

    it('zählt die StatusWahl als Knopf und übersteht eine Pfeilfunktion im Tag', () => {
      const quelle =
        '<Space><StatusWahl<number> onWaehlen={(s) => tu(s)} /><Button onClick={() => x()}>A</Button></Space>';
      expect(knopfreihenIn(quelle)).toEqual([1]);
    });

    it('übersieht eine Reihe im Kommentar', () => {
      expect(knopfreihenIn('// <Space><Button>A</Button><Button>B</Button></Space>')).toEqual([]);
    });

    it('über der Schuld ist rot, getroffen grün, unterschritten rot', () => {
      const zwei = {
        'x.tsx': '<Space><Button/><Button/></Space><Space><Button/><Button/></Space>',
      };
      expect(befunde(zwei, {})).toHaveLength(1);
      expect(befunde(zwei, { 'x.tsx': 1 })).toHaveLength(1);
      expect(befunde(zwei, { 'x.tsx': 2 })).toEqual([]);
      expect(befunde(zwei, { 'x.tsx': 3 })[0]).toContain('auf 2 senken');
      expect(befunde({ 'x.tsx': '' }, { 'x.tsx': 1 })[0]).toContain('streichen');
    });
  });
});
