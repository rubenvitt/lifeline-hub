import { describe, expect, it } from 'vitest';

/**
 * Guard (LFH-328/M8): erzwingt, dass `darfVerwaltung` aus `einsatz/schreibrecht.ts` die EINE
 * Quelle für die ORG-Achsen-Regel „darf der Benutzer in die Verwaltung?" bleibt.
 *
 * Verbietet die duplizierte FORMEL — eine Zeile, die eine `org_rolle`-Gleichheit UND eine
 * `system_rolle`-Gleichheit trägt (die OR-Form des Gates). Genau diese Formel
 * (`system_rolle === 'admin' || org_rolle === 'fuehrungskraft'`) lag byte-gleich dreifach kopiert
 * herum — `components/AppLayout.tsx` (privat), `admin/AdminLayout.tsx` (exportiert, von AppLayout
 * NICHT importiert) und `pages/EinsaetzePage.tsx` (unter dem Namen `darfAnlegen`) — während
 * `command-palette/befehle.ts` dieselbe Berechtigung mit `system_rolle === 'admin'` ALLEIN gatete:
 * eine Führungskraft sah „Verwaltung" in der Topbar, durfte die Route betreten, fand den Eintrag
 * aber nicht in der Kommandopalette. Neue Verwaltungs-Gates laufen ab jetzt durch `darfVerwaltung`.
 *
 * Bewusst NICHT gescannt: die ~24 einzelnen `system_rolle === 'admin'`-Vergleiche
 * (Stammdaten, Karten, Benutzerverwaltung). Das sind legitime **System**-Admin-Gates auf einer
 * anderen Achse, keine Verwaltungs-Gates — der Guard sucht deshalb die KOMBINATION beider Felder
 * und nicht das einzelne Feld. Aus demselben Grund schließt `schreibrecht.guard.test.ts:13-14`
 * `system_rolle` aus.
 *
 * Warum hier nur `===` und nicht `[=!]==` wie im schreibrecht-Guard: dort ist JEDER rohe
 * `meine_rolle`-Vergleich verboten, hier nur die kombinierte Gate-Formel.
 *
 * Bekannte Grenzen (zeilenbasierter Scan, wie beim schreibrecht-/queryKeys-Guard):
 * - Die negierte Form (`system_rolle !== 'admin' && org_rolle !== 'fuehrungskraft'`) wird NICHT
 *   erfasst. Gemessen gibt es sie einmal, in `pages/BenutzerPage.tsx:88` — dort bewusst: das ist
 *   der „weder-noch"-Arm einer dreiteiligen Rollen-ANZEIGE (die zwei Zeilen davor rendern die
 *   Admin- und Führungskraft-Tags), kein Gate. `!darfVerwaltung(b)` dort einzusetzen würde eine
 *   Anzeige-Aufzählung an den Berechtigungshelfer koppeln: widert die Verwaltungsregel später auf
 *   (dritte Org-Rolle), änderte sich still die Bedeutung des Tags.
 * - Ein über mehrere Zeilen umbrochener Vergleich entgeht ihm — `modulRegistry.ts:119/126` prüft
 *   beide Felder in getrennten Zeilen (dort bewusst: das ist die Modul-Sichtbarkeitsregel, NICHT
 *   die Verwaltungsformel).
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
