import { expect, test, type Page } from '@playwright/test';

// LFH-459: Eine feste Reserve verschenkt Platz oder schiebt die Unterkante aus dem
// Fenster. Echte Layout-Messung; jsdom kann diesen Fehler nicht nachweisen.
async function aufbauen(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);

  async function anlegen(pfad: string, data: unknown) {
    const antwort = await page.request.post(pfad, { data });
    expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
    return await antwort.json() as { id: number };
  }
  const einsatz = await anlegen('/api/einsaetze', { bezeichnung: `E2E UHS Höhe ${Date.now()}` });
  const uhs = await anlegen(`/api/einsaetze/${einsatz.id}/uhs`, {
    typ: 'behandlungsplatz', bezeichnung: 'BHP Höhenprüfung',
  });
  await anlegen(`/api/einsaetze/${einsatz.id}/uhs/${uhs.id}/plaetze/bulk`, { typ: 'bett', menge: 2 });
  return `/einsaetze/${einsatz.id}/unfallhilfsstellen/${uhs.id}`;
}

test('UHS mit langem Kopf erhält eine nutzbare Arbeitsfläche vor den nachfolgenden Reitern', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pfad = await aufbauen(page);
  await page.evaluate(() => localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
  // Fachlich zulässige lange Notiz: sie steht vollständig im Seitenkopf. Nur die
  // API-Antwort wird erweitert; Layout, Datenpfad und Grundriss bleiben echt.
  await page.route(/\/api\/einsaetze\/\d+\/uhs\/\d+$/, async (route) => {
    const antwort = await route.fetch();
    await route.fulfill({
      response: antwort,
      json: { ...await antwort.json(), notiz: 'Zugang über den Seiteneingang. Anmeldung im Vorraum, Materialausgabe gegenüber. '.repeat(10) },
    });
  });
  await page.goto(pfad);
  await expect(page.getByText('Bett 2', { exact: true })).toBeVisible();
  const grundriss = page.getByTestId('grundriss-rahmen');
  // Die bisherige Mindest-Arbeitsfläche war 380px; sie ist kein Kopf-Abzug.
  expect((await grundriss.boundingBox())!.height).toBeGreaterThanOrEqual(380);
  const reihenfolge = await grundriss.evaluate((el) => {
    const material = [...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === 'Material')!;
    return material.getBoundingClientRect().top - el.getBoundingClientRect().bottom;
  });
  expect(reihenfolge).toBeGreaterThanOrEqual(0);
  await page.getByRole('button', { name: 'Plätze anlegen', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Menge' })).toBeVisible();
});

async function grundrissMessen(page: Page) {
  return page.getByTestId('grundriss-rahmen').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const content = el.closest('main')!;
    return {
      oben: r.top + window.scrollY,
      unten: r.bottom + window.scrollY,
      hoehe: r.height,
      fenster: window.innerHeight,
      polster: parseFloat(getComputedStyle(content).paddingBottom),
    };
  });
}

async function passtInsFenster(page: Page) {
  await expect(page.getByTestId('grundriss-rahmen')).toBeVisible();
  await expect.poll(async () => {
    const m = await grundrissMessen(page);
    return Math.abs(m.unten - (m.fenster - m.polster));
  }, { message: 'Grundriss füllt die verfügbare Höhe bis zur Seitenpolsterung' }).toBeLessThanOrEqual(1);
  const m = await grundrissMessen(page);
  expect(m.hoehe).toBeGreaterThan(150);
  expect(m.unten).toBeLessThanOrEqual(m.fenster);
  return m;
}

for (const breite of [1366, 1024, 390]) {
  test(`UHS-Resthöhe folgt Kopf und Dichte bei ${breite}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const browserFehler: string[] = [];
    page.on('pageerror', (fehler) => browserFehler.push(fehler.message));
    // Vite fängt Window-Fehler ab, bevor Playwright `pageerror` bekommt.
    await page.addInitScript(() => window.addEventListener('error', (e) => console.error(`LFH-459: ${e.message}`)));
    page.on('console', (meldung) => {
      if (meldung.text().startsWith('LFH-459:')) browserFehler.push(meldung.text());
    });
    await page.setViewportSize({ width: breite, height: 900 });
    const pfad = await aufbauen(page);
    const messungen = [];
    for (const dichte of ['kompakt', 'komfortabel', 'handschuh']) {
      await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);
      await page.goto(pfad);
      await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
      await expect(page.getByText('Bett 2', { exact: true })).toBeVisible();
      messungen.push({ dichte, ...await passtInsFenster(page) });
    }
    expect(messungen[0].hoehe).toBeGreaterThan(messungen[2].hoehe);
    // Prüft auch die innere Tabs-Kette: eine passende Außenhöhe allein könnte
    // einen überlaufenden oder auf null geschrumpften mobilen Inhalt verstecken.
    if (breite === 390) {
      const pane = page.getByTestId('grundriss-rahmen').getByRole('tabpanel');
      const innen = await pane.boundingBox();
      const rahmen = await page.getByTestId('grundriss-rahmen').boundingBox();
      expect(innen!.height).toBeGreaterThan(150);
      expect(innen!.y + innen!.height).toBeLessThanOrEqual(rahmen!.y + rahmen!.height + 1);
    }
    await page.screenshot({ path: testInfo.outputPath(`handschuh-${breite}.png`) });
    // Die nachfolgenden Reiter bleiben im Dokumentfluss erreichbar.
    await page.getByRole('tab', { name: 'Bewegungen', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Bewegungen', exact: true })).toHaveAttribute('aria-selected', 'true');
    const bewegungen = page.getByText('Keine Bewegungen erfasst', { exact: true });
    await bewegungen.scrollIntoViewIfNeeded();
    await expect(bewegungen).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    // Resize NACH Scroll: viewport-relatives top allein würde die Höhe aufblasen.
    await page.setViewportSize({ width: breite, height: 844 });
    await passtInsFenster(page);
    // Live-Wechsel ohne Reload/resize: der äußere App-Kopf ändert seine Höhe.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: /Benutzermenü/ }).click();
    await page.getByRole('menuitem', { name: /^Kompakt$/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'kompakt');
    await passtInsFenster(page);
    expect(browserFehler).toEqual([]);
    await testInfo.attach('hoehen.json', { body: JSON.stringify(messungen, null, 2), contentType: 'application/json' });
  });
}
