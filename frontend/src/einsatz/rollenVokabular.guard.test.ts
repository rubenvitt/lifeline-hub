/**
 * Rollen-Vokabular-Guard (LLH-1818, `frontend/AGENTS.md`, „Begriffe“): Rollennamen stehen nur in
 * `einsatz/rollenVokabular.ts`. Alte Namen („System-Rolle“, „Org-Rolle“, „Org-Admin“,
 * „Führungskraft (darf Einsätze anlegen)“) und die Kurzformen „Admin“ und „Führungskraft“ als
 * eigener Text tauchen im sichtbaren Code nicht wieder auf.
 *
 * ── Warum ──────────────────────────────────────────────────────────────────────
 * Vor der Regel trug dieselbe Rolle drei Namen („Admin“, „System-Admin“, „Org-Admin“), weil jede
 * Fläche ihr eigenes Literal hatte und jede für sich plausibel aussah.
 *
 * ── Warum die Kurzformen nur als ganzer Text ───────────────────────────────────
 * „Admin“ und „Führungskraft“ sind Teil anderer Wörter und Namen (`AdminPage`, „Führungskraft der
 * Organisation“, die Führungskraft der Lagekarte nach DV 102 in Kommentaren). Getroffen wird nur
 * ein String oder JSX-Text, der genau aus dem Wort besteht.
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 *   • zusammengesetzte Texte (`'Ad' + 'min'`), Servermeldungen, Daten;
 *   • Kommentare (`test/ohneKommentare.ts`) und Tests.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENDUNGEN = /\.(ts|tsx)$/;
const QUELLE = '/src/einsatz/rollenVokabular.ts';

const ALTNAMEN: readonly RegExp[] = [
  /System-Rolle/g,
  /Org-Rolle/g,
  /Org-Admin/g,
  /Führungskraft \(darf/g,
  /['"`>]\s*Admin\s*['"`<]/g,
  /['"`>]\s*Führungskraft\s*['"`<]/g,
];

function lieseQuellen(verzeichnis: string, praefix = '/src'): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      Object.assign(treffer, lieseQuellen(pfad, `${praefix}/${eintrag.name}`));
    } else if (ENDUNGEN.test(eintrag.name)) {
      treffer[`${praefix}/${eintrag.name}`] = readFileSync(pfad, 'utf8');
    }
  }
  return treffer;
}

/** Tests, Testhilfen (`src/test/`, dort sind „Admin“ und Co. Anzeigenamen), Erzeugtes, die Quelle. */
function istAusgenommen(pfad: string): boolean {
  return (
    /\.test\.[jt]sx?$/.test(pfad) ||
    /\.generated\.[jt]sx?$/.test(pfad) ||
    pfad.startsWith('/src/test/') ||
    pfad === QUELLE
  );
}

export function fundeIn(pfad: string, quelltext: string): string[] {
  const funde: string[] = [];
  ohneKommentare(quelltext).forEach((text, i) => {
    for (const muster of ALTNAMEN) {
      for (const m of text.matchAll(muster)) {
        funde.push(`${pfad}:${i + 1}  „${m[0]}“: ${text.trim()}`);
      }
    }
  });
  return funde;
}

describe('Rollen-Vokabular-Guard (LLH-1818)', () => {
  it('kein sichtbarer Text nennt eine Rolle an `einsatz/rollenVokabular.ts` vorbei', () => {
    const funde = Object.entries(lieseQuellen(SRC))
      .filter(([pfad]) => !istAusgenommen(pfad))
      .flatMap(([pfad, inhalt]) => fundeIn(pfad, inhalt));
    expect(funde).toEqual([]);
  });

  // ── Selbstbeweise: ein Guard, der nichts findet, ist von einem kaputten nicht zu
  //    unterscheiden.

  it('findet alte Feld- und Rollennamen in Strings und JSX', () => {
    expect(fundeIn('/x.ts', "export const F = 'Org-Rolle';")).toHaveLength(1);
    expect(fundeIn('/x.ts', "const g = 'nur Einsatzleitung oder Org-Admin';")).toHaveLength(1);
    expect(fundeIn('/x.tsx', '<Status wort="Admin" />')).toHaveLength(1);
    expect(fundeIn('/x.tsx', '<Marke>Führungskraft</Marke>')).toHaveLength(1);
    expect(fundeIn('/x.tsx', 'label: `Führungskraft (darf Einsätze anlegen)`')).toHaveLength(1);
  });

  it('lässt Bezeichner, längere Namen und Kommentare in Ruhe', () => {
    const quelle = [
      "import AdminPage from './AdminPage';",
      "const t = 'Führungskraft der Organisation';",
      "const u = 'nur System-Admin';",
      '// Die Führungskraft trägt die Raute (DV 102), System-Rolle im Kommentar',
    ].join('\n');
    expect(fundeIn('/x.tsx', quelle)).toEqual([]);
  });
});
