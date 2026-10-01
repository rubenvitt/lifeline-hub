import { expect, test, type Locator, type Page } from '@playwright/test';
import { kontrast, pruefe } from './kontrast-kern';

// Zeilen im Paneel „Ebenen" der Lagekarte (LFH-671): Name und Anzahl jeder schaltbaren Zeile,
// ein- wie ausgeschaltet, in Ruhe und unter dem Zeiger — Tag ≥ 7 : 1, Nacht ≥ 5 : 1. Den
// Aus-Zustand tragen Farbfeld und `aria-checked`, nicht eine leisere Schrift. Gemessen wird
// die zusammengesetzte Paarung im Browser (`kontrast-kern.ts`), nicht der Token.

async function vorbereiten(page: Page, modus: 'light' | 'dark') {
  await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(`Ebenen ${modus} ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
  const eid = page.url().match(/\/einsaetze\/(\d+)/)![1];
  await page.goto(`/einsaetze/${eid}/lagekarte`);
}

for (const modus of ['light', 'dark'] as const) {
  const minimum = modus === 'light' ? 7 : 5;

  test(`${modus}: Ebenen-Zeilen ein und aus, in Ruhe und unter dem Zeiger (LFH-671)`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    // Ab `lg` steht die Leiste neben der Karte (`leistenWahl.ts`).
    await page.setViewportSize({ width: 1366, height: 900 });
    await vorbereiten(page, modus);
    const gruppe = page.getByRole('group', { name: 'Ebenen ein- und ausblenden' });
    const schalter = gruppe.getByRole('switch');
    await expect(schalter.first()).toBeVisible({ timeout: 30_000 });
    const anzahl = await schalter.count();
    expect(anzahl, 'schaltbare Ebenen-Zeilen').toBeGreaterThan(5);
    const werte: string[] = [];

    async function misst(ziel: Locator, name: string) {
      await pruefe(ziel, minimum, `${modus}/${name}`);
      werte.push(`${name} ${(await kontrast(ziel)).verhaeltnis.toFixed(2)}`);
    }

    for (let i = 0; i < anzahl; i++) {
      const zeile = schalter.nth(i);
      const ebene = await zeile.getAttribute('data-ebene');
      // Kinder der Zeile: Farbfeld · Name · Anzahl (`EbenenZeilenKnopf`).
      const name = zeile.locator(':scope > span').nth(1);
      const zahl = zeile.locator(':scope > span').nth(2);
      for (let schritt = 0; schritt < 2; schritt++) {
        const an = (await zeile.getAttribute('aria-checked')) === 'true';
        const zustand = `${ebene}/${an ? 'an' : 'aus'}`;
        await page.mouse.move(0, 0);
        await misst(name, `${zustand}/Name`);
        await misst(zahl, `${zustand}/Anzahl`);
        await zeile.hover();
        await misst(name, `${zustand}/Name+hover`);
        await misst(zahl, `${zustand}/Anzahl+hover`);
        // Einmal umschalten, damit beide Zustände gemessen sind; der zweite Klick stellt den
        // Ausgangszustand wieder her.
        await zeile.click();
        await expect(zeile).toHaveAttribute('aria-checked', String(!an));
      }
    }

    test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
  });
}
