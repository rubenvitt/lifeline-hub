import { expect, test, type Page } from '@playwright/test';
import { dialogSteht } from './dialog-kern';
import { einsatzPerApi } from './einsatz-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/** Ein freigegebener Lagebericht in einem frischen Einsatz; liefert die Seite des Berichts. */
async function freigegebenerLagebericht(page: Page, marke: number): Promise<string> {
  const einsatzId = await einsatzPerApi(page, `E2E Ausgang ${marke}`);
  const api = `/api/incidents/${einsatzId}/situation-reports`;
  const bericht = await page.request.post(api, {
    data: {
      vorlage: 'freitext',
      titel: 'Lage Ausgang',
      abschnitte: [{ schluessel: 'text', text: 'Pegel steigt' }],
    },
  });
  expect(bericht.status(), `Lagebericht: ${await bericht.text()}`).toBe(201);
  const berichtId = ((await bericht.json()) as { id: number }).id;
  const frei = await page.request.post(`${api}/${berichtId}/release`);
  expect(frei.ok(), `Freigabe: ${await frei.text()}`).toBe(true);
  return `/einsaetze/${einsatzId}/lageberichte/${berichtId}`;
}

/**
 * Ausgang per E-Mail (LLH-2093) und per Matrix (LLH-2094): ein freigegebener Lagebericht geht an
 * eine Externe Stelle, die Versandliste zeigt „übergeben“. Der e2e-Server stellt weder über SMTP
 * noch über einen Homeserver zu, sondern mit dem aufzeichnenden Doppel (`--ausgang-testzusteller`,
 * `playwright.config.ts`, nur Debug-Build), das beide Kanäle annimmt. Anbindungen und Stellen legt
 * der Test über die API an; den Matrix-Raum trägt er in den Stammdaten über die Oberfläche ein.
 * Zustellung, Wiederholung und Fehlerfälle stehen in `tests/ausgang_lauf.rs` und
 * `tests/ausgang_matrix.rs`.
 */
test('Lagebericht freigeben, an die Leitstelle senden, Versandliste zeigt „übergeben“', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const marke = Date.now();

  // Der Mailserver der Org: eine SMTP-Anbindung (je Org höchstens eine) mit Passwort.
  const vorhanden = await page.request.get('/api/admin/adapter');
  expect(vorhanden.ok(), await vorhanden.text()).toBe(true);
  const { adapter: liste } = (await vorhanden.json()) as { adapter: { art: string }[] };
  if (!liste.some((a) => a.art === 'smtp')) {
    const angelegt = await page.request.post('/api/admin/adapter', {
      data: {
        art: 'smtp',
        name: 'Ausgang e2e',
        einstellungen: {
          host: 'mail.example.org',
          port: 587,
          verschluesselung: 'starttls',
          benutzer: 'versand',
          absender: 'einsatz@example.org',
        },
      },
    });
    expect(angelegt.status(), `Anbindung: ${await angelegt.text()}`).toBe(201);
    const id = ((await angelegt.json()) as { id: string }).id;
    const passwort = await page.request.put(`/api/admin/adapter/${id}/secrets/passwort`, {
      data: { wert: 'e2e-nur-fuer-den-test' },
    });
    expect(passwort.status(), `Passwort: ${await passwort.text()}`).toBe(204);
  }

  // Die Leitstelle mit Mailadresse (Katalog der Org; am Ende deaktiviert).
  const stelleName = `Leitstelle e2e ${marke}`;
  const stelle = await page.request.post('/api/external-agencies', {
    data: { bezeichnung: stelleName, art: 'leitstelle' },
  });
  expect(stelle.status(), `Stelle: ${await stelle.text()}`).toBe(201);
  const stelleId = ((await stelle.json()) as { id: number }).id;
  try {
    const kanal = await page.request.post(`/api/external-agencies/${stelleId}/channels`, {
      data: { channel: 'email', address: `lage-${marke}@leitstelle.example`, label: 'Lage' },
    });
    expect(kanal.status(), `Kanal: ${await kanal.text()}`).toBe(201);

    await page.goto(await freigegebenerLagebericht(page, marke));
    await page.getByRole('button', { name: 'Senden', exact: true }).click();
    const dialog = await dialogSteht(page, 'Senden', { exact: true });
    const haken = dialog.getByRole('checkbox', { name: new RegExp(stelleName) });
    await expect(haken).toBeVisible();
    if (!(await haken.isChecked())) await haken.check();
    await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
    await expect(dialog).toBeHidden();

    const liste2 = page.locator('[data-lfh="versandliste"]');
    await expect(liste2).toContainText(stelleName);
    await expect(liste2).toContainText(`lage-${marke}@leitstelle.example`);
    await expect(liste2.locator('[data-state="uebergeben"]')).toHaveCount(1, { timeout: 20_000 });
    await expect(liste2).toContainText('übergeben');
  } finally {
    await page.request.patch(`/api/external-agencies/${stelleId}`, { data: { aktiv: false } });
  }
});

test('Matrix-Raum an der Stelle eintragen, Lagebericht senden, Versandliste zeigt „übergeben“', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const marke = Date.now();

  // Das Matrix-Konto der Org (je Org höchstens eine Anbindung) mit Access-Token. Ihre
  // Verbindungsprüfung erreicht keinen Homeserver; gestört hält den Versand nicht auf.
  const vorhanden = await page.request.get('/api/admin/adapter');
  expect(vorhanden.ok(), await vorhanden.text()).toBe(true);
  const { adapter: liste } = (await vorhanden.json()) as { adapter: { art: string }[] };
  if (!liste.some((a) => a.art === 'matrix')) {
    const angelegt = await page.request.post('/api/admin/adapter', {
      data: {
        art: 'matrix',
        name: 'Matrix e2e',
        einstellungen: { homeserver: 'https://matrix.example.org' },
      },
    });
    expect(angelegt.status(), `Anbindung: ${await angelegt.text()}`).toBe(201);
    const id = ((await angelegt.json()) as { id: string }).id;
    const token = await page.request.put(`/api/admin/adapter/${id}/secrets/access_token`, {
      data: { wert: 'e2e-nur-fuer-den-test' },
    });
    expect(token.status(), `Token: ${await token.text()}`).toBe(204);
  }

  const stelleName = `Lagezentrum e2e ${marke}`;
  const stelle = await page.request.post('/api/external-agencies', {
    data: { bezeichnung: stelleName, art: 'behoerde' },
  });
  expect(stelle.status(), `Stelle: ${await stelle.text()}`).toBe(201);
  const stelleId = ((await stelle.json()) as { id: number }).id;
  const raum = `#lage-${marke}:example.org`;
  try {
    // Den Raum trägt die Verwaltung an der Stelle ein.
    await page.goto('/admin/stammdaten/externe-stellen');
    const zeile = page.getByRole('row').filter({ hasText: stelleName });
    await zeile.getByRole('button', { name: 'Bearbeiten' }).click();
    const bearbeiten = await dialogSteht(page, 'Externe Stelle bearbeiten');
    await bearbeiten.getByRole('radio', { name: 'Matrix' }).check();
    await bearbeiten.getByRole('textbox', { name: 'Matrix-Raum' }).fill(raum);
    const angelegt = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/external-agencies/${stelleId}/channels`) &&
        r.request().method() === 'POST',
    );
    await bearbeiten.getByRole('button', { name: 'Adresse hinzufügen' }).click();
    expect((await angelegt).status()).toBe(201);
    await expect(bearbeiten.getByText(raum, { exact: true })).toBeVisible();

    await page.goto(await freigegebenerLagebericht(page, marke));
    await page.getByRole('button', { name: 'Senden', exact: true }).click();
    const dialog = await dialogSteht(page, 'Senden', { exact: true });
    const haken = dialog.getByRole('checkbox', { name: new RegExp(`Matrix ${stelleName}`) });
    await expect(haken).toBeVisible();
    if (!(await haken.isChecked())) await haken.check();
    await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
    await expect(dialog).toBeHidden();

    const versandliste = page.locator('[data-lfh="versandliste"]');
    await expect(versandliste).toContainText(`Matrix ${stelleName} · ${raum}`);
    await expect(versandliste.locator('[data-state="uebergeben"]')).toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(versandliste).toContainText('übergeben');
  } finally {
    await page.request.patch(`/api/external-agencies/${stelleId}`, { data: { aktiv: false } });
  }
});
