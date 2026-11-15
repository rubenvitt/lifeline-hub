import { expect, test, type Browser } from '@playwright/test';
import { einsatzPerApi } from './einsatz-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Rail und Modulpanel sind echte Links (LLH-1732): im Führungsraum mit zwei Monitoren legt
 * Strg/⌘+Klick oder Mittelklick ein Modul in einen neuen Tab, der alte bleibt, wo er war. Nur der
 * Browser zeigt, ob wirklich ein Tab aufgeht; die Klickverteilung selbst prüfen
 * `einsatz/ModulPanel.test.tsx` und `einsatz/IconRail.test.tsx`.
 *
 * Ob der Tab aufgeht, fragt der Test den Browser selbst (CDP `Target.getTargets`), nicht Playwrights
 * `page`-Ereignis: ein nativ per Strg- oder Mittelklick geöffneter Tab schließt seine Navigation
 * mitunter ab, bevor Playwright ihn eingerichtet hat. Dann meldet Playwright ihn gar nicht
 * (`waitForEvent('page')` läuft ab) oder hält eine längst fertige Navigation für ausstehend, und
 * jedes `expect` auf den Tab wartet vergeblich auf „navigation to finish“. Der Browser hatte den
 * Tab mit der richtigen Adresse in jedem dieser Fälle offen (gemessen 15.11.2026, CDP-Protokoll und
 * `Target.getTargets`; ohne diesen Weg auf `alpha` etwa jeder zweite Lauf rot). Nur Chromium.
 */
async function offeneTabs(browser: Browser): Promise<string[]> {
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { targetInfos } = (await cdp.send('Target.getTargets')) as {
      targetInfos: { type: string; url: string }[];
    };
    // Ein Tab im Aufbau trägt noch keine Adresse (`''` oder `about:blank`).
    return targetInfos
      .filter((t) => t.type === 'page' && t.url.startsWith('http'))
      .map((t) => new URL(t.url).pathname);
  } finally {
    await cdp.detach();
  }
}
test('Strg-Klick und Mittelklick öffnen Modul und Kategorie in einem neuen Tab', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await anmeldenAlsAdmin(page, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `E2E Rahmen-Links ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByRole('heading', { level: 1, name: 'ETB' })).toBeVisible();

  const panel = page.locator('[data-lfh="modul-panel"]');
  const betroffene = panel.getByRole('link', { name: /^Betroffene(,|$)/ });
  await betroffene.click({ modifiers: ['ControlOrMeta'] });
  await expect.poll(() => offeneTabs(browser)).toContain(`/einsaetze/${einsatzId}/personen`);

  const rail = page.getByRole('navigation', { name: 'Kategorien' });
  await rail.getByRole('link', { name: 'Lage', exact: true }).click({ button: 'middle' });
  await expect.poll(() => offeneTabs(browser)).toContain(`/einsaetze/${einsatzId}/lage-dashboard`);

  // Der Ausgangstab bleibt im ETB, und die Rail bleibt auf seiner Kategorie.
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/etb$`));
  await expect(rail.getByRole('link', { name: 'Erfassung', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );

  // Gegenprobe: der einfache Klick bleibt im Tab.
  await betroffene.click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen$`));
  // Drei Tabs dieses Einsatzes: Ausgangstab, Modul, Kategorie.
  const eigene = (await offeneTabs(browser)).filter((p) =>
    p.startsWith(`/einsaetze/${einsatzId}/`),
  );
  expect(eigene).toHaveLength(3);
});
