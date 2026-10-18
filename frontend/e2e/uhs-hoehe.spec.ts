import { expect, test, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';

// Eine feste Reserve verschenkt Platz oder schiebt die Unterkante aus dem Fenster. Echte
// Layout-Messung; jsdom kann diesen Fehler nicht nachweisen.
async function aufbauen(page: Page) {
  return (await aufbauenMitEinsatz(page)).pfad;
}

/** Wie `aufbauen`, liefert zusätzlich die Einsatz-ID (für die Mitgliedschaft der Rolle). */
async function aufbauenMitEinsatz(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);

  async function anlegen(pfad: string, data: unknown) {
    const antwort = await page.request.post(pfad, { data });
    expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
    return (await antwort.json()) as { id: number };
  }
  const einsatz = await anlegen('/api/einsaetze', { bezeichnung: `E2E UHS Höhe ${Date.now()}` });
  const uhs = await anlegen(`/api/einsaetze/${einsatz.id}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'BHP Höhenprüfung',
  });
  await anlegen(`/api/einsaetze/${einsatz.id}/uhs/${uhs.id}/plaetze/bulk`, {
    typ: 'bett',
    menge: 2,
  });
  return {
    einsatzId: String(einsatz.id),
    pfad: `/einsaetze/${einsatz.id}/unfallhilfsstellen/${uhs.id}`,
  };
}

test('UHS mit langem Kopf erhält eine nutzbare Arbeitsfläche unter der Bereichsleiste', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pfad = await aufbauen(page);
  await page.evaluate(() => localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
  // Fachlich zulässige lange Notiz: sie steht vollständig im Seitenkopf. Nur die
  // API-Antwort wird erweitert; Layout, Datenpfad und Grundriss bleiben echt.
  await page.route(/\/api\/einsaetze\/\d+\/uhs\/\d+$/, async (route) => {
    const antwort = await route.fetch();
    await route.fulfill({
      response: antwort,
      json: {
        ...(await antwort.json()),
        notiz:
          'Zugang über den Seiteneingang. Anmeldung im Vorraum, Materialausgabe gegenüber. '.repeat(
            10,
          ),
      },
    });
  });
  await page.goto(pfad);
  await expect(page.getByText('Bett 2', { exact: true })).toBeVisible();
  const grundriss = page.getByTestId('grundriss-rahmen');
  // Die Mindest-Arbeitsfläche des Grundrisses ist 380 px; sie ist kein Kopf-Abzug.
  expect((await grundriss.boundingBox())!.height).toBeGreaterThanOrEqual(380);
  // Die Bereichsleiste steht über dem Grundriss (LLH-1133), nicht im Seitenfluss darunter.
  const reihenfolge = await grundriss.evaluate((el) => {
    const material = [...document.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent === 'Material',
    )!;
    return el.getBoundingClientRect().top - material.getBoundingClientRect().bottom;
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

async function fuelltArbeitsflaeche(page: Page) {
  await expect(page.getByTestId('grundriss-rahmen')).toBeVisible();
  await expect
    .poll(
      async () => {
        const m = await grundrissMessen(page);
        // Bei 390 × 844 und Handschuh-Dichte bleiben nach dem Kopf weniger als 380 px; der
        // Mindestboden verlangt dann Dokument-Scroll.
        const unterkante = Math.max(m.fenster - m.polster, m.oben + 380);
        return Math.abs(m.unten - unterkante);
      },
      { message: 'Grundriss füllt die Resthöhe und wahrt mindestens 380px Arbeitsfläche' },
    )
    .toBeLessThanOrEqual(1);
  const m = await grundrissMessen(page);
  expect(m.hoehe).toBeGreaterThanOrEqual(380);
  if (m.fenster - m.polster - m.oben >= 380) {
    expect(m.unten).toBeLessThanOrEqual(m.fenster);
  }
  return m;
}

for (const breite of [1366, 1024, 390]) {
  test(`UHS-Resthöhe folgt Kopf und Dichte bei ${breite}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const browserFehler: string[] = [];
    page.on('pageerror', (fehler) => browserFehler.push(fehler.message));
    // Vite fängt Window-Fehler ab, bevor Playwright `pageerror` bekommt.
    await page.addInitScript(() =>
      window.addEventListener('error', (e) => console.error(`LFH-459: ${e.message}`)),
    );
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
      messungen.push({ dichte, ...(await fuelltArbeitsflaeche(page)) });
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
    // Die übrigen Bereiche stehen über die Bereichsleiste in derselben Fläche (LLH-1133).
    await page.getByRole('tab', { name: 'Bewegungen', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Bewegungen', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const bewegungen = page.getByText('Keine Bewegungen erfasst', { exact: true });
    await bewegungen.scrollIntoViewIfNeeded();
    await expect(bewegungen).toBeInViewport();
    await page.getByRole('tab', { name: 'Belegung', exact: true }).click();
    await expect(page.getByTestId('grundriss-rahmen')).toBeVisible();
    // Rollen, wo es etwas zu rollen gibt: bei 390 px im Handschuh trägt der Boden die Seite über
    // das Fenster hinaus. Breiter endet die Seite mit dem Bereich (LLH-1133), dort gibt es nichts
    // darunter, und die Messung unten gilt der Höhe ohne Bildlauf.
    if (breite === 390) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    }
    // Resize NACH Scroll: viewport-relatives top allein würde die Höhe aufblasen. Bei 390 px
    // erzwingt eine Fensterhöhe von 600 px den BODEN-Zweig (Resthöhe < 380 px); bei 844 px
    // bliebe mehr, und die Aussage unten wäre leer.
    await page.setViewportSize({ width: breite, height: breite === 390 ? 600 : 844 });
    const verkleinert = await fuelltArbeitsflaeche(page);
    if (breite === 390) {
      expect(verkleinert.fenster - verkleinert.polster - verkleinert.oben).toBeLessThan(380);
      expect(verkleinert.hoehe).toBeCloseTo(380, 0);
    }
    // Live-Wechsel ohne Reload/resize: der äußere App-Kopf ändert seine Höhe.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: /Benutzermenü/ }).click();
    await page.getByRole('menuitem', { name: /^Kompakt$/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'kompakt');
    await fuelltArbeitsflaeche(page);
    expect(browserFehler).toEqual([]);
    await testInfo.attach('hoehen.json', {
      body: JSON.stringify(messungen, null, 2),
      contentType: 'application/json',
    });
  });
}

/**
 * LFH-435, Nur-Lese-Zweig der UHS-Detailseite: der Beobachter sieht den Kopf OHNE Aktionen
 * (`UhsDetailPage.tsx`, `aktionen` hinter `!schreibgeschuetzt`) und den Grundriss ohne
 * „Plätze anlegen"/„Plätze bearbeiten". Der Kopf ist dadurch anders gebaut als beim Admin; die
 * Resthöhe muss ihm trotzdem folgen, und die Seite läuft nicht waagerecht über. Gleiche Messung
 * wie der Admin-Test oben, auf den Breiten des Führungs-Tablets und des Handschirms.
 */
for (const breite of [1024, 390]) {
  test(`UHS-Resthöhe folgt Kopf und Dichte bei ${breite}px (Beobachter)`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: breite, height: 900 });
    // Gesät wird als Admin (die UHS bleibt „geplant": dort trüge der Admin-Kopf zwei Aktionen
    // und der Grundriss „Plätze anlegen"), dann Wechsel im selben Kontext.
    const { einsatzId, pfad } = await aufbauenMitEinsatz(page);
    await wechsleZuRolle(page, 'beobachter', einsatzId);
    const messungen = [];
    for (const dichte of ['kompakt', 'komfortabel', 'handschuh']) {
      await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);
      await page.goto(pfad);
      await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
      // Positiver Anker zuerst: eine Abwesenheit wäre auf halb gerenderter Seite sofort wahr.
      await expect(page.getByText('Bett 2', { exact: true })).toBeVisible();
      // ── VORBEDINGUNG: der Nur-Lese-Zweig steht. Der Aktions-Slot rendert immer (die Seite
      // übergibt stets ein `<Space>`), er ist nur leer.
      const aktionen = page.locator('[data-lfh="seitenkopf-aktionen"]');
      await expect(aktionen, 'der Kopf trägt seinen Aktions-Slot').toHaveCount(1);
      await expect(
        aktionen.getByRole('button'),
        'Vorbedingung: der Kopf trägt ohne Schreibrecht keine Aktion',
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: /^Plätze (anlegen|bearbeiten)$/ }),
        'Vorbedingung: der Grundriss bietet ohne Schreibrecht keine Platzbearbeitung an',
      ).toHaveCount(0);
      messungen.push({ dichte, ...(await fuelltArbeitsflaeche(page)) });
      const ueberlauf = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(ueberlauf, `${dichte}: die Seite läuft nicht waagerecht über`).toBeLessThanOrEqual(1);
    }
    expect(messungen[0].hoehe).toBeGreaterThan(messungen[2].hoehe);
    if (breite === 390) {
      const pane = page.getByTestId('grundriss-rahmen').getByRole('tabpanel');
      const innen = await pane.boundingBox();
      const rahmen = await page.getByTestId('grundriss-rahmen').boundingBox();
      expect(innen!.height).toBeGreaterThan(150);
      expect(innen!.y + innen!.height).toBeLessThanOrEqual(rahmen!.y + rahmen!.height + 1);
    }
    // Wie beim Admin: bei 390 px erzwingt eine Fensterhöhe von 600 px den BODEN-Zweig.
    await page.setViewportSize({ width: breite, height: breite === 390 ? 600 : 844 });
    const verkleinert = await fuelltArbeitsflaeche(page);
    if (breite === 390) {
      expect(verkleinert.fenster - verkleinert.polster - verkleinert.oben).toBeLessThan(380);
      expect(verkleinert.hoehe).toBeCloseTo(380, 0);
    }
  });
}

/**
 * LLH-1133 (Spec `uhs-grundriss`, „Die UHS-Seite gliedert sich in Bereiche“): am Fükw (1440 × 900)
 * und am Führungs-Tablet (1280 × 800) steht die Bereichsleiste ohne Bildlauf über dem Grundriss,
 * „Material“ ist ohne Bildlauf wählbar, und jeder Bereich füllt dieselbe Fläche bis zum Fenster.
 */
async function bereichMessen(page: Page, name: string) {
  return page.getByRole('tabpanel', { name, exact: true }).evaluate((el) => {
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

for (const [breite, hoehe] of [
  [1440, 900],
  [1280, 800],
] as const) {
  test(`UHS-Bereiche bei ${breite} × ${hoehe}: Material ohne Bildlauf, jeder Bereich volle Höhe`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: breite, height: hoehe });
    const pfad = await aufbauen(page);
    await page.goto(pfad);
    await expect(page.getByText('Bett 2', { exact: true })).toBeVisible();

    const leiste = page.getByRole('tablist', {
      name: 'Belegung, Material, Kräfte, Bewegungen und Dateien',
    });
    const material = leiste.getByRole('tab', { name: 'Material', exact: true });
    // Ohne Bildlauf: die Seite steht oben, und der Reiter liegt im Fenster über dem Grundriss.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(material).toBeInViewport();
    const abstand = await page
      .getByTestId('grundriss-rahmen')
      .evaluate(
        (el, tab) => el.getBoundingClientRect().top - tab!.getBoundingClientRect().bottom,
        await material.elementHandle(),
      );
    expect(abstand).toBeGreaterThanOrEqual(0);

    const flaechen: Record<string, number> = {};
    for (const name of ['Belegung', 'Material', 'Kräfte', 'Bewegungen', 'Dateien']) {
      await leiste.getByRole('tab', { name, exact: true }).click();
      await expect(leiste.getByRole('tab', { name, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect
        .poll(
          async () => {
            const m = await bereichMessen(page, name);
            return Math.abs(m.unten - Math.max(m.fenster - m.polster, m.oben + 380));
          },
          { message: `${name}: der Bereich füllt die Resthöhe bis zum Fenster` },
        )
        .toBeLessThanOrEqual(1);
      flaechen[name] = (await bereichMessen(page, name)).hoehe;
      expect(flaechen[name]).toBeGreaterThanOrEqual(380);
    }
    // Dieselbe Fläche für jeden Bereich, keiner hängt unter einem anderen.
    expect(new Set(Object.values(flaechen).map(Math.round)).size).toBe(1);
    // Die Wahl steht in der Adresse und öffnet direkt.
    await leiste.getByRole('tab', { name: 'Material', exact: true }).click();
    await expect(page).toHaveURL(/\?bereich=material$/);
    await page.reload();
    await expect(material).toHaveAttribute('aria-selected', 'true');
  });
}
