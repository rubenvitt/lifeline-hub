import { expect, test } from '@playwright/test';
import { dialogSteht } from './dialog-kern';
import { einsatzPerApi } from './einsatz-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Ausgang per E-Mail (LLH-2093): ein freigegebener Lagebericht geht an eine Externe Stelle, die
 * Versandliste zeigt „übergeben“. Der e2e-Server stellt nicht über SMTP zu, sondern mit dem
 * aufzeichnenden Doppel (`--ausgang-testzusteller`, `playwright.config.ts`, nur Debug-Build);
 * Anbindung, Stelle und Adresse legt der Test über die API an. Zustellung, Wiederholung und
 * Fehlerfälle stehen in `tests/ausgang_lauf.rs`.
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

    // Ein freigegebener Lagebericht.
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

    await page.goto(`/einsaetze/${einsatzId}/lageberichte/${berichtId}`);
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
