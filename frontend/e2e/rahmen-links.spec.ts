import { expect, test } from '@playwright/test';
import { einsatzPerApi } from './einsatz-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Rail und Modulpanel sind echte Links (LLH-1732): im Führungsraum mit zwei Monitoren legt
 * Strg/⌘+Klick oder Mittelklick ein Modul in einen neuen Tab, der alte bleibt, wo er war. Nur der
 * Browser zeigt, ob wirklich ein Tab aufgeht; die Klickverteilung selbst prüfen
 * `einsatz/ModulPanel.test.tsx` und `einsatz/IconRail.test.tsx`.
 */
test('Strg-Klick und Mittelklick öffnen Modul und Kategorie in einem neuen Tab', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await anmeldenAlsAdmin(page, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `E2E Rahmen-Links ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByRole('heading', { level: 1, name: 'ETB' })).toBeVisible();

  const panel = page.locator('[data-lfh="modul-panel"]');
  const betroffene = panel.getByRole('link', { name: /^Betroffene(,|$)/ });
  const [tabModul] = await Promise.all([
    context.waitForEvent('page'),
    betroffene.click({ modifiers: ['ControlOrMeta'] }),
  ]);
  await expect(tabModul).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen$`));

  const rail = page.getByRole('navigation', { name: 'Kategorien' });
  const [tabKategorie] = await Promise.all([
    context.waitForEvent('page'),
    rail.getByRole('link', { name: 'Lage', exact: true }).click({ button: 'middle' }),
  ]);
  await expect(tabKategorie).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lage-dashboard$`));

  // Der Ausgangstab bleibt im ETB, und die Rail bleibt auf seiner Kategorie.
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/etb$`));
  await expect(rail.getByRole('link', { name: 'Erfassung', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );

  // Gegenprobe: der einfache Klick bleibt im Tab.
  await betroffene.click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen$`));
  expect(context.pages()).toHaveLength(3);
});
