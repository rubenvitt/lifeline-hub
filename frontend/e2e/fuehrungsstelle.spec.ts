import { expect, test } from '@playwright/test';
import { einsatzdatenPfad, etbPfad } from '../src/routing/deeplinks';

for (const breite of [1280, 390]) {
  test(`LFH-461: Führungsstelle pflegen und ETB-Entwurf respektieren (${breite}px)`, async ({
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
    await expect(
      dialog.getByRole('textbox', { name: 'Führungsstelle', exact: true }),
    ).toBeFocused();
    expect(
      await dialog
        .getByRole('button', { name: 'Speichern', exact: true })
        .evaluate((knopf) => knopf.closest('form') !== null),
    ).toBe(true);
    await dialog.getByRole('textbox', { name: 'Führungsstelle', exact: true }).fill('Florian A');
    await page.screenshot({
      path: testInfo.outputPath('fuehrungsstelle-pflegen.png'),
      animations: 'disabled',
    });
    // LFH-461 Review: der Detail-Refetch nach dem Speichern kommt erst an,
    // nachdem über die SPA-Navigation das ETB mit seinem alten Cache geöffnet ist.
    let freigeben!: () => void;
    const antwort = new Promise<void>((resolve) => {
      freigeben = resolve;
    });
    let angefragt!: () => void;
    const anfrage = new Promise<void>((resolve) => {
      angefragt = resolve;
    });
    const detailRoute = `**/api/einsaetze/${a}`;
    await page.route(detailRoute, async (route) => {
      angefragt();
      await antwort;
      await route.continue();
    });
    try {
      await dialog.getByRole('textbox', { name: 'Führungsstelle', exact: true }).press('Enter');
      await expect(dialog).not.toBeVisible();
      await expect(
        page.getByRole('button', { name: `Führungsstelle für ${ich.anzeigename} bearbeiten` }),
      ).toHaveText('Florian A');
      await anfrage;
      if (breite < 992)
        await page.getByRole('button', { name: 'Navigation öffnen', exact: true }).click();
      await page.getByRole('button', { name: 'Erfassung', exact: true }).click();
      await page.getByRole('button', { name: 'ETB', exact: true }).click();
      await expect(page).toHaveURL(etbPfad(a));
      await expect(page.getByLabel('ETB-Entwürfe werden geladen')).toBeVisible();
      await expect(page.getByPlaceholder('Inhalt …')).toHaveCount(0);
    } finally {
      freigeben();
    }

    await expect(page.getByText('An: Florian A', { exact: true })).toBeVisible();
    await page.unroute(detailRoute);
    await page.getByPlaceholder('Inhalt …').fill('Entwurf ohne Empfänger');
    await page.getByRole('button', { name: 'Aktionen zu An', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Entfernen', exact: true }).click();
    await expect(page.getByText('An: Florian A', { exact: true })).not.toBeVisible();
    // Ein echter Context-Refetch darf die Entfernung nicht rückgängig machen.
    const geaendert = await page.request.put(`/api/einsaetze/${a}/mitglieder/${ich.id}`, {
      data: { einsatz_rolle: 'einsatzleitung', fuehrungsstelle: 'Neue Leitung A' },
    });
    expect(geaendert.ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByPlaceholder('Inhalt …')).toHaveValue('Entwurf ohne Empfänger');
    await expect(page.getByRole('button', { name: 'Aktionen zu An', exact: true })).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('etb-entwurf-ohne-an.png'),
      animations: 'disabled',
    });

    await page.goto(etbPfad(b));
    await expect(page.getByPlaceholder('Inhalt …')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aktionen zu An', exact: true })).toHaveCount(0);
  });
}
