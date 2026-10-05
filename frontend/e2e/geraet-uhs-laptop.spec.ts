import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * UHS-Laptop (LFH-892, Subtask LFH-1025; Spec `funktionsansichten` und `feldgeraet-bedienung`):
 * ein Laptop bei 1366 × 768 bearbeitet den Grundriss seiner UHS, liest ihr Material, ohne es
 * umzuhängen, und schickt eine Meldung an die Einsatzleitung, die er danach unter den eigenen
 * Meldungen sieht. Den Status der UHS wechselt er nicht.
 *
 * Seeding als Admin über die API, die Gerätesitzung in einem eigenen Kontext. Kein `networkidle`
 * (LFH-385).
 *
 * Mutationsprobe: in `geraetSicht.ts` `grundriss-bearbeiten` für den Laptop auf `false` → der
 * Schritt „Plätze bearbeiten“ wird rot.
 */

async function anlegen<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, data === undefined ? {} : { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

test('LFH-1025: Laptop bearbeitet den Grundriss, liest Material und meldet an die Einsatzleitung', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatz = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E Laptop ${Date.now()}`,
  });
  const e = einsatz.id;
  const nord = await anlegen(page, `/api/einsaetze/${e}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Nord',
  });
  await anlegen(page, `/api/einsaetze/${e}/uhs/${nord.id}/status`, { status: 'aktiv' });
  const kopplung = await anlegen<{ kopplung: { id: number }; code: { code: string } }>(
    page,
    `/api/einsaetze/${e}/geraete`,
    { ansicht: 'uhs-laptop', uhs_id: nord.id, bezeichnung: 'Laptop 1' },
  );

  const kontext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const laptop = await kontext.newPage();
  try {
    await laptop.goto(`/koppeln#${kopplung.code.code}`);
    await laptop.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(laptop).toHaveURL(new RegExp(`/geraet/${e}/patienten$`));

    const nav = laptop.getByRole('navigation', { name: 'Gerätenavigation' });
    await expect(nav.getByRole('link')).toHaveText(['Patienten', 'Aufnahme', 'Grundriss', 'UHS']);

    // Grundriss: Plätze bearbeiten ja, Status der UHS nein.
    await nav.getByRole('link', { name: 'Grundriss' }).click();
    await expect(laptop.getByRole('heading', { level: 1, name: /UHS Nord/ })).toBeVisible();
    await expect(laptop.getByRole('button', { name: 'Auflösen' })).toHaveCount(0);
    await laptop.getByRole('button', { name: 'Plätze bearbeiten' }).click();
    await expect(laptop.getByRole('button', { name: 'Plätze anlegen' })).toBeVisible();
    await laptop.getByRole('button', { name: 'Plätze anlegen' }).click();
    await laptop.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await expect(laptop.getByText('Platz angelegt')).toBeVisible();

    // Bereich „UHS“: Plätze in Zahlen, Material nur lesend, Meldung an die Einsatzleitung.
    await nav.getByRole('link', { name: 'UHS' }).click();
    await expect(laptop).toHaveURL(new RegExp(`/geraet/${e}/stelle$`));
    await expect(laptop.getByRole('group', { name: 'Plätze in Zahlen' })).toBeVisible();
    await laptop.getByRole('tab', { name: 'Material' }).click();
    await expect(laptop.getByText('Kein Material dieser UHS zugeordnet')).toBeVisible();
    await expect(laptop.getByRole('button', { name: 'Material zuordnen' })).toHaveCount(0);

    await laptop.getByRole('tab', { name: 'Meldungen' }).click();
    await expect(laptop.getByText('Noch keine Meldungen von dieser Stelle')).toBeVisible();
    await laptop.getByLabel('Inhalt').fill('Decken werden knapp');
    await laptop.getByRole('radio', { name: 'dringend' }).click();
    await laptop.getByRole('button', { name: 'Meldung senden' }).click();
    await expect(laptop.getByText('Decken werden knapp')).toBeVisible();

    // Die Einsatzleitung sieht die Meldung mit der Stelle als Absender.
    const meldungen = await page.request.get(`/api/einsaetze/${e}/meldungen`);
    expect(meldungen.ok()).toBeTruthy();
    const liste = (await meldungen.json()) as { inhalt: string; absender: string }[];
    expect(liste.find((m) => m.inhalt === 'Decken werden knapp')?.absender).toBe(
      'UHS Nord · Laptop 1',
    );
  } finally {
    await kontext.close();
  }
});
