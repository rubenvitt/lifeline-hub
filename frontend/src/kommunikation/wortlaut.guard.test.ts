/**
 * Wortlaut-Guard (LFH-959): Knöpfe nennen ihre Handlung, ein Zustand steht nur auf dem Etikett
 * (`frontend/AGENTS.md`, Bedien-Leitlinie „Aktionen“).
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * „In Bearbeitung“ neben dem Etikett „Offen“ liest sich als Zustand, nicht als Knopf; „→ Zugesagt“
 * sagt nicht, wer was zusagt. Am Tablet gibt es keinen Hover, der es erklärt.
 *
 * ── Drei Hälften ────────────────────────────────────────────────────────────────
 *   1. Daten: kein Handlungstext gleicht einem Statuswort desselben Moduls (Meldung, Auftrag,
 *      Nachforderung, Dienststatus). Die Erinnerungen stehen bewusst NICHT darin: „Erledigt
 *      (durchgeführt)“ ist entschieden und gleicht dem Statuswort nicht (design.md D2).
 *   2. Quelltext der Karten: kein `<Button>` rendert `…_STATUS[…].label`, kein Knopftext und kein
 *      Menüeintrag (`label: '…'`) ist ein Statuswort des Moduls.
 *   3. Quelltext der Erinnerungen: kein sichtbares „Quittier…“ — Quittieren heißt Empfang
 *      bestätigt, eine Erinnerung erübrigt sich (Entscheidung 10).
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 *   • Knopftexte aus Variablen oder Ausdrücken außer `…_STATUS[…].label`;
 *   • JSX-Text mit `=`, `;`, `{` oder `<` darin (der Schnitt endet dort);
 *   • Dateien außerhalb von {@link KARTEN} und {@link ERINNERUNG_DATEIEN}.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AUFTRAG_HANDLUNG,
  AUFTRAG_STATUS,
  MELDUNG_HANDLUNG,
  MELDUNG_STATUS,
  NACHFORDERUNG_HANDLUNG,
  NACHFORDERUNG_STATUS,
} from './phase';
import { dienststatus } from '../theme/statusFarben';
import { DIENSTSTATUS_HANDLUNG } from '../stammdaten/dienststatus';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const lies = (relativ: string) => readFileSync(join(SRC, relativ), 'utf-8');

const norm = (s: string) => s.trim().toLocaleLowerCase('de');

/** Statuswörter eines Moduls, normalisiert. */
function woerter(status: Record<string, { label: string }>): Set<string> {
  return new Set(Object.values(status).map((s) => norm(s.label)));
}

/** Handlungstexte, die einem Statuswort gleichen. */
function kollisionen(handlung: Record<string, string>, statuswoerter: Set<string>): string[] {
  return Object.values(handlung).filter((h) => statuswoerter.has(norm(h)));
}

const MODULE = [
  { modul: 'Meldung', handlung: MELDUNG_HANDLUNG, status: MELDUNG_STATUS },
  { modul: 'Auftrag', handlung: AUFTRAG_HANDLUNG, status: AUFTRAG_STATUS },
  { modul: 'Nachforderung', handlung: NACHFORDERUNG_HANDLUNG, status: NACHFORDERUNG_STATUS },
  { modul: 'Dienststatus', handlung: DIENSTSTATUS_HANDLUNG, status: dienststatus },
] as const;

/** Karte → Statuskarte ihres Moduls. Jede Datei muss lesbar bleiben (sonst wirft `lies`). */
const KARTEN = [
  ['meldungen/MeldungKarte.tsx', MELDUNG_STATUS],
  ['auftraege/AuftragKarte.tsx', AUFTRAG_STATUS],
  ['nachforderungen/NachforderungKarte.tsx', NACHFORDERUNG_STATUS],
  ['stammdaten/dienststatus.tsx', dienststatus],
] as const;

/**
 * Inhalt jedes `<Button …>…</Button>`. Der Kopf endet am ersten `>` AUSSERHALB von `{…}` — ein
 * Pfeil in `onClick={() => { … }}` beendet ihn nicht, gleich wie tief die Klammern stehen.
 */
function knopfInhalte(quelle: string): string[] {
  const inhalte: string[] = [];
  for (const treffer of quelle.matchAll(/<Button\b/g)) {
    let i = treffer.index + treffer[0].length;
    let tiefe = 0;
    for (; i < quelle.length; i += 1) {
      const z = quelle[i];
      if (z === '{') tiefe += 1;
      else if (z === '}') tiefe -= 1;
      else if (z === '>' && tiefe === 0) break;
    }
    if (quelle[i - 1] === '/') continue; // selbstschließend, kein Inhalt
    const ende = quelle.indexOf('</Button>', i);
    if (ende !== -1) inhalte.push(quelle.slice(i + 1, ende));
  }
  return inhalte;
}

/** Verstöße in einer Karte gegen Hälfte 2. */
function kartenVerstoesse(quelle: string, statuswoerter: Set<string>): string[] {
  const funde: string[] = [];
  for (const inhalt of knopfInhalte(quelle)) {
    if (/\w+_STATUS\[[^\]]+\]\??\.label/.test(inhalt))
      funde.push(`Statuslabel im Knopf: ${inhalt.trim()}`);
    const text = inhalt.replace(/\{[\s\S]*?\}/g, ' ').trim();
    if (text && statuswoerter.has(norm(text))) funde.push(`Statuswort im Knopf: ${text}`);
  }
  for (const m of quelle.matchAll(/label:\s*'([^']+)'/g)) {
    if (statuswoerter.has(norm(m[1]))) funde.push(`Statuswort im Menü: ${m[1]}`);
  }
  return funde;
}

/** Kommentare entfernen; `//` nur am Zeilenanfang oder nach Leerraum (nicht in `https://`). */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/**
 * Sichtbares „Quittier…“: Stringliterale und JSX-Text. Das Drahtwort `'quittiert'` (Enum des
 * Backends, design.md Non-Goals) ist kein Wortlaut und bleibt erlaubt.
 */
function quittierFunde(quelle: string): string[] {
  const rein = ohneKommentare(quelle);
  const literale = [...rein.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`]*)`/g)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? '',
  );
  const jsxText = [...rein.matchAll(/(?<!=)>([^<>{}=;]+)(?=[<{])/g)].map((m) => m[1]);
  return [...literale, ...jsxText]
    .filter((t) => /quittier/i.test(t))
    .filter((t) => t !== 'quittiert');
}

const ERINNERUNG_DATEIEN = [
  ...readdirSync(join(SRC, 'erinnerung'))
    .filter((d) => d.endsWith('.tsx') || d.endsWith('.ts'))
    .filter((d) => !d.includes('.test.'))
    .map((d) => `erinnerung/${d}`),
  'pages/ErinnerungenPage.tsx',
];

describe('Knöpfe nennen ihre Handlung (LFH-959)', () => {
  describe('1. Handlungstexte gleichen keinem Statuswort', () => {
    it.each(MODULE)('$modul', ({ handlung, status }) => {
      expect(Object.keys(handlung).length).toBeGreaterThan(0);
      expect(kollisionen(handlung, woerter(status))).toEqual([]);
    });

    it('Selbstbeweis: ein eingeschleustes Statuswort färbt rot', () => {
      expect(kollisionen({ in_bearbeitung: ' in bearbeitung ' }, woerter(MELDUNG_STATUS))).toEqual([
        ' in bearbeitung ',
      ]);
    });
  });

  describe('2. Kein Statuswort als Knopf oder Menüeintrag', () => {
    it.each(KARTEN)('%s', (datei, status) => {
      const quelle = lies(datei);
      expect(knopfInhalte(quelle).length, `${datei}: keine Knöpfe gefunden`).toBeGreaterThan(0);
      expect(kartenVerstoesse(quelle, woerter(status))).toEqual([]);
    });

    it('Selbstbeweis: Statuslabel, Statuswort im Knopf und im Menü färben rot', () => {
      const w = woerter(NACHFORDERUNG_STATUS);
      expect(
        kartenVerstoesse('<Button onClick={x}>→ {NACHFORDERUNG_STATUS[next].label}</Button>', w),
      ).toHaveLength(1);
      expect(kartenVerstoesse('<Button danger>\n  Zugesagt\n</Button>', w)).toHaveLength(1);
      expect(kartenVerstoesse("{ key: 'z', label: 'Unterwegs' }", w)).toHaveLength(1);
      expect(
        kartenVerstoesse(
          '<Button key="n" onClick={() => { if (x) go({ id: 1 }); }}>Zugesagt</Button>',
          w,
        ),
        'Pfeil und Klammern im Kopf',
      ).toHaveLength(1);
      expect(kartenVerstoesse('<Button>Zusage erfassen</Button>', w)).toEqual([]);
    });
  });

  describe('3. Erinnerungen sagen nicht „Quittier…“', () => {
    it('die Liste der Dateien ist belegt', () => {
      expect(ERINNERUNG_DATEIEN).toContain('erinnerung/ErinnerungKarte.tsx');
    });

    it.each(ERINNERUNG_DATEIEN)('%s', (datei) => {
      expect(quittierFunde(lies(datei))).toEqual([]);
    });

    it('Selbstbeweis: Knopf, Toast und Zeitzeile färben rot, Drahtwort und Kommentar nicht', () => {
      expect(quittierFunde('<Button onClick={q}>Quittieren</Button>')).toHaveLength(1);
      expect(quittierFunde("zeigeRueckgaengig(message, 'Erinnerung quittiert', f);")).toHaveLength(
        1,
      );
      expect(
        quittierFunde('<Text>\n  Quittiert: {formatZeit(e.quittiert_at)}\n</Text>'),
      ).toHaveLength(1);
      expect(quittierFunde("e.status === 'quittiert' && onQuittieren?.(e.id)")).toEqual([]);
      expect(quittierFunde('// Quittiert = zur Kenntnis\nconst x = 1;')).toEqual([]);
      expect(quittierFunde('mutationFn: (eid) => quittiereErinnerung(einsatzId, eid),')).toEqual(
        [],
      );
    });
  });
});
