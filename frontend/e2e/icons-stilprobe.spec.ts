import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { kontrast } from './kontrast-kern';

/**
 * Stilprobe des Iconsatzes (LFH-595, design.md D8): Aufnahmen und Messwerte, keine Norm.
 *
 * Läuft nur mit `PW_STILPROBE=1` (wie `PW_LATENZ=1` in `lagebericht-tippen.spec.ts`): Die Probe
 * ist eine Entscheidungsgrundlage für den Stil (iOS 27 Outlined, Plan B Windows 11), kein Gate.
 * Wiederholbar, damit ein Stilwechsel dieselben Bilder und Zahlen bekommt.
 *
 * Gezeigt wird die Meldungsseite eines Einsatzes: Kopfleiste (Menü, Suche, Verbindung, Benutzer),
 * Rail mit einer aktiven Kategorie (gefüllt) neben inaktiven (Umriss), Seitenkopf (Plus) und
 * Meldungskarten mit Zeit und Aktionsmenü. Je Breite × Betriebsart × Dichte entstehen eine
 * Aufnahme und eine Messung (Kantenlänge und Kontrast jedes sichtbaren Icons gegen seinen Grund).
 *
 * Ablage: `openspec/changes/archive/2026-09-30-lfh-595-ein-ikonensatz/stilprobe/` (Pfad relativ zu dieser Datei).
 */

test.skip(!process.env.PW_STILPROBE, 'nur mit PW_STILPROBE=1');

const ABLAGE = fileURLToPath(
  new URL(
    '../../openspec/changes/archive/2026-09-30-lfh-595-ein-ikonensatz/stilprobe/',
    import.meta.url,
  ),
);
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const BREITEN = [390, 1024, 1440] as const;
const MODI = ['dark', 'light'] as const;
const DICHTEN = ['kompakt', 'komfortabel', 'handschuh'] as const;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzMitMeldungen(page: Page): Promise<string> {
  const e = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: 'Stilprobe Icons' },
  });
  expect(e.ok(), await e.text()).toBe(true);
  const einsatzId = String(((await e.json()) as { id: number }).id);
  for (const inhalt of [
    'Brücke Nord gesperrt, Umleitung über die B12 eingerichtet',
    'Pegel Mühlbach steigt, Sandsäcke an der Schule angefordert',
  ]) {
    const m = await page.request.post(`/api/einsaetze/${einsatzId}/meldungen`, {
      data: {
        absender: 'Florian Nord 1',
        meldeweg: 'funk',
        inhalt,
        ereigniszeit: new Date().toISOString(),
      },
    });
    expect(m.ok(), await m.text()).toBe(true);
  }
  return einsatzId;
}

interface IconMessung {
  icon: string;
  breite: number;
  hoehe: number;
  /** `null`, wenn der Messkern die Fläche nicht modelliert (Deckkraft, Verlauf) — mit Grund. */
  kontrast: number | null;
  grund?: string;
}

test('Stilprobe: Aufnahmen und Messwerte je Breite, Betriebsart und Dichte', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  mkdirSync(ABLAGE, { recursive: true });
  await anmelden(page);
  const einsatzId = await einsatzMitMeldungen(page);
  const ergebnis: Record<string, IconMessung[]> = {};

  for (const modus of MODI) {
    for (const dichte of DICHTEN) {
      await page.evaluate(
        ([m, d]) => {
          localStorage.setItem('lifeline-hub.theme', m);
          localStorage.setItem('lifeline-hub.dichte', d);
        },
        [modus, dichte] as const,
      );
      for (const breite of BREITEN) {
        await page.setViewportSize({ width: breite, height: 900 });
        await page.goto(`/einsaetze/${einsatzId}/meldungen`);
        await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
        await expect(page.getByText('Brücke Nord gesperrt', { exact: false })).toBeVisible();
        const name = `${breite}-${modus}-${dichte}`;
        await page.screenshot({ path: join(ABLAGE, `${name}.png`) });

        const messungen: IconMessung[] = [];
        for (const icon of await page.locator('[data-lfh-icon]').all()) {
          if (!(await icon.isVisible())) continue;
          const kasten = await icon.locator('svg').boundingBox();
          if (!kasten) continue;
          const messung: IconMessung = {
            icon: (await icon.getAttribute('data-lfh-icon')) ?? '?',
            breite: Math.round(kasten.width * 10) / 10,
            hoehe: Math.round(kasten.height * 10) / 10,
            kontrast: null,
          };
          try {
            messung.kontrast = Math.round((await kontrast(icon)).verhaeltnis * 100) / 100;
          } catch (fehler) {
            messung.grund = String(fehler).split('\n')[0].slice(0, 160);
          }
          messungen.push(messung);
        }
        expect(messungen.length, `${name}: kein Icon des Satzes sichtbar`).toBeGreaterThan(0);
        ergebnis[name] = messungen;
      }
    }
  }
  writeFileSync(join(ABLAGE, 'messung.json'), `${JSON.stringify(ergebnis, null, 2)}\n`);
});
