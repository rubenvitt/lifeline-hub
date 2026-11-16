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
 * jedes `expect` auf den Tab wartet vergeblich auf „navigation to finish“ (gemessen 15.11.2026; auf
 * `alpha` etwa jeder zweite Lauf rot). Nur Chromium.
 *
 * Die Adresse allein belegt keinen fertigen Tab: Chromium meldet die angeforderte Adresse schon
 * während der Navigation und behält sie nach einem Fehlschlag. Fertig ist der Tab erst, wenn die
 * App darin den Titel des Einsatzrahmens gesetzt hat („Modul · Einsatz · lifeline-hub“,
 * `useDokumentTitel`); den liest der Test aus demselben `Target.getTargets`.
 */
interface Tab {
  id: string;
  kontext: string;
  pfad: string;
  titel: string;
}

async function offeneTabs(browser: Browser): Promise<Tab[]> {
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { targetInfos } = (await cdp.send('Target.getTargets')) as {
      targetInfos: {
        targetId: string;
        browserContextId: string;
        type: string;
        url: string;
        title: string;
      }[];
    };
    return targetInfos
      .filter((t) => t.type === 'page')
      .map((t) => ({
        id: t.targetId,
        kontext: t.browserContextId,
        // Ein Tab im Aufbau trägt noch keine Adresse (`''` oder `about:blank`).
        pfad: t.url.startsWith('http') ? new URL(t.url).pathname : t.url,
        titel: t.title,
      }));
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
  const bezeichnung = `E2E Rahmen-Links ${Date.now()}`;
  const einsatzId = await einsatzPerApi(page, bezeichnung);
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByRole('heading', { level: 1, name: 'ETB' })).toBeVisible();

  const vorher = await offeneTabs(browser);
  const ausgang = vorher.find((t) => t.pfad === `/einsaetze/${einsatzId}/etb`);
  expect(ausgang, 'Ausgangstab im Browser gefunden').toBeDefined();
  const bekannt = new Set(vorher.map((t) => t.id));
  const rahmenTitel = ` · ${bezeichnung} · lifeline-hub`;

  /** Neue Tabs dieses Kontexts, die auf `pfad` stehen und den Einsatzrahmen fertig gezeigt haben. */
  async function neueFertigeTabs(pfad: string): Promise<number> {
    return (await offeneTabs(browser)).filter(
      (t) =>
        !bekannt.has(t.id) &&
        t.kontext === ausgang!.kontext &&
        t.pfad === pfad &&
        t.titel.endsWith(rahmenTitel) &&
        t.titel.length > rahmenTitel.length,
    ).length;
  }

  // Das ETB steht in der Führung (y3zh5ymv D10); deren Panel ist auf /etb offen.
  const panel = page.locator('[data-lfh="modul-panel"]');
  const einsatzdaten = panel.getByRole('link', { name: /^Einsatzdaten(,|$)/ });
  await einsatzdaten.click({ modifiers: ['ControlOrMeta'] });
  await expect
    .poll(() => neueFertigeTabs(`/einsaetze/${einsatzId}/einsatzdaten`), {
      message: 'Strg-Klick öffnet die Einsatzdaten in einem neuen Tab',
    })
    .toBe(1);

  const rail = page.getByRole('navigation', { name: 'Kategorien' });
  await rail.getByRole('link', { name: 'Lage', exact: true }).click({ button: 'middle' });
  await expect
    .poll(() => neueFertigeTabs(`/einsaetze/${einsatzId}/lage-dashboard`), {
      message: 'Mittelklick öffnet die Kategorie Lage in einem neuen Tab',
    })
    .toBe(1);

  // Der Ausgangstab bleibt im ETB, und die Rail bleibt auf seiner Kategorie.
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/etb$`));
  await expect(rail.getByRole('link', { name: 'Führung', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );

  // Gegenprobe: der einfache Klick bleibt im Tab.
  await einsatzdaten.click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/einsatzdaten$`));
  // Genau drei Tabs in diesem Kontext: Ausgangstab, Modul, Kategorie — kein weiterer, auch kein
  // leerer.
  const imKontext = async () =>
    (await offeneTabs(browser)).filter((t) => t.kontext === ausgang!.kontext).length;
  await expect.poll(imKontext).toBe(3);
});
