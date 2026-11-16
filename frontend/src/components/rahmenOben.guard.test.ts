/**
 * Rahmen-Guard (LFH-952, `frontend/AGENTS.md`, Rahmen): was oben klebt, hängt sich unter den
 * klebenden Rahmen.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Der Kopf klebt am oberen Fensterrand, unter `md` im Störungsfall die Betriebszeile darüber.
 * Ein weiteres Element mit `position: sticky; top: 0` im Dokument-Scroll klebte an derselben
 * Kante und läge unter dem Rahmen (der höher gestapelt ist): ein stehender Tabellenkopf, ein
 * Sammelbanner, eine Seitenleiste wären still verdeckt. Die Kante darunter ist
 * `var(--lfh-rahmen-oben)` (CSS) bzw. `useRahmenOben()` (rc-tables `offsetHeader`).
 *
 * ── Was geprüft wird ────────────────────────────────────────────────────────────
 *  1. Jedes `position: sticky` (TS-Objekt oder CSS) mit einem `top` in seiner Nähe nennt
 *     `--lfh-rahmen-oben` in demselben Fenster; nur die Dateien in {@link KOPF_HOEHE_ERLAUBT}
 *     dürfen stattdessen die Kopfhöhe `--lfh-kopf-oben` nennen (zjt7c073 D2), und keine andere
 *     Datei nennt die Kopfhöhe überhaupt.
 *  2. Jede antd-Tabelle mit `sticky`-Prop setzt `offsetHeader`.
 * Ausgenommen sind der Rahmen selbst ({@link RAHMEN}) und Stellen mit dem Vermerk
 * `rahmen-oben: frei` samt Grund (etwa ein Element, das in einem eigenen Scrollcontainer klebt).
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 *  • ein `top`, das weiter als {@link FENSTER} Zeilen vom `sticky` entfernt steht;
 *  • ob eine Datei aus {@link KOPF_HOEHE_ERLAUBT} die Kopfhöhe an der richtigen Stelle nimmt
 *    (etwa ein Inhalt in `ModulPanel.tsx`, der an `--lfh-kopf-oben` klebt);
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
  // Das Übungsband klebt selbst unter den übrigen Quellen und ist Quelle der Höhe (LLH-1725, D4).
  'components/instrument/Uebung.tsx',
  // Die Alarmzone klebt unter dem Übungsband und ist Quelle der Höhe (LLH-1735, design.md D2).
  'alarm/AlarmZone.tsx',
];

/** Zeilen vor und nach einem `sticky`, in denen sein `top` steht. */
const FENSTER = 4;

const VERMERK = 'rahmen-oben: frei';

/**
 * Wer statt der Rahmenhöhe die Kopfhöhe (`--lfh-kopf-oben`, `useKopfOben`) nehmen darf
 * (zjt7c073 D2): was NEBEN dem Inhalt klebt (Rail, Modulpanel, Verwaltungsmenü) und der Seitenkopf
 * selbst, der sonst unter sich hinge; dazu die Entscheidung des ETB, ob seine Köpfe kleben (sie
 * rechnet ohne den Seitenkopf, der in die Rahmenhöhe eingeht). Jeder klebende Inhalt nimmt
 * `--lfh-rahmen-oben`, sonst läge er hinter dem klebenden Seitenkopf.
 */
const KOPF_HOEHE_ERLAUBT = [
  'components/rahmenOben.ts',
  'components/seitenkopfKleben.ts',
  'einsatz/IconRail.tsx',
  'einsatz/ModulPanel.tsx',
  'admin/AdminLayout.tsx',
  'etb/etbKopfKleben.ts',
  'index.css',
];

/** Davon die Dateien, deren klebende Elemente an der Kopfhöhe hängen dürfen (nicht `index.css`). */
const KLEBEN_AN_KOPF_HOEHE = KOPF_HOEHE_ERLAUBT.filter(
  (datei) => datei !== 'index.css' && datei !== 'etb/etbKopfKleben.ts',
);

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
    if (fenster.includes('--lfh-kopf-oben') && KLEBEN_AN_KOPF_HOEHE.includes(datei)) return;
    funde.push({ datei, zeile: i + 1, text: zeile.trim() });
  });
  return funde;
}

/**
 * Die Kopfhöhe außerhalb von {@link KOPF_HOEHE_ERLAUBT}. In `index.css` nur für den Fokusabstand
 * (`scroll-padding-block-start`): eine klebende Inhaltsregel dort läge hinter dem Seitenkopf.
 */
function kopfHoeheAusserhalb(datei: string, text: string): Fund[] {
  if (KOPF_HOEHE_ERLAUBT.includes(datei) && datei !== 'index.css') return [];
  const funde: Fund[] = [];
  text.split('\n').forEach((zeile, i) => {
    if (datei === 'index.css' && /^\s*scroll-padding-block-start:/.test(zeile)) return;
    if (/--lfh-kopf-oben|\buseKopfOben\b|\breadKopfOben\b|\bKOPF_OBEN_VAR\b/.test(zeile)) {
      funde.push({ datei, zeile: i + 1, text: zeile.trim() });
    }
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
    // Die Kopfhöhe (zjt7c073 D2) gilt nur in den Spalten neben dem Inhalt und im Seitenkopf.
    const kopf = "<div style={{ position: 'sticky', top: 'var(--lfh-kopf-oben, 0px)' }} />";
    expect(klebendOhneRahmen('x.tsx', kopf)).toHaveLength(1);
    expect(klebendOhneRahmen('einsatz/ModulPanel.tsx', kopf)).toHaveLength(0);
    expect(kopfHoeheAusserhalb('x.tsx', "top: 'var(--lfh-kopf-oben)'")).toHaveLength(1);
    expect(kopfHoeheAusserhalb('x.tsx', 'const h = useKopfOben();')).toHaveLength(1);
    // In `index.css` nur der Fokusabstand, kein klebender Inhalt.
    const cssKopf = '.a {\n  position: sticky;\n  top: var(--lfh-kopf-oben, 0px);\n}';
    expect(klebendOhneRahmen('index.css', cssKopf)).toHaveLength(1);
    expect(kopfHoeheAusserhalb('index.css', cssKopf)).toHaveLength(1);
    expect(
      kopfHoeheAusserhalb(
        'index.css',
        ':root {\n  scroll-padding-block-start: var(--lfh-kopf-oben, 0px);\n}',
      ),
    ).toHaveLength(0);
    expect(kopfHoeheAusserhalb('einsatz/IconRail.tsx', "top: 'var(--lfh-kopf-oben)'")).toHaveLength(
      0,
    );
    expect(tabelleOhneVersatz('x.tsx', '<Table\n  sticky\n/>')).toHaveLength(1);
    expect(tabelleOhneVersatz('x.tsx', '<Table\n  sticky={!druckt}\n/>')).toHaveLength(1);
    expect(
      tabelleOhneVersatz('x.tsx', '<Table\n  sticky={{ offsetHeader: rahmenOben }}\n/>'),
    ).toHaveLength(0);
  });

  it('jede Rahmen-Datei gibt es noch (sonst wäre die Ausnahme tot)', () => {
    const vorhanden = new Set(QUELLEN.map((q) => q.datei));
    for (const datei of [...RAHMEN, ...KOPF_HOEHE_ERLAUBT]) {
      expect(vorhanden.has(datei), datei).toBe(true);
    }
  });

  it('die Kopfhöhe nimmt nur, was neben dem Inhalt oder im Seitenkopf klebt', () => {
    const funde = QUELLEN.flatMap(({ datei, text }) => kopfHoeheAusserhalb(datei, text));
    expect(funde.map((f) => `${f.datei}:${f.zeile} ${f.text}`)).toEqual([]);
  });

  it('kein klebendes Element unter `src/` hängt an der Fensterkante statt unter dem Rahmen', () => {
    const funde = QUELLEN.filter(({ datei }) => !RAHMEN.includes(datei)).flatMap(
      ({ datei, text }) => [...klebendOhneRahmen(datei, text), ...tabelleOhneVersatz(datei, text)],
    );
    expect(funde.map((f) => `${f.datei}:${f.zeile} ${f.text}`)).toEqual([]);
  });
});
