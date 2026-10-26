import { expect, test, type Page } from '@playwright/test';
import { kopfFilterAusloeser, kopfFilterWaehlen } from './kopffilter-kern';
import {
  anmeldenAls,
  anmeldenAlsAdmin,
  benachrichtigungenQuittieren,
  benutzerAnlegen,
  mitgliedEintragen,
  wechsleZuRolle,
} from './rollen-kern';

/**
 * Sortieren und Filtern im Spaltenkopf, Zustand in der Adresse (LLH-1086, Spec
 * `tabellen-sortieren-filtern`), an der Vorbildseite Schäden: Kopffilter und Sortierklick schreiben
 * die Adresse, Zurück aus dem Detail und Neuladen stellen dieselbe Sicht her, der Rückweg ohne
 * Parameter kommt aus der Sitzung, „Filter zurücksetzen“ leert Filter und Suche. Der Kartenzweig
 * auf 390 px zeigt dieselbe Menge und sortiert über „Sortieren“. Als Admin und als Beobachter
 * (`e2e/AGENTS.md`, Rollen): die Liste ist ein Lesepfad beider; ein geteilter Link trägt die Sicht.
 * Den Stand der Sitzung räumt jeder Kontowechsel, auch einer aus einem anderen Tab (LLH-1428).
 */

async function einsatzMitSchaeden(page: Page): Promise<string> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Tabelle filtern ${Date.now()}` },
  });
  expect(r.ok(), `POST /api/einsaetze: ${r.status()} ${await r.text()}`).toBe(true);
  const einsatzId = String(((await r.json()) as { id: number }).id);
  const schaeden = [
    { ausmass: 'gering', ort: 'Bachstraße 1' },
    { ausmass: 'gross', ort: 'Deichweg 2' },
    { ausmass: 'gross', ort: 'Am Anger 3' },
    { ausmass: 'mittel', ort: 'Zollhof 4' },
  ];
  // Nacheinander: die Registriernummern folgen so der Liste.
  for (const s of schaeden) {
    const a = await page.request.post(`/api/einsaetze/${einsatzId}/schaeden`, {
      data: { typ: 'sachschaden', ...s },
    });
    expect(a.ok(), `POST schaeden: ${a.status()} ${await a.text()}`).toBe(true);
  }
  return einsatzId;
}

/** Die oberste Zeile der Tabelle (antds Messzeile trägt keinen Zeilenschlüssel). */
function ersteZeile(page: Page) {
  return page.locator('.ant-table-tbody tr[data-row-key]').first();
}

async function erwarteGrosseSicht(page: Page) {
  await expect(page.getByText('Deichweg 2')).toBeVisible();
  await expect(page.getByText('Am Anger 3')).toBeVisible();
  await expect(page.getByText('Bachstraße 1')).toHaveCount(0);
  await expect(page.getByText('Zollhof 4')).toHaveCount(0);
  await expect(kopfFilterAusloeser(page, 'Ausmaß')).toHaveAccessibleName(
    'Ausmaß filtern, gefiltert',
  );
  await expect(page.getByRole('button', { name: 'Filter Ausmaß: groß entfernen' })).toBeVisible();
  await expect(page.locator('[data-lfh="filterhinweis"]')).toContainText('Gefiltert');
}

test.describe('Schäden: Sortieren und Filtern im Spaltenkopf', () => {
  test.setTimeout(120_000);

  test('Zustand in der Adresse, Zurück, Neuladen und Sitzung — als Admin und als Beobachter', async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzMitSchaeden(page);
    const liste = `/einsaetze/${einsatzId}/schaeden`;

    await page.goto(liste);
    await expect(page.getByText('Zollhof 4')).toBeVisible();
    // Vorbedingung: ohne Wahl steht kein Listenparameter in der Adresse und kein Hinweis.
    expect(new URL(page.url()).search).toBe('');
    await expect(page.locator('[data-lfh="filterhinweis"]')).toHaveCount(0);

    // Kopffilter → `f.ausmass=gross` (Wert, nicht Text), entprellt mit `replace` geschrieben.
    await kopfFilterWaehlen(page, 'Ausmaß', ['groß']);
    await expect(page).toHaveURL(/[?&]f\.ausmass=gross(&|$)/);
    await erwarteGrosseSicht(page);

    // Sortierklick auf „Ort“ → aufsteigend, „Am Anger 3“ vor „Deichweg 2“.
    await page.getByRole('columnheader', { name: /Ort/ }).getByText('Ort', { exact: true }).click();
    await expect(page).toHaveURL(/[?&]sort=ort%3Aauf(&|$)|[?&]sort=ort:auf(&|$)/);
    await expect(ersteZeile(page)).toContainText('Am Anger 3');

    // Ins Detail und zurück: dieselbe Sicht.
    await page.getByText('Deichweg 2').click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/schaeden/\\d+`));
    await page.goBack();
    await expect(page).toHaveURL(/f\.ausmass=gross/);
    await erwarteGrosseSicht(page);
    await expect(ersteZeile(page)).toContainText('Am Anger 3');

    // Neuladen: dieselbe Sicht.
    await page.reload();
    await erwarteGrosseSicht(page);
    await expect(ersteZeile(page)).toContainText('Am Anger 3');
    const geteilt = page.url();

    // Rückweg ohne Parameter (Modulmenü): der Stand der Sitzung, wieder in der Adresse.
    await page.goto(liste);
    await erwarteGrosseSicht(page);
    await expect(page).toHaveURL(/f\.ausmass=gross/);

    // Kartenzweig: dieselbe Menge, sortiert über „Sortieren“.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText('Deichweg 2')).toBeVisible();
    await expect(page.getByText('Zollhof 4')).toHaveCount(0);
    const sortieren = page.getByRole('combobox', { name: 'Sortieren' });
    await expect(sortieren).toBeVisible();
    await page.setViewportSize({ width: 1366, height: 900 });

    // „Filter zurücksetzen“ leert Filter und Suche; die Sortierung bleibt.
    await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
    await expect(page.getByText('Zollhof 4')).toBeVisible();
    await expect(page).not.toHaveURL(/f\.ausmass/);
    await expect(page).toHaveURL(/sort=ort/);
    await expect(page.locator('[data-lfh="filterchips"]')).toHaveCount(0);

    // Beobachter: den Stand der Sitzung (hier noch die Sortierung) räumt der Kontowechsel. Das
    // Abmelden über die API sieht die App nicht; es räumen der Start der Anmeldeseite ohne Sitzung
    // (401 beim Start) und sicher die Bindung an den Benutzer bei der Anmeldung (LLH-1428). Ohne
    // Parameter beginnt die Liste daher ohne die Sicht des Admins.
    await wechsleZuRolle(page, 'beobachter', einsatzId);
    await page.goto(liste);
    await expect(page.getByText('Zollhof 4')).toBeVisible();
    await expect(page.locator('[data-lfh="filterhinweis"]')).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');

    // Der geteilte Link trägt die Sicht.
    await page.goto(geteilt);
    await erwarteGrosseSicht(page);
    await expect(ersteZeile(page)).toContainText('Am Anger 3');
    await expect(page.getByRole('button', { name: 'Schaden erfassen' })).toHaveCount(0);
  });

  test('Kontowechsel in einem anderen Tab: nach dem Neuladen keine Sicht der vorigen Person (LLH-1428)', async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzMitSchaeden(page);
    const liste = `/einsaetze/${einsatzId}/schaeden`;
    const beobachter = await benutzerAnlegen(page, 'beobachter');
    await mitgliedEintragen(page, einsatzId, beobachter.id, 'beobachter');
    await benachrichtigungenQuittieren(beobachter);

    await page.goto(liste);
    await kopfFilterWaehlen(page, 'Ausmaß', ['groß']);
    await expect(page).toHaveURL(/[?&]f\.ausmass=gross(&|$)/);
    // Vorbedingung: der Stand liegt in der Sitzung, der Rückweg ohne Parameter bringt ihn.
    await page.goto(liste);
    await erwarteGrosseSicht(page);

    // Ein zweiter Tab meldet über die Anmeldeseite den Beobachter an, ohne vorher abzumelden
    // (`auth/AGENTS.md`); dieser Tab lädt über den Konfliktdialog neu, die Sitzung überlebt das.
    const tab2 = await page.context().newPage();
    await anmeldenAls(tab2, beobachter.benutzername, beobachter.passwort);
    const dialog = page.getByRole('dialog').filter({ hasText: 'Anderer Benutzer angemeldet' });
    await dialog.getByRole('button', { name: /weiterarbeiten$/ }).click();
    await expect(page).toHaveURL(/\/einsaetze$/);
    await tab2.close();

    // Rückweg ohne Parameter: kein Filter der vorigen Person.
    await page.goto(liste);
    await expect(page.getByText('Zollhof 4')).toBeVisible();
    await expect(page.getByText('Bachstraße 1')).toBeVisible();
    await expect(page.locator('[data-lfh="filterhinweis"]')).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
  });
});
