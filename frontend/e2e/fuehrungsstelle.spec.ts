import { expect, test } from '@playwright/test';
import { einsatzdatenPfad, etbPfad } from '../src/routing/deeplinks';
import { benutzerAnlegen, wechsleZu } from './rollen-kern';

for (const breite of [1280, 390]) {
  test(`Führungsstelle pflegen; im ETB nur Vorschlag des Rufnamens (${breite}px)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: breite, height: 900 });
    await page.goto('/login');
    await page.getByLabel('Benutzername').fill('admin');
    await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page).toHaveURL(/\/einsaetze/);
    const ich = await (await page.request.get('/api/auth/me')).json();
    const anlegen = async (name: string) => {
      const response = await page.request.post('/api/einsaetze', {
        data: { bezeichnung: `${name} ${Date.now()}` },
      });
      expect(response.ok()).toBeTruthy();
      return (await response.json()).id as number;
    };
    const a = await anlegen('Führungsstelle A');
    const b = await anlegen('Führungsstelle B');

    await page.goto(einsatzdatenPfad(a));
    await page
      .getByRole('button', { name: `Führungsstelle für ${ich.anzeigename} bearbeiten` })
      .click();
    const dialog = page.getByRole('dialog');
    // Seit LFH-549 eine Auswahl mit EINEM Wert: Katalogwahl oder Freitext.
    const feld = dialog.getByRole('combobox', { name: 'Führungsstelle', exact: true });
    await expect(feld).toBeFocused();
    expect(
      await dialog
        .getByRole('button', { name: 'Speichern', exact: true })
        .evaluate((knopf) => knopf.closest('form') !== null),
    ).toBe(true);
    await feld.fill('Florian A');
    // Enter übernimmt den Freitext in die Auswahl; gesendet wird über den Knopf im <form> (ein
    // Select schluckt Enter, Erfassungs-Norm).
    await feld.press('Enter');
    await page.screenshot({
      path: testInfo.outputPath('fuehrungsstelle-pflegen.png'),
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: `Führungsstelle für ${ich.anzeigename} bearbeiten` }),
    ).toHaveText('Florian A');

    // Seit LFH-894 belegt die Führungsstelle kein „An“ mehr vor: es gilt der Standard-Rufname
    // (für den Admin gesetzt in `globale-vorbereitung.ts`).
    if (breite < 992)
      await page.getByRole('button', { name: 'Navigation öffnen', exact: true }).click();
    await page.getByRole('button', { name: 'Erfassung', exact: true }).click();
    await page.getByRole('button', { name: 'ETB', exact: true }).click();
    await expect(page).toHaveURL(etbPfad(a));
    await expect(page.getByText('An: ELW 1', { exact: true })).toBeVisible();
    await expect(page.getByText('An: Florian A', { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('etb-an-aus-standard.png'),
      animations: 'disabled',
    });

    // Ohne Standard ist die Führungsstelle der erste Vorschlag der Rufname-Abfrage.
    const konto = await benutzerAnlegen(page, 'fuehrungspersonal');
    const eingetragen = await page.request.put(`/api/einsaetze/${b}/mitglieder/${konto.id}`, {
      data: { einsatz_rolle: 'fuehrungspersonal', fuehrungsstelle: 'Florian B' },
    });
    expect(eingetragen.ok(), await eingetragen.text()).toBeTruthy();
    await wechsleZu(page, konto);
    await page.goto(etbPfad(b));
    const abfrage = page.getByRole('group', { name: 'Mit welchem Rufnamen schreibst du ins ETB?' });
    await expect(
      abfrage.getByRole('combobox', { name: 'Rufname für Von und An', exact: true }),
    ).toHaveValue('Florian B');
    await expect(page.getByRole('button', { name: 'Aktionen zu An', exact: true })).toHaveCount(0);
  });
}
