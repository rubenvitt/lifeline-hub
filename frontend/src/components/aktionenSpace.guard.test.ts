/**
 * Aktionen-Guard (LLH-1273): ein `<Space>`, das die `aktionen` eines Seitenkopfs oder Eintrags
 * trägt, nennt seinen Abstand.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Ohne `size` setzt antd `token.paddingXS` = `abstand.xs` = 3 / 5 / 7 px zwischen die Knöpfe
 * (Herleitung in `aktionsabstand.guard.test.ts`). Die Leitlinie verlangt zwischen zwei Zielen
 * ≥ 8 px in `komfortabel` und ≥ 16 px in `handschuh`; `token.marginSM` hält 7 / 11 / 16. Der Kopf
 * der `EinsatzSeite` trägt diesen Abstand selbst (`seitenkopf-aktionen`), ein eingeschobenes
 * `<Space>` setzte ihn für seine Kinder wieder auf 7 px herab („Personal disponieren“ neben
 * „Ad-hoc-Person“, Prüfliste LLH-1060).
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 *   • Aktionen, die vorher in eine Variable gebaut und als `aktionen={x}` übergeben werden;
 *   • ein `<Space>` tiefer im Baum als das erste Element des Ausdrucks;
 *   • ob der genannte Abstand reicht (`size="small"` ginge durch). Den Pixelwert misst
 *     `e2e/gate3-trefflaeche.spec.ts` („Personal (LLH-1273)“).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function tsxDateien(ordner: string): string[] {
  return readdirSync(ordner).flatMap((name) => {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) return tsxDateien(pfad);
    return pfad.endsWith('.tsx') && !/\.test\.tsx$/.test(pfad) ? [pfad] : [];
  });
}

/** Je `aktionen={…}`, dessen erstes Element ein `<Space` ist: der öffnende Tag. */
function spaceInAktionen(quelle: string): string[] {
  const funde: string[] = [];
  for (const treffer of quelle.matchAll(/\baktionen=\{/g)) {
    const rest = quelle.slice(treffer.index + treffer[0].length);
    const erstesElement = rest.search(/<[A-Za-z>]/);
    if (erstesElement < 0 || !rest.startsWith('<Space', erstesElement)) continue;
    const tag = rest.slice(erstesElement, rest.indexOf('>', erstesElement) + 1);
    if (/^<Space\b/.test(tag)) funde.push(tag);
  }
  return funde;
}

describe('Aktionen-Guard (LLH-1273)', () => {
  const funde = tsxDateien(SRC).flatMap((pfad) =>
    spaceInAktionen(readFileSync(pfad, 'utf8')).map((tag) => ({
      datei: relative(SRC, pfad),
      tag,
    })),
  );

  it('findet die bekannten Stellen (sonst wäre der Guard trivial grün)', () => {
    // Personal, Material, Fahrzeuge, Einsatzabschnitte, Kräfteübersicht, Presse, Lagemeldungen,
    // Schaden-Detailseite.
    expect(funde.length).toBeGreaterThanOrEqual(8);
    expect(funde.map((f) => f.datei)).toContain('pages/PersonalPage.tsx');
  });

  it('jedes `<Space>` in `aktionen` nennt `size`', () => {
    const ohne = funde.filter((f) => !/\bsize=/.test(f.tag)).map((f) => `${f.datei}: ${f.tag}`);
    expect(ohne, ohne.join('\n')).toEqual([]);
  });

  it('erkennt ein `<Space>` ohne `size` (Selbstbeweis)', () => {
    expect(spaceInAktionen('aktionen={\n  darf && (\n    <Space wrap>\n')).toEqual([
      '<Space wrap>',
    ]);
    expect(spaceInAktionen('aktionen={<Button>x</Button>}')).toEqual([]);
  });
});
