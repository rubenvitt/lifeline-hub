import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Fotos und Dateien an einem Schaden im Browser (LFH-21).
 *
 * Was nur hier messbar ist: der Download (ein echter `<a href download>` auf die
 * Schadensroute — ob ein Download-Ereignis mit dem Dateinamen entsteht, entscheidet der
 * Browser mit dem `Content-Disposition` des Backends), der Fokus beim Öffnen (der verborgene
 * Datei-Input ist im Browser nicht fokussierbar), die Tab-Reihenfolge im Dialog (LFH-117 hatte
 * an antds `Upload` einen zweiten Tab-Stopp um den Auslöser gemessen) und die Treffflächen über
 * die Dichte-Staffel. Belege der Prüfliste
 * `docs/superpowers/specs/2026-09-25-lfh-21-pruefliste.md`.
 *
 * Bewusst geklickt, nicht nur `toBeVisible` (CLAUDE.md, LFH-355): sichtbar ist kein Beleg für
 * bedienbar. Kein `networkidle` (offener SSE-Strom, LFH-385). Der Fixture-Name trägt keinen
 * Modulnamen (Memory `e2e-fixture-namen-ohne-modulnamen`).
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

const JPG = Buffer.from('\xff\xd8\xff\xe0 e2e schaden', 'binary');

// Login-/Anlege-Helfer kopiert — es gibt (noch) kein geteiltes e2e-Hilfsmodul.
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

/** Schaden per API (Cookie-Jar geteilt); liefert die id. */
async function schadenAnlegen(page: Page, einsatzId: string): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/schaeden`, {
    data: { typ: 'sachschaden', ausmass: 'gering', ort: 'Hauptstr. 1' },
  });
  expect(antwort.ok(), `Schaden: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()).id as number;
}

async function seedeAnhang(page: Page, einsatzId: string, schadenId: number, name: string) {
  const antwort = await page.request.post(
    `/api/einsaetze/${einsatzId}/schaeden/${schadenId}/anhaenge`,
    { multipart: { datei: { name, mimeType: 'image/jpeg', buffer: JPG } } },
  );
  expect(antwort.status(), await antwort.text()).toBe(201);
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

test('legt ab, lädt herunter, schreibt den pseudonymen ETB-Nachweis und entfernt', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Sturmlage ${Date.now()}`);
  const schadenId = await schadenAnlegen(page, einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/schaeden/${schadenId}`);
  await expect(paneel(page).getByText('Noch keine Fotos oder Dateien')).toBeVisible();

  // ── 1 · Ablegen über den Dialog ─────────────────────────────────────────────────────
  await paneel(page).getByRole('button', { name: 'Datei ablegen' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.locator('button.ant-btn', { hasText: 'Datei wählen' }),
    'Fokus liegt beim Öffnen auf „Datei wählen“, nicht auf dem verborgenen Input',
  ).toBeFocused();
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: 'Müller_Hauswand.jpg', mimeType: 'image/jpeg', buffer: JPG });
  await dialog.getByRole('button', { name: 'Ablegen', exact: true }).click();
  await expect(dialog).toBeHidden();

  const anker = paneel(page).getByRole('link', { name: /^Müller_Hauswand\.jpg, / });
  await expect(anker).toBeVisible();
  await expect(anker).toHaveAttribute(
    'href',
    new RegExp(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}/anhaenge/\\d+/datei$`),
  );

  // ── 2 · Download per Klick ──────────────────────────────────────────────────────────
  const [download] = await Promise.all([page.waitForEvent('download'), anker.click()]);
  expect(download.suggestedFilename()).toBe('Müller_Hauswand.jpg');

  // ── 3 · Pseudonymer ETB-Nachweis ────────────────────────────────────────────────────
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByText('Schaden S-001: Foto abgelegt')).toBeVisible();
  await expect(page.getByText(/Hauswand/)).toHaveCount(0);

  // ── 4 · Entfernen mit Rückfrage ─────────────────────────────────────────────────────
  await page.goto(`/einsaetze/${einsatzId}/schaeden/${schadenId}`);
  await paneel(page)
    .getByRole('button', { name: 'Datei Müller_Hauswand.jpg von Schaden S-001 entfernen' })
    .click();
  const rueckfrage = page.locator('.ant-popover:not(.ant-popover-hidden)');
  await expect(rueckfrage).toContainText('der ETB-Nachweis bleibt');
  await rueckfrage.getByRole('button', { name: 'Entfernen' }).click();
  await expect(anker).toHaveCount(0);
  await expect(paneel(page).getByText('Noch keine Fotos oder Dateien')).toBeVisible();

  // ── 5 · Zugehörigkeit: Liste über die Adresse eines anderen Einsatzes → 404 ──────────
  const andererEinsatz = await einsatzAnlegen(page, `E2E Nebenlage ${Date.now()}`);
  const fremd = await page.request.get(
    `/api/einsaetze/${andererEinsatz}/schaeden/${schadenId}/anhaenge`,
  );
  expect(fremd.status()).toBe(404);
});

test('Tab-Reihenfolge im Ablegen-Dialog: kein zweiter Tab-Stopp um „Datei wählen“', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Sturmlage Tab ${Date.now()}`);
  const schadenId = await schadenAnlegen(page, einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/schaeden/${schadenId}`);
  await paneel(page).getByRole('button', { name: 'Datei ablegen' }).first().focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  const dateiKnopf = dialog.locator('button.ant-btn', { hasText: 'Datei wählen' });
  await expect(dateiKnopf).toBeFocused();

  const beschreibe = () =>
    page.evaluate(() => {
      const e = document.activeElement;
      if (!e) return '';
      const text = e.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      return `${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[${e.getAttribute('role')}]` : ''}:${text || e.getAttribute('aria-label') || ''}`;
    });
  const reihe = [await beschreibe()];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    reihe.push(await beschreibe());
  }
  testInfo.annotations.push({ type: 'tabfolge', description: reihe.join(' → ') });
  console.log(`[LFH-21] Tabfolge: ${reihe.join(' → ')}`);
  expect(reihe[0]).toBe('button:Datei wählen');
  // Der nächste Stopp ist ein Knopf der Fußzeile, kein `span[role=button]` um den Auslöser.
  expect(reihe[1], `Reihe: ${reihe.join(' → ')}`).not.toMatch(/^span/);
  expect(reihe[1], `Reihe: ${reihe.join(' → ')}`).not.toContain('Datei wählen');
});

test.describe('Dichte-Staffel: Download-Anker und Entfernen am Schaden', () => {
  for (const { dichte, soll } of STAFFEL) {
    test(`${dichte}: Anker und Entfernen halten ${soll} px`, async ({ page }, testInfo) => {
      test.setTimeout(60_000);
      await anmelden(page);
      const einsatzId = await einsatzAnlegen(page, `E2E Sturmlage ${dichte} ${Date.now()}`);
      const schadenId = await schadenAnlegen(page, einsatzId);
      await seedeAnhang(page, einsatzId, schadenId, 'dach.jpg');
      await page.setViewportSize(FUEKW);
      await page.goto(`/einsaetze/${einsatzId}/schaeden/${schadenId}`);
      await stelleDichte(page, dichte);

      const ziele: Record<string, Locator> = {
        'Download-Anker': paneel(page).getByRole('link', { name: /^dach\.jpg, / }),
        Entfernen: paneel(page).getByRole('button', {
          name: 'Datei dach.jpg von Schaden S-001 entfernen',
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
