import { expect, test, type Locator, type Page } from '@playwright/test';
import { kontrast } from './kontrast-kern';

/**
 * Prüfliste Einsatztauglichkeit für den Bedienweg „Anhang" im ETB (LFH-117, Aufgabe 9.1;
 * Protokoll in `docs/superpowers/specs/2026-09-24-lfh-117-pruefliste.md`).
 *
 * Gemessen wird im Browser, nicht in Vitest (jsdom rechnet kein Layout, und `test/utils.tsx`
 * rendert ein nacktes `ConfigProvider` ohne Dichte):
 *  · Kriterium 3 (Trefferflächen): „Anhang", der Entfernen-Knopf einer gewählten Datei und
 *    der Download-Verweis in der Zeitachse erreichen in der Stufe „handschuh" 72 px — Boden
 *    als Literal, nicht aus dem Token zurückgelesen;
 *  · Kriterium 5 (Kontrast): Verweis, Dateiliste und Offline-Hinweis gegen den Grund, auf dem
 *    sie WIRKLICH stehen — Tag ≥ 7 : 1, Nacht ≥ 5 : 1 (LFH-618).
 *
 * Die Bildschirmfotos hängen als Anlage am Testbericht; sie sind der Beleg der
 * Sichtprüfung, nicht ihre Zusicherung.
 */

const ZIEL = { light: 7, dark: 5 } as const;
const HANDSCHUH = 72;
const JPG = Buffer.from('JPEGDATEN-LFH-117');

async function anmelden(page: Page, modus: 'light' | 'dark', dichte: string) {
  await page.addInitScript(
    ([m, d]) => {
      localStorage.setItem('lifeline-hub.theme', m);
      localStorage.setItem('lifeline-hub.dichte', d);
    },
    [modus, dichte] as const,
  );
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Einsatz mit einem Eintrag samt Foto, gesät über die API. */
async function saeen(page: Page, modus: string): Promise<number> {
  const einsatz = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E 117 ${modus} ${Date.now()}` },
  });
  expect(einsatz.ok()).toBeTruthy();
  const { id } = (await einsatz.json()) as { id: number };
  const upload = await page.request.post(`/api/einsaetze/${id}/etb/anhaenge`, {
    multipart: { datei: { name: 'IMG_0412.HEIC', mimeType: 'image/heic', buffer: JPG } },
  });
  expect(upload.ok(), `Upload: ${upload.status()}`).toBeTruthy();
  const [{ id: anhang }] = (await upload.json()) as { id: number }[];
  const eintrag = await page.request.post(`/api/einsaetze/${id}/etb`, {
    data: { typ: 'meldung', inhalt: 'Foto der Schadenstelle', anhang_ids: [anhang] },
  });
  expect(eintrag.ok()).toBeTruthy();
  return id;
}

async function hoehe(ziel: Locator): Promise<number> {
  await expect(ziel).toBeVisible();
  let h = 0;
  await expect
    .poll(async () => {
      h = (await ziel.boundingBox())?.height ?? 0;
      return h;
    })
    .toBeGreaterThan(0);
  return h;
}

async function kontrastMindestens(ziel: Locator, minimum: number, name: string) {
  await expect(ziel, name).toBeVisible();
  await expect(async () => {
    const m = await kontrast(ziel);
    expect(m.verhaeltnis, `${name}: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(minimum);
  }).toPass({ timeout: 10_000 });
}

for (const modus of ['light', 'dark'] as const) {
  test(`${modus}: Kontrast von Verweis, Dateiliste und Offline-Hinweis`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await anmelden(page, modus, 'kompakt');
    const einsatz = await saeen(page, modus);
    await page.goto(`/einsaetze/${einsatz}/etb`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);

    const verweis = page
      .locator('[data-lfh="etb-zeitachse"]')
      .getByRole('link', { name: /Anhang zu Nr\. 1 herunterladen/ });
    await kontrastMindestens(verweis, ZIEL[modus], 'Download-Verweis');

    await page
      .locator('[data-lfh="etb-anhang-eingabe"]')
      .setInputFiles({ name: 'Fax Leitstelle.pdf', mimeType: 'application/pdf', buffer: JPG });
    const zeile = page
      .getByRole('list', { name: 'Gewählte Anhänge' })
      .getByText(/^Fax Leitstelle\.pdf · /);
    await kontrastMindestens(zeile, ZIEL[modus], 'Dateiliste');
    await info.attach(`online-${modus}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await context.setOffline(true);
    try {
      const hinweis = page.getByText(
        'Anhänge brauchen eine Verbindung. Der Text lässt sich trotzdem erfassen.',
      );
      await kontrastMindestens(hinweis, ZIEL[modus], 'Offline-Hinweis');
      await info.attach(`offline-${modus}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await context.setOffline(false);
    }
  });
}

test('handschuh: „Anhang", Entfernen und Verweis tragen 72 px', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await anmelden(page, 'dark', 'handschuh');
  const einsatz = await saeen(page, 'handschuh');
  await page.goto(`/einsaetze/${einsatz}/etb`);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');

  await page
    .locator('[data-lfh="etb-anhang-eingabe"]')
    .setInputFiles({ name: 'Foto.jpg', mimeType: 'image/jpeg', buffer: JPG });

  const messungen = {
    anhang: await hoehe(page.getByRole('button', { name: 'Anhang', exact: true })),
    entfernen: await hoehe(page.getByRole('button', { name: 'Anhang Foto.jpg entfernen' })),
    verweis: await hoehe(
      page
        .locator('[data-lfh="etb-zeitachse"]')
        .getByRole('link', { name: /Anhang zu Nr\. 1 herunterladen/ }),
    ),
  };
  await info.attach('handschuh', { body: await page.screenshot(), contentType: 'image/png' });
  for (const [name, h] of Object.entries(messungen)) {
    expect(h, `${name}: ${h}px`).toBeGreaterThanOrEqual(HANDSCHUH);
  }
});
