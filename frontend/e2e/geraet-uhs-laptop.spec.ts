import { expect, test, type Page } from '@playwright/test';
import { waehleIn } from './auswahl-kern';
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
    // Erst die Quittung des Servers: der Text allein stünde schon im Eingabefeld (ein gesteuertes
    // `textarea` trägt seinen Wert als Textinhalt), die Abfrage unten liefe dann der Meldung voraus.
    await expect(laptop.getByText(/Meldung #\d+ gesendet/)).toBeVisible();
    await expect(laptop.getByLabel('Inhalt')).toHaveValue('');
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

/**
 * Stärke der UHS (LFH-1045, Spec `uhs-staerke`): die Einsatzleitung ordnet eine Kraft im Reiter
 * „Kräfte“ zu, der Laptop sieht die Stärke im Bereich „UHS“ und erfasst selbst eine Kraft.
 *
 * Mutationsprobe: in `GeraetStellePage` den Bereich „Kräfte“ gestrichen → der Laptop-Schritt wird
 * rot.
 */
test('LFH-1045: Leitung ordnet eine Kraft zu, der Laptop sieht die Stärke', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatz = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E Stärke ${Date.now()}`,
  });
  const e = einsatz.id;
  const nord = await anlegen(page, `/api/einsaetze/${e}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Nord',
  });
  await anlegen(page, `/api/einsaetze/${e}/uhs/${nord.id}/status`, { status: 'aktiv' });
  await anlegen(page, `/api/einsaetze/${e}/personal`, {
    adhoc: { name: 'Anna Arzt', funktion: 'Notarzt', staerke_position: 'fuehrer' },
  });
  const kopplung = await anlegen<{ kopplung: { id: number }; code: { code: string } }>(
    page,
    `/api/einsaetze/${e}/geraete`,
    { ansicht: 'uhs-laptop', uhs_id: nord.id, bezeichnung: 'Laptop 1' },
  );

  // Einsatzleitung: Reiter „Kräfte“ der UHS-Detailseite.
  await page.goto(`/einsaetze/${e}/unfallhilfsstellen/${nord.id}`);
  await page.getByRole('tab', { name: 'Kräfte' }).click();
  await expect(page.getByTestId('uhs-staerke')).toHaveText('0/0/0//0');
  await page.getByRole('button', { name: 'Kraft zuordnen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Kraft zuordnen' });
  await waehleIn(dialog.getByLabel('Kraft'), 'Anna Arzt · Notarzt');
  await dialog.getByRole('button', { name: 'Zuordnen' }).click();
  await expect(page.getByTestId('uhs-staerke')).toHaveText('1/0/0//1');
  await expect(page.getByRole('row', { name: /Anna Arzt/ })).toBeVisible();

  const kontext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const laptop = await kontext.newPage();
  try {
    await laptop.goto(`/koppeln#${kopplung.code.code}`);
    await laptop.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(laptop).toHaveURL(new RegExp(`/geraet/${e}/patienten$`));
    await laptop
      .getByRole('navigation', { name: 'Gerätenavigation' })
      .getByRole('link', { name: 'UHS' })
      .click();
    await laptop.getByRole('tab', { name: 'Kräfte' }).click();
    await expect(laptop.getByTestId('uhs-staerke')).toHaveText('1/0/0//1');
    await expect(laptop.getByText('Notarzt 1')).toBeVisible();
    // Eine ganze Einheit ordnet nur die Einsatzleitung zu.
    await expect(laptop.getByRole('button', { name: 'Einheit zuordnen' })).toHaveCount(0);

    await laptop.getByRole('button', { name: 'Kraft erfassen' }).click();
    const erfassen = laptop.getByRole('dialog', { name: 'Kraft erfassen' });
    await erfassen.getByLabel('Name').fill('Bernd Berg');
    await erfassen.getByLabel('Funktion').fill('Sanitäter');
    await waehleIn(erfassen.getByLabel('Position'), 'Mannschaft');
    await erfassen.getByRole('button', { name: 'Erfassen' }).click();
    await expect(laptop.getByTestId('uhs-staerke')).toHaveText('1/0/1//2');

    // Die Einsatzleitung sieht dieselbe Stärke im Seitenkopf.
    await page.reload();
    await expect(page.getByText(/Stärke 1\/0\/1\/\/2/)).toBeVisible();
  } finally {
    await kontext.close();
  }
});
