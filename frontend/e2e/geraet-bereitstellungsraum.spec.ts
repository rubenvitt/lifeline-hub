import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Bereitstellungsraum (LFH-1042; Spec `funktionsansichten`): ein Tablet bei 1024 × 768 nimmt
 * seinen geplanten Raum in Betrieb, meldet eine Einheit an und wieder ab und schickt eine Meldung
 * an die Einsatzleitung. Auflösen, Stornieren und andere Räume gibt es auf dem Gerät nicht.
 *
 * Seeding als Admin über die API, die Gerätesitzung in einem eigenen Kontext. Kein `networkidle`
 * (LFH-385).
 *
 * Mutationsprobe: in `geraetSicht.ts` `br-verwalten` für Geräte auf `true` → der Schritt „kein
 * Stornieren“ wird rot.
 */

async function anlegen<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, data === undefined ? {} : { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

test('LFH-1042: BR-Tablet nimmt den Raum in Betrieb, meldet Kräfte an und ab und meldet', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatz = await anlegen(page, '/api/einsaetze', { bezeichnung: `E2E BR ${Date.now()}` });
  const e = einsatz.id;
  const sportplatz = await anlegen(page, `/api/einsaetze/${e}/bereitstellungsraeume`, {
    bezeichnung: 'BR Sportplatz',
  });
  await anlegen(page, `/api/einsaetze/${e}/bereitstellungsraeume`, { bezeichnung: 'BR Schule' });
  await anlegen(page, `/api/einsaetze/${e}/einheiten`, { name: 'LF Nord' });
  const kopplung = await anlegen<{ kopplung: { id: number }; code: { code: string } }>(
    page,
    `/api/einsaetze/${e}/geraete`,
    { ansicht: 'bereitstellungsraum', stelle_id: sportplatz.id, bezeichnung: 'Tablet BR' },
  );

  const kontext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const tablet = await kontext.newPage();
  try {
    await tablet.goto(`/koppeln#${kopplung.code.code}`);
    await tablet.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/br/${sportplatz.id}$`));

    const nav = tablet.getByRole('navigation', { name: 'Gerätenavigation' });
    await expect(nav.getByRole('link')).toHaveText(['Raum', 'Melden']);
    await expect(tablet.getByRole('heading', { level: 1, name: /BR Sportplatz/ })).toBeVisible();
    await expect(tablet.getByText('BR Schule')).toHaveCount(0);

    // Geplant: in Betrieb nehmen ja, stornieren nein; aktiv: auflösen nein.
    await expect(tablet.getByRole('button', { name: 'Stornieren' })).toHaveCount(0);
    await tablet.getByRole('button', { name: 'In Betrieb nehmen' }).click();
    await expect(tablet.getByRole('button', { name: 'In Betrieb nehmen' })).toHaveCount(0);
    await expect(tablet.getByRole('button', { name: 'Auflösen' })).toHaveCount(0);

    // Anmelden aus „Kräfte ohne BR“, abmelden aus der Belegung.
    await tablet.getByRole('button', { name: 'LF Nord zuweisen' }).click();
    const belegung = tablet.getByRole('button', { name: 'entfernen' });
    await expect(belegung).toHaveCount(1);
    await belegung.click();
    await expect(tablet.getByText('Keine Einheiten bereitgestellt')).toBeVisible();

    await nav.getByRole('link', { name: 'Melden' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/meldungen$`));
    await expect(tablet.getByText('Noch keine Meldungen von dieser Stelle')).toBeVisible();
    await tablet.getByLabel('Inhalt').fill('Raum voll, weitere Kräfte zum BR Schule');
    await tablet.getByRole('button', { name: 'Meldung senden' }).click();
    await expect(tablet.getByText('Raum voll, weitere Kräfte zum BR Schule')).toBeVisible();

    // Die Einsatzleitung sieht den Raum als Status „aktiv“ und die Meldung mit dem Raum als Absender.
    const raum = await page.request.get(
      `/api/einsaetze/${e}/bereitstellungsraeume/${sportplatz.id}`,
    );
    expect(((await raum.json()) as { status: string }).status).toBe('aktiv');
    const meldungen = await page.request.get(`/api/einsaetze/${e}/meldungen`);
    const liste = (await meldungen.json()) as { inhalt: string; absender: string }[];
    expect(
      liste.find((m) => m.inhalt === 'Raum voll, weitere Kräfte zum BR Schule')?.absender,
    ).toBe('BR Sportplatz · Tablet BR');
  } finally {
    await kontext.close();
  }
});
