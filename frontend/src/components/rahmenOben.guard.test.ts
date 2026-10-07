/**
 * Rahmen-Guard (LFH-952, `frontend/AGENTS.md`, Rahmen): was oben klebt, hängt sich unter den
 * klebenden Rahmen.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Ab `md` klebt der Kopf am oberen Fensterrand, unter `md` im Störungsfall die Betriebszeile.
 * Ein weiteres Element mit `position: sticky; top: 0` im Dokument-Scroll klebte an derselben
 * Kante und läge unter dem Rahmen (der höher gestapelt ist): ein stehender Tabellenkopf, ein
 * Sammelbanner, eine Seitenleiste wären still verdeckt. Die Kante darunter ist
 * `var(--lfh-rahmen-oben)` (CSS) bzw. `useRahmenOben()` (rc-tables `offsetHeader`).
 *
 * ── Was geprüft wird ────────────────────────────────────────────────────────────
 *  1. Jedes `position: sticky` (TS-Objekt oder CSS) mit einem `top` in seiner Nähe nennt
 *     `--lfh-rahmen-oben` in demselben Fenster.
 *  2. Jede antd-Tabelle mit `sticky`-Prop setzt `offsetHeader`.
 * Ausgenommen sind der Rahmen selbst ({@link RAHMEN}) und Stellen mit dem Vermerk
 * `rahmen-oben: frei` samt Grund (etwa ein Element, das in einem eigenen Scrollcontainer klebt).
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 *  • ein `top`, das weiter als {@link FENSTER} Zeilen vom `sticky` entfernt steht;
 *  • ein klebendes Element, dessen Stil aus einer Variable oder einem Helfer kommt;
 *  • ob ein `top` mit `--lfh-rahmen-oben` richtig gerechnet ist — das misst
 *    `e2e/rahmen-stehen-bleiben.spec.ts` („Tabellenkopf unter dem Rahmen“).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Der Rahmen klebt selbst an der Fensterkante; er ist die Quelle der Höhe, nicht ihr Abnehmer. */
const RAHMEN = [
  'einsatz/EinsatzLayout.tsx',
  'components/AppLayout.tsx',
  'live/LiveStatusBanner.tsx',
];

/** Zeilen vor und nach einem `sticky`, in denen sein `top` steht. */
const FENSTER = 4;

const VERMERK = 'rahmen-oben: frei';

function dateien(verzeichnis: string): string[] {
  const aus: string[] = [];
  for (const name of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, name);
    if (statSync(pfad).isDirectory()) {
      if (name === 'test' || name === 'node_modules') continue;
      aus.push(...dateien(pfad));
    } else if (/\.(tsx?|css)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      aus.push(pfad);
    }
  }
  return aus;
}

const QUELLEN = dateien(SRC)
  .map((pfad) => ({ datei: relative(SRC, pfad), text: readFileSync(pfad, 'utf8') }))
  // Druckstile kleben nie am Bildschirm.
  .filter(({ datei }) => !datei.startsWith('druck/') && !datei.endsWith('Print.css'));

type Fund = { datei: string; zeile: number; text: string };

/** Klebende Elemente mit `top` im Fenster, die weder die Rahmenhöhe noch den Vermerk tragen. */
function klebendOhneRahmen(datei: string, text: string): Fund[] {
  const zeilen = text.split('\n');
  const funde: Fund[] = [];
  zeilen.forEach((zeile, i) => {
    if (!/position:\s*['"]?sticky\b/.test(zeile)) return;
    const fenster = zeilen.slice(Math.max(0, i - FENSTER), i + FENSTER + 1).join('\n');
    if (!/(^|[\s{,])top:/m.test(fenster)) return;
    if (fenster.includes('--lfh-rahmen-oben') || fenster.includes(VERMERK)) return;
    funde.push({ datei, zeile: i + 1, text: zeile.trim() });
  });
  return funde;
}

/** antd-Tabellen mit `sticky`-Prop ohne `offsetHeader`. */
function tabelleOhneVersatz(datei: string, text: string): Fund[] {
  if (!datei.endsWith('.tsx')) return [];
  const zeilen = text.split('\n');
  const funde: Fund[] = [];
  zeilen.forEach((zeile, i) => {
    // Das JSX-Prop allein auf seiner Zeile (`sticky`, `sticky={…}`), nicht ein Stilwert.
    if (!/^\s*sticky(=\{.*)?$/.test(zeile)) return;
    const fenster = zeilen.slice(Math.max(0, i - FENSTER), i + FENSTER + 1).join('\n');
    if (fenster.includes('offsetHeader') || fenster.includes(VERMERK)) return;
    funde.push({ datei, zeile: i + 1, text: zeile.trim() });
  });
  return funde;
}

describe('Rahmen-Guard (LFH-952)', () => {
  it('der Scanner erkennt ein klebendes `top: 0` und lässt die Rahmenhöhe durch (Gegenprobe)', () => {
    const roh = "<div style={{ position: 'sticky', top: 0 }} />";
    expect(klebendOhneRahmen('x.tsx', roh)).toHaveLength(1);
    const css = '.a {\n  position: sticky;\n  top: 0;\n}';
    expect(klebendOhneRahmen('x.css', css)).toHaveLength(1);
    const gut = "<div style={{ position: 'sticky', top: 'var(--lfh-rahmen-oben, 0px)' }} />";
    expect(klebendOhneRahmen('x.tsx', gut)).toHaveLength(0);
    const unten = "<div style={{ position: 'sticky', bottom: 0 }} />";
    expect(klebendOhneRahmen('x.tsx', unten)).toHaveLength(0);
    expect(tabelleOhneVersatz('x.tsx', '<Table\n  sticky\n/>')).toHaveLength(1);
    expect(tabelleOhneVersatz('x.tsx', '<Table\n  sticky={!druckt}\n/>')).toHaveLength(1);
    expect(
      tabelleOhneVersatz('x.tsx', '<Table\n  sticky={{ offsetHeader: rahmenOben }}\n/>'),
    ).toHaveLength(0);
  });

  it('jede Rahmen-Datei gibt es noch (sonst wäre die Ausnahme tot)', () => {
    const vorhanden = new Set(QUELLEN.map((q) => q.datei));
    for (const datei of RAHMEN) expect(vorhanden.has(datei), datei).toBe(true);
  });

  it('kein klebendes Element unter `src/` hängt an der Fensterkante statt unter dem Rahmen', () => {
    const funde = QUELLEN.filter(({ datei }) => !RAHMEN.includes(datei)).flatMap(
      ({ datei, text }) => [...klebendOhneRahmen(datei, text), ...tabelleOhneVersatz(datei, text)],
    );
    expect(funde.map((f) => `${f.datei}:${f.zeile} ${f.text}`)).toEqual([]);
  });
});
