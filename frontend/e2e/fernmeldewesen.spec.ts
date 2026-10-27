import { expect, test, type Page } from '@playwright/test';
import { api, einsatzAnlegen, flaeche, seedeGrund } from './fernmeldeskizze-kern';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Das Modul Fernmeldewesen (LLH-1180) im Browser:
 *
 * - EIGENE FREIGABE: ist der Stab ausgeblendet, sind Funkplan (alle drei Darstellungen),
 *   Kommunikationsplan und „Fernmeldeskizze anfügen“ voll nutzbar. Gemessen als Führungspersonal,
 *   denn der Admin erreicht ein ausgeblendetes Modul trotzdem; Vorbedingung ist die Freigabe vom
 *   Server (Stab weder sichtbar noch zugänglich, Fernmeldewesen frei).
 * - STAB-WEICHE: ohne Stab steht im Kommunikationsplan die Besetzung als „—“ mit Grund, die
 *   Verbindung der Stelle bleibt.
 * - ALTADRESSE: `…/stab/funkplan?ansicht=skizze` landet in der Skizze des Moduls, auch ohne Stab.
 * - HANDY (390 px): die vier Reiter ohne Querlauf.
 *
 * Kein `networkidle` (SSE-Strom, LFH-385); gewartet wird auf Inhaltsanker.
 */

const BREITE = 390;
const NUMMER = '0170 1112223';

/** Legt S2 mit einer Mobilnummer an; der Nebentext nennt sonst die Besetzung des Stabs. */
async function seedeS2(page: Page, einsatzId: string) {
  const a = api(page, einsatzId);
  const plan = await a.post<{ id: number; funktion?: string }[]>(
    'stab/kommunikationsplan/stellen',
    {
      stellenart: 'funktion',
      funktion: 's2',
    },
  );
  const s2 = plan.find((s) => s.funktion === 's2')!;
  await a.post(`stab/kommunikationsplan/stellen/${s2.id}/verbindungen`, {
    mittel: 'mobil',
    wert: NUMMER,
  });
}

async function stabAusblenden(page: Page, einsatzId: string) {
  const override = await page.request.put(`/api/einsaetze/${einsatzId}/modul-overrides/stab`, {
    data: { sichtbar: false, benoetigte_rolle: null },
  });
  expect(override.ok(), `Override Stab: ${override.status()}`).toBeTruthy();
}

async function vorbedingungStabAus(page: Page, einsatzId: string) {
  const freigaben = (await (
    await page.request.get(`/api/einsaetze/${einsatzId}/modul-freigaben`)
  ).json()) as Record<string, { sichtbar: boolean; zugriff: boolean }>;
  expect(freigaben.stab, 'Vorbedingung: Stab ausgeblendet').toEqual({
    sichtbar: false,
    zugriff: false,
  });
  expect(freigaben.fernmeldewesen, 'Vorbedingung: Fernmeldewesen frei').toEqual({
    sichtbar: true,
    zugriff: true,
  });
}

const reiter = (page: Page, name: string) => page.getByRole('tablist').getByRole('tab', { name });

test.describe('Fernmeldewesen (LLH-1180)', () => {
  test('Stab ausgeblendet: alle vier Reiter voll nutzbar, alte Adresse führt in die Skizze', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await anmeldenAlsAdmin(page);
    const id = await einsatzAnlegen(page, `E2E Fernmeldewesen ${Date.now()}`);
    await seedeGrund(page, id);
    await seedeS2(page, id);
    await stabAusblenden(page, id);
    await wechsleZuRolle(page, 'fuehrungspersonal', id);
    await vorbedingungStabAus(page, id);

    // Altadresse mit Darstellung: landet in der Skizze des Moduls, `?ansicht=` bleibt (LLH-1432).
    await page.goto(`/einsaetze/${id}/stab/funkplan?ansicht=skizze`);
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/fernmeldewesen\\?ansicht=skizze$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Fernmeldewesen' })).toBeVisible();
    await expect(reiter(page, 'Fernmeldeskizze')).toHaveAttribute('aria-selected', 'true');
    await expect(flaeche(page)).toBeVisible();

    await reiter(page, 'Funkplan').click();
    await expect(page.getByRole('region', { name: 'Funkplan' })).toBeVisible();
    await reiter(page, 'Sprechgruppen').click();
    await expect(reiter(page, 'Sprechgruppen')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Funkplan' })).toHaveCount(0);

    // Kommunikationsplan: Verbindung da, Besetzung „—“ mit Grund, Schreiben möglich.
    await reiter(page, 'Kommunikationsplan').click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/fernmeldewesen/kommunikationsplan$`));
    const plan = page.getByRole('region', { name: 'Kommunikationsplan' });
    await expect(plan.getByRole('link', { name: NUMMER })).toBeVisible();
    await expect(plan.getByTitle('Stab nicht freigegeben')).toHaveText(/^—/);
    await expect(page.getByRole('button', { name: 'Stelle hinzufügen' })).toBeEnabled();
  });

  test('Stab ausgeblendet: „Fernmeldeskizze anfügen“ steht am Befehl und gelingt', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await anmeldenAlsAdmin(page);
    const id = await einsatzAnlegen(page, `E2E Fernmeldewesen Anlage ${Date.now()}`);
    await seedeGrund(page, id);
    const { id: befehlId } = await api(page, id).post('befehle', {
      vorlage: 'befehl_lad',
      titel: 'Befehl ohne Stab',
    });
    await stabAusblenden(page, id);
    await wechsleZuRolle(page, 'fuehrungspersonal', id);
    await vorbedingungStabAus(page, id);

    await page.goto(`/einsaetze/${id}/auftraege/befehle/${befehlId}`);
    await page.getByRole('button', { name: 'Fernmeldeskizze anfügen' }).click();
    await expect(
      page.getByRole('link', { name: 'Anlage 1: Fernmeldeskizze herunterladen' }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('Handy (390 px): die Reiter des Moduls ohne Querlauf', async ({ page }) => {
    await page.setViewportSize({ width: BREITE, height: 844 });
    await anmeldenAlsAdmin(page);
    const id = await einsatzAnlegen(page, `E2E Fernmeldewesen schmal ${Date.now()}`);
    await seedeGrund(page, id);
    await page.goto(`/einsaetze/${id}/fernmeldewesen`);
    const leiste = page.getByRole('tablist');
    await expect(leiste.getByRole('tab')).toHaveCount(4);
    const breite = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(breite, 'documentElement.scrollWidth').toBeLessThanOrEqual(BREITE);
    const b = await leiste.boundingBox();
    expect(b, 'Reiterleiste').not.toBeNull();
    expect(b!.x + b!.width, 'rechte Kante der Reiterleiste').toBeLessThanOrEqual(BREITE);
  });
});
