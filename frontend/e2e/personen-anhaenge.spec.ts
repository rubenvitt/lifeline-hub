import { expect, test, type Locator, type Page } from '@playwright/test';
import { MINI_JPEG } from './bildFixture';

/**
 * Fotos und Dateien an einer Person (LFH-757) im Browser: der Abschnitt der Detailseite lädt
 * erst beim Aufklappen, der Download (Klick, nicht `toBeVisible`) kommt mit dem Dateinamen, das
 * ETB trägt nur die Registriernummer, das Zugriffsprotokoll nennt den Download im Klartext, und
 * die Treffflächen halten die Dichte-Staffel. Dialog, Kontrast und Fokusführung des geteilten
 * Blocks misst `e2e/schaden-anhaenge.spec.ts` (derselbe Baustein).
 *
 * Kein `networkidle` (SSE-Strom). Der Fixture-Name trägt keinen Modulnamen.
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

/** Person per API (Cookie-Jar geteilt); liefert die id. */
async function personAnlegen(page: Page, einsatzId: string): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personen`, {
    data: { name: 'Müller', vorname: 'Erika' },
  });
  expect(antwort.ok(), `Person: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()).id as number;
}

async function seedeAnhang(page: Page, einsatzId: string, personId: number, name: string) {
  const antwort = await page.request.post(
    `/api/einsaetze/${einsatzId}/personen/${personId}/anhaenge`,
    { multipart: { datei: { name, mimeType: 'image/jpeg', buffer: MINI_JPEG } } },
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

const bereich = (page: Page) => page.getByRole('region', { name: 'Fotos und Dateien' });

async function klappeAuf(page: Page) {
  await page.getByRole('button', { name: /Fotos und Dateien/ }).click();
  await expect(bereich(page)).toBeVisible();
}

test('Person: aufklappen, ablegen, herunterladen, protokolliert, pseudonym im ETB, entfernen', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Hochwasser ${Date.now()}`);
  const personId = await personAnlegen(page, einsatzId);
  const listenAbrufe: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith(`/personen/${personId}/anhaenge`)) listenAbrufe.push(r.method());
  });
  await page.goto(`/einsaetze/${einsatzId}/personen/${personId}`);
  await expect(page.getByRole('heading', { name: /Person R-001/ })).toBeVisible();
  expect(listenAbrufe, 'die Liste lädt nicht beim Öffnen der Person').toEqual([]);

  // ── 1 · Aufklappen und Ablegen über den Dialog ──────────────────────────────────────
  await klappeAuf(page);
  await expect(bereich(page).getByText('Noch keine Fotos oder Dateien')).toBeVisible();
  await bereich(page).getByRole('button', { name: 'Datei ablegen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Datei ablegen · Person R-001');
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: 'Erika_Mueller.jpg', mimeType: 'image/jpeg', buffer: MINI_JPEG });
  await dialog.getByRole('button', { name: 'Ablegen', exact: true }).click();
  await expect(dialog).toBeHidden();

  const anker = bereich(page).getByRole('link', { name: /^Erika_Mueller\.jpg, / });
  await expect(anker).toHaveAttribute(
    'href',
    new RegExp(`/api/einsaetze/${einsatzId}/personen/${personId}/anhaenge/\\d+/datei$`),
  );

  // ── 2 · Download per Klick ──────────────────────────────────────────────────────────
  const [download] = await Promise.all([page.waitForEvent('download'), anker.click()]);
  expect(download.suggestedFilename()).toBe('Erika_Mueller.jpg');

  // ── 3 · Zugriffsprotokoll nennt den Download im Klartext ────────────────────────────
  await page.getByRole('button', { name: /Zugriffs-Audit/ }).click();
  await expect(page.getByRole('cell', { name: 'Datei geladen' }).first()).toBeVisible();

  // ── 4 · Pseudonymer ETB-Nachweis ────────────────────────────────────────────────────
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByText('Person R-001: Foto abgelegt')).toBeVisible();
  await expect(page.getByText(/Mueller|Erika/)).toHaveCount(0);

  // ── 5 · Entfernen mit Rückfrage ─────────────────────────────────────────────────────
  await page.goto(`/einsaetze/${einsatzId}/personen/${personId}`);
  await klappeAuf(page);
  await bereich(page)
    .getByRole('button', { name: 'Datei Erika_Mueller.jpg von Person R-001 entfernen' })
    .click();
  const rueckfrage = page.locator('.ant-popover:not(.ant-popover-hidden)');
  await expect(rueckfrage).toContainText('der ETB-Nachweis bleibt');
  await rueckfrage.getByRole('button', { name: 'Entfernen' }).click();
  await expect(bereich(page).getByText('Noch keine Fotos oder Dateien')).toBeVisible();

  // ── 6 · Zugehörigkeit: Liste über die Adresse eines anderen Einsatzes → 404 ──────────
  const andererEinsatz = await einsatzAnlegen(page, `E2E Nebenlage ${Date.now()}`);
  const fremd = await page.request.get(
    `/api/einsaetze/${andererEinsatz}/personen/${personId}/anhaenge`,
  );
  expect(fremd.status()).toBe(404);
});

test('Tab-Folge im Abschnitt: Kopf → Datei ablegen → Anker → Entfernen', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Hochwasser Tab ${Date.now()}`);
  const personId = await personAnlegen(page, einsatzId);
  await seedeAnhang(page, einsatzId, personId, 'arm.jpg');
  await page.goto(`/einsaetze/${einsatzId}/personen/${personId}`);
  const kopf = page.getByRole('button', { name: /Fotos und Dateien/ });
  await kopf.focus();
  await page.keyboard.press('Enter');
  await expect(bereich(page).getByRole('link', { name: /^arm\.jpg, / })).toBeVisible();
  await expect(kopf).toBeFocused();

  const beschreibe = () =>
    page.evaluate(() => {
      const e = document.activeElement;
      if (!e) return '';
      const name = e.getAttribute('aria-label') || e.textContent?.replace(/\s+/g, ' ').trim();
      return `${e.tagName.toLowerCase()}:${name ?? ''}`;
    });
  const reihe: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    reihe.push(await beschreibe());
  }
  testInfo.annotations.push({ type: 'tabfolge', description: reihe.join(' → ') });
  console.log(`[LFH-757] Tabfolge: ${reihe.join(' → ')}`);
  expect(reihe[0]).toBe('button:Datei ablegen');
  expect(reihe[1]).toMatch(/^a:arm\.jpg, .*Datei von Person R-001 herunterladen$/);
  // Der Admin sieht am Foto zusätzlich das Original (LFH-747), danach folgt Entfernen.
  expect(reihe.slice(2)).toContain('button:Datei arm.jpg von Person R-001 entfernen');
});

test.describe('Dichte-Staffel: Abschnitt „Fotos und Dateien“ an der Person', () => {
  for (const { dichte, soll } of STAFFEL) {
    test(`${dichte}: Kopf, Ablegen, Anker und Entfernen halten ${soll} px`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(60_000);
      await anmelden(page);
      const einsatzId = await einsatzAnlegen(page, `E2E Hochwasser ${dichte} ${Date.now()}`);
      const personId = await personAnlegen(page, einsatzId);
      await seedeAnhang(page, einsatzId, personId, 'arm.jpg');
      await page.setViewportSize(FUEKW);
      await page.goto(`/einsaetze/${einsatzId}/personen/${personId}`);
      await stelleDichte(page, dichte);
      await klappeAuf(page);

      const ziele: Record<string, Locator> = {
        Abschnittskopf: page.getByRole('button', { name: /Fotos und Dateien/ }),
        'Datei ablegen': bereich(page).getByRole('button', { name: 'Datei ablegen' }),
        'Download-Anker': bereich(page).getByRole('link', { name: /^arm\.jpg, / }),
        Entfernen: bereich(page).getByRole('button', {
          name: 'Datei arm.jpg von Person R-001 entfernen',
        }),
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
      console.log(`[LFH-757] ${dichte}: ${messwerte.join(' · ')}`);
      await testInfo.attach('Treffflächen', {
        body: `${dichte} (Soll ≥ ${soll} px)\n${messwerte.join('\n')}`,
        contentType: 'text/plain',
      });
    });
  }
});
