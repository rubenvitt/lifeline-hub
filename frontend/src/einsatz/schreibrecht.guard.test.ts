import { describe, expect, it } from 'vitest';

/**
 * Guard (LFH-234): erzwingt, dass `einsatz/schreibrecht.ts` die EINE Quelle für die
 * Einsatz-Schreibrecht-/Rollen-Regel bleibt.
 *
 * Verbietet rohe `meine_rolle`-VERGLEICHE (`=== '…'` / `!== '…'`) außerhalb der Wahrheitsquelle.
 * Genau solche Inline-Vergleiche waren zuvor über ~29 Dateien in vier divergenten Varianten
 * kopiert (A Allowlist, B Beobachter-Negation, C Deny-list, D admin-augmentiert) — eine neue
 * Rolle hätte die UI inkonsistent gekippt. Neue Rollen-/Schreibrecht-Logik läuft ab jetzt durch
 * `darfImEinsatzSchreiben` / `darfEinsatzLeiten` / `istEinsatzLeitung` / `istBeobachter`.
 *
 * Bewusst NICHT gescannt: `system_rolle`-Vergleiche (20+ legitime einsatz-FREMDE
 * `system_rolle === 'admin'`-Gates in stammdaten/karten/admin) und reine Anzeigen ohne Vergleich
 * (`{einsatz.meine_rolle && <Tag>}`). Bekannte Grenze (wie beim queryKeys-Guard): ein aliasierter
 * Vergleich (`const r = einsatz.meine_rolle; if (r === 'einsatzleitung')`) entgeht dem
 * zeilenbasierten Scan — neue Rollen-Logik muss bewusst durch den Helfer geführt werden.
 */

// Alle Quelldateien als Rohtext (Vite): zeilenweiser Scan der Vergleichs-Stellen.
const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function istKommentarzeile(zeile: string): boolean {
  const t = zeile.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

// Fängt `meine_rolle === '…'`, `meine_rolle !== '…'` (mit optionalem `?.`/Whitespace davor egal).
const ROHER_VERGLEICH = /meine_rolle\s*[=!]==/;

describe('schreibrecht-Guard (LFH-234): keine rohen meine_rolle-Vergleiche außerhalb schreibrecht.ts', () => {
  it('findet keinen Inline-Vergleich von meine_rolle', () => {
    const verstoesse: string[] = [];
    for (const [pfad, inhalt] of Object.entries(dateien)) {
      if (pfad.endsWith('/einsatz/schreibrecht.ts')) continue; // Home der Wahrheitsquelle
      if (/\.test\.tsx?$/.test(pfad)) continue; // Tests pinnen Werte bewusst
      if (/\.generated\.tsx?$/.test(pfad)) continue; // Codegen
      inhalt.split('\n').forEach((zeile, i) => {
        if (istKommentarzeile(zeile)) return;
        if (ROHER_VERGLEICH.test(zeile)) {
          verstoesse.push(`${pfad}:${i + 1}  ${zeile.trim()}`);
        }
      });
    }
    expect(
      verstoesse,
      `Rohe meine_rolle-Vergleiche gefunden — bitte schreibrecht.ts-Helfer nutzen ` +
        `(darfImEinsatzSchreiben / darfEinsatzLeiten / istEinsatzLeitung / istBeobachter):\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });
});
