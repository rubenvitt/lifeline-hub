import { describe, expect, it } from 'vitest';

/**
 * Guard (LFH-328/M8): `darfVerwaltung` aus `einsatz/schreibrecht.ts` bleibt die EINE Quelle
 * für „darf der Benutzer in die Verwaltung?".
 *
 * Verbietet die duplizierte FORMEL: eine Zeile mit einer `org_rolle`-Gleichheit UND einer
 * `system_rolle`-Gleichheit (`system_rolle === 'admin' || org_rolle === 'fuehrungskraft'`).
 * Kopien davon ließen Topbar, Route und Kommandopalette auseinanderlaufen.
 *
 * Bewusst NICHT gescannt: einzelne `system_rolle === 'admin'`-Vergleiche. Das sind
 * System-Admin-Gates auf einer anderen Achse; der Guard sucht deshalb die KOMBINATION beider
 * Felder (aus demselben Grund schließt `schreibrecht.guard.test.ts` `system_rolle` aus).
 * Nur `===`, weil hier nur die kombinierte Gate-Formel verboten ist, nicht jeder Vergleich.
 *
 * Bekannte Grenzen (zeilenbasierter Scan):
 * - Die negierte Form (`system_rolle !== 'admin' && org_rolle !== 'fuehrungskraft'`) wird NICHT
 *   erfasst. Sie steht bewusst in `pages/BenutzerPage.tsx` als „weder-noch"-Arm einer
 *   Rollen-ANZEIGE, kein Gate; sie an den Helfer zu koppeln änderte bei einer dritten
 *   Org-Rolle still die Bedeutung des Tags.
 * - Ein über mehrere Zeilen umbrochener Vergleich entgeht ihm (`modulRegistry.ts` prüft beide
 *   Felder getrennt — dort ist es die Modul-Sichtbarkeitsregel, nicht die Verwaltungsformel).
 * - Aliasierte Werte entgehen ihm (`const r = b.org_rolle; if (r === 'fuehrungskraft' && …)`).
 * Neue Verwaltungs-Logik muss deshalb bewusst durch den Helfer geführt werden.
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

const ORG_GLEICHHEIT = /org_rolle\s*===/;
const SYSTEM_GLEICHHEIT = /system_rolle\s*===/;

describe('verwaltungsrecht-Guard (LFH-328): keine duplizierte org_rolle+system_rolle-Formel', () => {
  it('findet keine Zeile, die org_rolle und system_rolle gemeinsam vergleicht', () => {
    const verstoesse: string[] = [];
    for (const [pfad, inhalt] of Object.entries(dateien)) {
      if (pfad.endsWith('/einsatz/schreibrecht.ts')) continue; // Home der Wahrheitsquelle
      if (/\.test\.tsx?$/.test(pfad)) continue; // Tests pinnen Werte bewusst
      if (/\.generated\.tsx?$/.test(pfad)) continue; // Codegen
      inhalt.split('\n').forEach((zeile, i) => {
        if (istKommentarzeile(zeile)) return;
        if (ORG_GLEICHHEIT.test(zeile) && SYSTEM_GLEICHHEIT.test(zeile)) {
          verstoesse.push(`${pfad}:${i + 1}  ${zeile.trim()}`);
        }
      });
    }
    expect(
      verstoesse,
      `Duplizierte Verwaltungs-Formel gefunden — bitte \`darfVerwaltung(benutzer)\` aus ` +
        `einsatz/schreibrecht.ts nutzen:\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });
});
