/**
 * Menüfarbe-Guard (LLH-1722, Spec `datensatz-aktionsmenue`, „Unumkehrbares steht rot hinter einem
 * Trenner“; `frontend/AGENTS.md`, „Destruktiv ist nicht gleich destruktiv“).
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Im ⋮-Menü ist nur Unumkehrbares rot. Ein Lösen, Entlassen oder Austragen mit Rückgängig steht
 * neutral unter den umkehrbaren; sonst stünde es gleichrangig neben „Stornieren“ ohne Rückweg, und
 * die Farbe trüge keine Information mehr. Im Einheit-Detail standen die Lösen-Einträge rot.
 *
 * ── Was er zählt ────────────────────────────────────────────────────────────────
 * Ein Objektliteral ohne innere Klammern, das ein `label` mit einem dieser Verben UND `gefahr`
 * trägt. Grob, aber ohne Lücke für den Fall, der wiederkäme.
 *
 * ── Was er NICHT sieht ──────────────────────────────────────────────────────────
 *   • ein Etikett aus einer Konstante oder einem Ausdruck ohne das Verb im Quelltext;
 *   • ein Objekt mit verschachtelten Klammern (etwa ein Icon-Element) zwischen Etikett und Gefahr.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** „Aus … lösen“, „Vom … lösen“, „Lösen“, „Entlassen“, „Austragen“; nicht „Auflösen“. */
const UMKEHRBAR =
  /label:\s*[`'"](Lösen|Entlassen|Austragen|Aus dem Einsatz nehmen|[^`'"]*\slösen\b)/;

function lieseQuellen(verzeichnis: string, praefix = '/src'): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      Object.assign(treffer, lieseQuellen(pfad, `${praefix}/${eintrag.name}`));
    } else if (/\.tsx?$/.test(eintrag.name) && !/\.test\.tsx?$/.test(eintrag.name)) {
      treffer[`${praefix}/${eintrag.name}`] = readFileSync(pfad, 'utf8');
    }
  }
  return treffer;
}

/** Die roten Einträge mit umkehrbarem Verb in einer Quelle. */
export function roteUmkehrbare(quelle: string): string[] {
  return (quelle.match(/\{[^{}]*\}/g) ?? []).filter(
    (o) => UMKEHRBAR.test(o) && /\bgefahr\s*:\s*true\b/.test(o),
  );
}

describe('Menüfarbe-Guard (LLH-1722)', () => {
  it('erkennt einen roten Lösen-Eintrag (Gegenprobe)', () => {
    expect(
      roteUmkehrbare(`items.push({ key: 'x', label: 'Aus Einheit lösen', gefahr: true });`),
    ).toHaveLength(1);
    expect(roteUmkehrbare(`{ key: 'e', label: 'Entlassen', gefahr: true as const }`)).toHaveLength(
      1,
    );
    expect(roteUmkehrbare(`{ key: 's', label: 'Stornieren', gefahr: true }`)).toHaveLength(0);
    expect(roteUmkehrbare(`{ key: 'a', label: 'Auflösen …', gefahr: true }`)).toHaveLength(0);
    expect(roteUmkehrbare(`{ key: 'x', label: 'Aus Einheit lösen' }`)).toHaveLength(0);
  });

  it('kein umkehrbares Lösen, Entlassen oder Austragen steht rot im Menü', () => {
    const funde = Object.entries(lieseQuellen(SRC)).flatMap(([pfad, inhalt]) =>
      roteUmkehrbare(inhalt).map((o) => `${pfad}: ${o.replace(/\s+/g, ' ')}`),
    );
    expect(funde).toEqual([]);
  });
});
