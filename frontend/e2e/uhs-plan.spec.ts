import { expect, test, type Locator, type Page } from '@playwright/test';
import { FOTO_JPEG, MINI_JPEG } from './bildFixture';

/**
 * Plan einer UHS als Hintergrund des Platz-Layouts (LFH-999, Spec `uhs-plan`): hochladen und aus
 * den Dateien übernehmen, Plätze verschieben und einpassen, in „Handschuh“ auf einen Platz über
 * dem Plan tippen, und das Ansehen schreibt nichts ins Zugriffsprotokoll — nur die Übernahme
 * steht dort, genau einmal.
 *
 * Geklickt und getippt, nicht nur `toBeVisible`. Kein `networkidle` (SSE-Strom).
 */
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const FUEKW = { width: 1280, height: 900 };
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

// Erst mit `hasTouch` erlaubt Playwright `tap()`.
test.use({ hasTouch: true });

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function seede<T>(page: Page, pfad: string, data: unknown, was: string): Promise<T> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

interface Kasten {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function kasten(ziel: Locator): Promise<Kasten> {
  const k = await ziel.boundingBox();
  expect(k, 'kein Kasten messbar').not.toBeNull();
  return k!;
}

/** Liegt `innen` ganz in `aussen` (halbe Pixel Rundung erlaubt)? */
function umschliesst(aussen: Kasten, innen: Kasten): boolean {
  const t = 0.5;
  return (
    innen.x >= aussen.x - t &&
    innen.y >= aussen.y - t &&
    innen.x + innen.width <= aussen.x + aussen.width + t &&
    innen.y + innen.height <= aussen.y + aussen.height + t
  );
}

test('Plan: hochladen, übernehmen, einpassen, Tipp in „Handschuh“, Ansehen ohne Protokoll', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const stempel = Date.now();
  const einsatz = await seede<{ id: number }>(
    page,
    '/api/einsaetze',
    { bezeichnung: `E2E UHS-Plan ${stempel}` },
    'Einsatz',
  );
  const e = einsatz.id;
  const uhs = await seede<{ id: number }>(
    page,
    `/api/einsaetze/${e}/uhs`,
    { typ: 'behandlungsplatz', bezeichnung: 'BHP 50' },
    'UHS',
  );
  const u = uhs.id;
  await seede(
    page,
    `/api/einsaetze/${e}/uhs/${u}/plaetze/bulk`,
    { typ: 'bett', menge: 10 },
    'Plätze',
  );
  await seede(page, `/api/einsaetze/${e}/uhs/${u}/status`, { status: 'aktiv' }, 'UHS-Status');
  const abgelegt = await page.request.post(`/api/einsaetze/${e}/uhs/${u}/anhaenge`, {
    multipart: { datei: { name: 'grundriss.jpg', mimeType: 'image/jpeg', buffer: MINI_JPEG } },
  });
  expect(abgelegt.status(), await abgelegt.text()).toBe(201);

  await page.goto(`/einsaetze/${e}/unfallhilfsstellen/${u}`);
  const karten = page.getByTestId('platz-karte');
  await expect(karten).toHaveCount(10);

  // Hochladen im Bearbeiten-Modus.
  await page.getByRole('button', { name: 'Plätze bearbeiten' }).click();
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  const paneel = page.getByRole('region', { name: 'Plan' });
  await expect(paneel.getByText('Nur Pläne, keine Fotos von Patienten.')).toBeVisible();
  await paneel
    .locator('input[type="file"]')
    .setInputFiles({ name: 'halle.jpg', mimeType: 'image/jpeg', buffer: FOTO_JPEG });
  const bild = page.getByTestId('uhs-plan');
  await expect(bild).toHaveAttribute('src', /^blob:/);
  // Die Startlage überdeckt alle Plätze.
  for (const karte of await karten.all()) {
    expect(umschliesst(await kasten(bild), await kasten(karte))).toBe(true);
  }

  // Aus den Dateien übernehmen: ersetzt die Bytes, die Lage bleibt.
  await paneel.getByRole('combobox', { name: 'Aus Dateien übernehmen' }).click();
  const auswahl = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
  await auswahl.getByText('grundriss.jpg').click();
  await paneel.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByText('Plan übernommen')).toBeVisible();
  // Der Browser zeigt die neuen Bytes, nicht den ersten Plan aus seinem HTTP-Cache: die
  // Bildadresse trägt den sha256, die Antwort darf ein Jahr im Cache bleiben.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const img = document.querySelector<HTMLImageElement>('[data-testid="uhs-plan"]');
        return img ? (await (await fetch(img.src)).blob()).size : -1;
      }),
    )
    .toBe(MINI_JPEG.length);

  // Einen Platz weit nach unten rechts verschieben (Server), dann einpassen.
  const detail = await page.request.get(`/api/einsaetze/${e}/uhs/${u}`);
  const plaetze = (await detail.json()).plaetze as { id: number; bezeichnung: string }[];
  const bett1 = plaetze.find((p) => p.bezeichnung === 'Bett 1')!;
  const verschoben = await page.request.patch(`/api/einsaetze/${e}/uhs/${u}/plaetze/${bett1.id}`, {
    data: { pos_x: 970, pos_y: 730 },
  });
  expect(verschoben.ok(), await verschoben.text()).toBeTruthy();
  const bett1Karte = page.getByRole('button', { name: 'Aktionen zu Bett 1', exact: true });
  await expect(bett1Karte).toHaveCSS('left', '970px');
  expect(umschliesst(await kasten(bild), await kasten(bett1Karte))).toBe(false);
  await paneel.getByRole('button', { name: 'An Plätze einpassen' }).click();
  await expect
    .poll(async () => umschliesst(await kasten(bild), await kasten(bett1Karte)))
    .toBe(true);
  for (const karte of await karten.all()) {
    expect(umschliesst(await kasten(bild), await kasten(karte))).toBe(true);
  }

  // In „Handschuh“ öffnet ein Tipp auf einen Platz über dem Plan das Menü.
  await page.evaluate(([s, w]) => window.localStorage.setItem(s, w), [
    DICHTE_SCHLUESSEL,
    'handschuh',
  ] as const);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  await expect(bild).toHaveAttribute('src', /^blob:/);
  const ziel = page.getByRole('button', { name: 'Aktionen zu Bett 2' });
  await ziel.tap();
  await expect(ziel).toHaveAttribute('aria-expanded', 'true');

  // Ansehen ist kein Abruf: nach weiteren Neuladungen steht genau die Übernahme im Protokoll.
  await page.reload();
  await expect(bild).toHaveAttribute('src', /^blob:/);
  await page.reload();
  await expect(bild).toHaveAttribute('src', /^blob:/);
  await page.getByRole('tab', { name: 'Dateien' }).click();
  const dateien = page.getByRole('region', { name: 'Fotos und Dateien' });
  await dateien.getByText('Zugriffe', { exact: true }).click();
  const zeilen = dateien.locator('.ant-collapse .ant-table-tbody tr.ant-table-row');
  await expect(zeilen).toHaveCount(1);
  await expect(zeilen.first()).toContainText('grundriss.jpg');
  await expect(zeilen.first()).toContainText('bereinigt');

  // Das ETB nennt Hinterlegen, keinen Dateinamen und keine Ansicht.
  await page.goto(`/einsaetze/${e}/etb`);
  await expect(page.getByText('UHS BHP 50: Plan hinterlegt').first()).toBeVisible();
  await expect(page.getByText(/halle\.jpg/)).toHaveCount(0);
});
