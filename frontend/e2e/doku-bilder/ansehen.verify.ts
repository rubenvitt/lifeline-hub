import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anmelden, demoEinsatz, expect, KONTEXTE, test, type Kontext } from './kern';

/**
 * Ansehen einer Änderung (LLH-2090, Skill `verify`, Lauf: `playwright.verify.config.ts`). Öffnet
 * jeden Pfad aus `VERIFY_PFADE` (kommagetrennt) als Admin in der App mit Demo-Daten und legt ein
 * Bild ab. `{einsatz}` im Pfad wird zur ID des Übungseinsatzes.
 *
 * Umgebung:
 *   VERIFY_PFADE    Pflicht, etwa `/einsaetze/{einsatz}/etb,/admin`
 *   VERIFY_KONTEXT  Bildschirm aus `kontexte.ts` (fuekw, tablet, handy, lagemonitor); Vorgabe fuekw
 *   VERIFY_AUSGABE  Ordner der Bilder; Vorgabe `<tmp>/lifeline-verify`
 *   VERIFY_ANKER    Text, der auf JEDER Seite stehen muss, bevor fotografiert wird (optional)
 *
 * Rot wird der Lauf, wenn eine Seite einen Konsolenfehler oder eine unbehandelte Ausnahme meldet,
 * eine Antwort ab 500 bekommt oder der Anker fehlt. Gewartet wird auf den Inhalt, nie auf
 * `networkidle` (frontend/e2e/AGENTS.md).
 */

const pfade = (process.env.VERIFY_PFADE ?? '')
  .split(',')
  .map((p) => p.trim())
  .filter((p) => p !== '');
const kontext = (process.env.VERIFY_KONTEXT ?? 'fuekw') as Kontext;
const ausgabe = process.env.VERIFY_AUSGABE ?? join(tmpdir(), 'lifeline-verify');
const anker = process.env.VERIFY_ANKER;

test.use({ viewport: KONTEXTE[kontext] });

test('Pfade aus VERIFY_PFADE ansehen', async ({ page }) => {
  expect(pfade, 'VERIFY_PFADE fehlt, etwa VERIFY_PFADE=/einsaetze/{einsatz}/etb').not.toEqual([]);
  expect(Object.keys(KONTEXTE), `VERIFY_KONTEXT=${kontext} unbekannt`).toContain(kontext);
  mkdirSync(ausgabe, { recursive: true });

  const fehler: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') fehler.push(`Konsole: ${m.text()}`);
  });
  page.on('pageerror', (e) => fehler.push(`Ausnahme: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) fehler.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });

  await anmelden(page);
  const einsatz = pfade.some((p) => p.includes('{einsatz}')) ? await demoEinsatz(page) : null;

  for (const [i, roh] of pfade.entries()) {
    const pfad = einsatz ? roh.split('{einsatz}').join(String(einsatz.id)) : roh;
    await test.step(pfad, async () => {
      const vorher = fehler.length;
      await page.goto(pfad);
      // Ohne Anker: die App hat gerendert, wenn der Hauptbereich steht und nichts mehr lädt.
      await expect(page.locator('#root')).not.toBeEmpty();
      await expect(page.locator('.ant-spin-spinning')).toHaveCount(0);
      if (anker) await expect(page.getByText(anker).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const name = `${String(i + 1).padStart(2, '0')}-${pfad.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'start'}`;
      const datei = join(ausgabe, `${name}-${kontext}.png`);
      // Der sichtbare Bildschirm: die App rollt in eigenen Bereichen, ein Ganzseitenbild
      // setzt sie zerstückelt zusammen.
      await page.screenshot({ path: datei });
      console.log(`Bild: ${datei} (${page.url()})`);
      expect(fehler.slice(vorher), `Fehler auf ${pfad}`).toEqual([]);
    });
  }
});
