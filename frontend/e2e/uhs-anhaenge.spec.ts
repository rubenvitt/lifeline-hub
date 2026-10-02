import { expect, test, type Locator, type Page } from '@playwright/test';
import { MINI_JPEG } from './bildFixture';

/**
 * Fotos, Pläne und Dateien an einer UHS im Browser (LFH-758, Spec `uhs-anhaenge`): Reiter
 * „Dateien“, Ablegen mit Hinweis auf das Zugriffsprotokoll, Download per Klick, das Protokoll
 * der Einsatzleitung („Zugriffe“), Entfernen und die Treffflächen über die Dichte-Staffel
 * (Prüfliste). Dialog-Fokus und Tabfolge trägt `e2e/schaden-anhaenge.spec.ts`.
 *
 * Geklickt, nicht nur `toBeVisible`. Kein `networkidle` (SSE-Strom).
 */
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const FUEKW = { width: 1280, height: 900 };
const SUBPIXEL = 0.5;
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const STAFFEL = [
  { dichte: 'kompakt', soll: 30 },
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

// Echte Bildbytes: ein Foto-Download wird bereinigt (LFH-747).
const JPG = MINI_JPEG;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.goto('/einsaetze');
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

async function hoehe(ziel: Locator): Promise<number> {
  const kasten = await ziel.boundingBox();
  expect(kasten, 'kein Kasten messbar').not.toBeNull();
  return Math.round(kasten!.height * 10) / 10;
}

async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
    DICHTE_SCHLUESSEL,
    dichte,
  ] as const);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

const paneel = (page: Page) => page.getByRole('region', { name: 'Fotos und Dateien' });

/** UHS per API (Cookie-Jar geteilt); liefert die id. */
async function uhsAnlegen(page: Page, einsatzId: string): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/uhs`, {
    data: { typ: 'behandlungsplatz', bezeichnung: 'BHP 50' },
  });
  expect(antwort.ok(), `UHS: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()).id as number;
}

async function seedeAnhang(page: Page, einsatzId: string, uhsId: number, name: string) {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/uhs/${uhsId}/anhaenge`, {
    multipart: { datei: { name, mimeType: 'image/jpeg', buffer: JPG } },
  });
  expect(antwort.status(), await antwort.text()).toBe(201);
}

async function reiterDateien(page: Page) {
  await page.getByRole('tab', { name: 'Dateien' }).click();
  await expect(paneel(page)).toBeVisible();
}

test('Reiter „Dateien“: ablegen, herunterladen, Zugriff im Protokoll, entfernen', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Behandlungsplatz ${Date.now()}`);
  const uhsId = await uhsAnlegen(page, einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/unfallhilfsstellen/${uhsId}`);
  await reiterDateien(page);
  await expect(paneel(page).getByText('Noch keine Fotos oder Dateien')).toBeVisible();

  await paneel(page).getByRole('button', { name: 'Datei ablegen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Datei ablegen · UHS BHP 50')).toBeVisible();
  await expect(dialog.getByText(/Jeder Abruf einer Datei wird/)).toBeVisible();
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: 'grundriss_halle.jpg', mimeType: 'image/jpeg', buffer: JPG });
  await dialog.getByRole('button', { name: 'Ablegen', exact: true }).click();
  await expect(dialog).toBeHidden();

  const anker = paneel(page).getByRole('link', { name: /^grundriss_halle\.jpg, / });
  await expect(anker).toHaveAttribute(
    'href',
    new RegExp(`/api/einsaetze/${einsatzId}/uhs/${uhsId}/anhaenge/\\d+/datei$`),
  );
  const [download] = await Promise.all([page.waitForEvent('download'), anker.click()]);
  expect(download.suggestedFilename()).toBe('grundriss_halle.jpg');

  // Die Einsatzleitung (Anlegende) sieht den Abruf im Protokoll — erst nach dem Aufklappen.
  await paneel(page).getByText('Zugriffe', { exact: true }).click();
  const zugriffe = paneel(page).locator('.ant-collapse');
  await expect(zugriffe.getByText('bereinigt')).toBeVisible();
  await expect(zugriffe.getByText('grundriss_halle.jpg')).toBeVisible();

  await paneel(page)
    .getByRole('button', { name: 'Datei grundriss_halle.jpg von UHS BHP 50 entfernen' })
    .click();
  const rueckfrage = page.locator('.ant-popover:not(.ant-popover-hidden)');
  await rueckfrage.getByRole('button', { name: 'Entfernen' }).click();
  await expect(anker).toHaveCount(0);

  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByText('UHS BHP 50: Foto abgelegt')).toBeVisible();
  await expect(page.getByText('UHS BHP 50: Foto entfernt')).toBeVisible();
  await expect(page.getByText(/grundriss_halle/)).toHaveCount(0);
});

test.describe('Dichte-Staffel: Download-Anker und Entfernen am UHS', () => {
  for (const { dichte, soll } of STAFFEL) {
    test(`${dichte}: Anker und Entfernen halten ${soll} px`, async ({ page }, testInfo) => {
      test.setTimeout(60_000);
      await anmelden(page);
      const einsatzId = await einsatzAnlegen(page, `E2E Behandlungsplatz ${dichte} ${Date.now()}`);
      const id = await uhsAnlegen(page, einsatzId);
      await seedeAnhang(page, einsatzId, id, 'foto.jpg');
      await page.setViewportSize(FUEKW);
      await page.goto(`/einsaetze/${einsatzId}/unfallhilfsstellen/${id}`);
      await stelleDichte(page, dichte);
      await reiterDateien(page);

      const ziele: Record<string, Locator> = {
        'Download-Anker': paneel(page).getByRole('link', { name: /^foto\.jpg, / }),
        Entfernen: paneel(page).getByRole('button', {
          name: 'Datei foto.jpg von UHS BHP 50 entfernen',
        }),
        'Datei ablegen': paneel(page).getByRole('button', { name: 'Datei ablegen' }),
      };
      const messwerte: string[] = [];
      for (const [name, ziel] of Object.entries(ziele)) {
        await expect(ziel).toBeVisible();
        const h = await hoehe(ziel);
        messwerte.push(`${name}: ${h} px`);
        expect(h, `${name} (${dichte}): ${h} px, Soll ≥ ${soll}`).toBeGreaterThanOrEqual(
          soll - SUBPIXEL,
        );
      }
      const a = (await ziele['Download-Anker'].boundingBox())!;
      const b = (await ziele.Entfernen.boundingBox())!;
      messwerte.push(`Fuge Anker|Entfernen: ${Math.round((b.x - (a.x + a.width)) * 10) / 10} px`);
      await testInfo.attach('Treffflächen', {
        body: `${dichte} (Soll ≥ ${soll} px)\n${messwerte.join('\n')}`,
        contentType: 'text/plain',
      });
    });
  }
});
