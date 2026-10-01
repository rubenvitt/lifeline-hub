import { expect, test, type Locator, type Page } from '@playwright/test';
import { flaeche, kontrast, schattenKontrast } from './kontrast-kern';

/**
 * Deeplink-Hervorhebung (LFH-698, Spec `deeplink-hervorhebung`): die angesprungene Zeile trägt
 * zwei Kanäle aus Rollen — getönte Fläche und eine Linie oben und unten. Gemessen im Browser,
 * weil jsdom kein CSS rechnet (`css: false`) und antd seine Zellfarben zur Laufzeit injiziert.
 *
 * Böden als Literale (Kriterium 5 und WCAG 1.4.11): Text Tag ≥ 7, Nacht ≥ 5; Linie ≥ 3 gegen
 * die Fläche, auf der sie liegt, und gegen die Nachbarzeile. Keine Farbwerte aus dem Produkt
 * importieren: eine schlechte Palette muss rot werden. Dass Fläche und Linie die Bedienrollen SIND
 * (Scenario „Keine Farbe außerhalb der Rollen“, damit auch „Kein Warnton“), prüft der Abgleich mit
 * den Rollen-Properties, die die laufende Seite selbst auflöst (`rolle`).
 */
const TEXT = { light: 7, dark: 5 } as const;
const LINIE = 3;

async function anmelden(page: Page, modus: 'light' | 'dark') {
  await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post(page: Page, pfad: string, data: unknown): Promise<{ id: number }> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return r.json();
}

/** Ein Einsatz mit drei Ad-hoc-Kräften; die mittlere ist das Sprungziel. */
async function seede(page: Page, modus: string) {
  const { id: einsatzId } = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E 698 ${modus} ${Date.now()}`,
  });
  const ids: number[] = [];
  for (const name of ['Albers, Anna', 'Brandt, Bernd', 'Claussen, Clara']) {
    const kraft = await post(page, `/api/einsaetze/${einsatzId}/personal`, {
      adhoc: { name, funktion: 'Truppführung', traegerorganisation: 'FF Musterstadt' },
    });
    ids.push(kraft.id);
  }
  return { einsatzId, ziel: ids[1], nachbar: ids[0] };
}

/** Eine Rollen-Property (`--lfh-…`), vom Browser aufgelöst, als `r,g,b`. */
async function rolle(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const wert = getComputedStyle(probe).color;
    probe.remove();
    return (wert.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).join();
  }, name);
}

const rgb = (f: number[]) => f.slice(0, 3).map(Math.round).join();

/** Fläche = `bedien-flaeche`, Linie = `bedien`: dieselben Rollen in jedem Zweig. */
async function pruefeRollen(page: Page, ziel: Locator, nachbar: Locator, name: string) {
  const m = await schattenKontrast(ziel, nachbar);
  expect(rgb(m.linie), `${name}: Linie`).toBe(await rolle(page, '--lfh-bedien'));
  expect(rgb(await flaeche(ziel)), `${name}: Fläche`).toBe(
    await rolle(page, '--lfh-bedien-flaeche'),
  );
}

/** Zeiger aus der Tabelle, damit antds Hover die Ruhemessung nicht verfälscht. */
async function zeigerWeg(page: Page) {
  await page.mouse.move(1, 1);
}

async function pruefeText(zellen: Locator, boden: number, name: string) {
  const anzahl = await zellen.count();
  expect(anzahl, `${name}: keine Zellen`).toBeGreaterThan(0);
  for (let i = 0; i < anzahl; i += 1) {
    const zelle = zellen.nth(i);
    if (((await zelle.textContent()) ?? '').trim() === '') continue;
    const m = await kontrast(zelle);
    expect(m.verhaeltnis, `${name} Zelle ${i}: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(boden);
  }
}

for (const modus of ['light', 'dark'] as const) {
  test(`${modus}: Tabellenzeile per Deeplink — Text, Linie, Abgrenzung zum Hover`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { einsatzId, ziel, nachbar } = await seede(page, modus);

    await page.goto(`/einsaetze/${einsatzId}/personal?personal=${ziel}`);
    const zeile = page.locator(`tr[data-row-key="${ziel}"]`);
    const nachbarZeile = page.locator(`tr[data-row-key="${nachbar}"]`);
    await expect(zeile).toHaveClass(/zeile-hervorgehoben/);
    await zeigerWeg(page);

    const zellen = zeile.locator('> td');
    const nachbarZellen = nachbarZeile.locator('> td');
    // Jede Zelle, auch die fixierte, sortierte Kennung: die Linie läuft durch, die Fläche deckt.
    // `toPass`, weil `index.css` die Fläche 0,4 s einblendet (LFH-25).
    await expect(async () => {
      const anzahl = await zellen.count();
      for (let i = 0; i < anzahl; i += 1) {
        const m = await schattenKontrast(zellen.nth(i), nachbarZellen.nth(i));
        const text = `Zelle ${i}: ${JSON.stringify(m)}`;
        expect(m.gegenFlaeche, text).toBeGreaterThanOrEqual(LINIE);
        expect(m.gegenNachbar, text).toBeGreaterThanOrEqual(LINIE);
        await pruefeRollen(page, zellen.nth(i), nachbarZellen.nth(i), `Zelle ${i}`);
      }
      await pruefeText(zellen, TEXT[modus], 'markierte Zeile');
      // Die Fläche deckt jede Zelle, auch die fixierte, sortierte Kennung: dort verlor das alte
      // Gelb am Tag gegen antds Sortierspalte.
      const flaechen = new Set<string>();
      for (let i = 0; i < (await zellen.count()); i += 1) {
        flaechen.add((await flaeche(zellen.nth(i))).join());
      }
      expect([...flaechen], 'uneinheitliche Fläche in der markierten Zeile').toHaveLength(1);
    }).toPass({ timeout: 10_000 });

    // Gehoverte Nachbarzeile: andere Fläche als die markierte, und keine Linie. Gemessen an einer
    // gewöhnlichen Zelle (Index 1; Index 0 ist die Sortierspalte mit eigenem Grund) und erst, wenn
    // antds Hover-Ton wirklich steht (Überblendung 0,2 s) — sonst verglich die Probe die
    // Ruhefläche und überlebte eine Markierung im Hover-Ton.
    const markiert = await flaeche(zellen.nth(1));
    const ruhe = await flaeche(nachbarZellen.nth(1));
    await nachbarZeile.hover();
    await expect(nachbarZellen.nth(1)).toHaveClass(/ant-table-cell-row-hover/);
    await expect(async () => {
      const gehovert = await flaeche(nachbarZellen.nth(1));
      expect(gehovert.join(), 'Hover-Ton steht noch nicht').not.toBe(ruhe.join());
      expect(gehovert.join(), 'Hover-Fläche gleicht der Markierung').not.toBe(markiert.join());
    }).toPass({ timeout: 10_000 });
    expect(await nachbarZellen.nth(1).evaluate((el) => getComputedStyle(el).boxShadow)).toBe(
      'none',
    );

    // Markierte Zeile unter dem Zeiger: die Linie bleibt, an jeder Zelle.
    await zeile.hover();
    for (let i = 0; i < (await zellen.count()); i += 1) {
      const unterZeiger = await schattenKontrast(zellen.nth(i), nachbarZellen.nth(i));
      expect(
        unterZeiger.gegenFlaeche,
        `Zelle ${i}: ${JSON.stringify(unterZeiger)}`,
      ).toBeGreaterThanOrEqual(LINIE);
    }
  });

  test(`${modus}: Karte per Deeplink auf 390 px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await anmelden(page, modus);
    const { einsatzId, ziel } = await seede(page, modus);

    await page.goto(`/einsaetze/${einsatzId}/personal?personal=${ziel}`);
    const karte = page.locator('[data-lfh="datensicht-karte"].zeile-hervorgehoben');
    await expect(karte).toHaveCount(1);
    await expect(karte).toContainText('Brandt');
    const nachbarKarte = page
      .locator('[data-lfh="datensicht-karte"]:not(.zeile-hervorgehoben)')
      .first();
    await zeigerWeg(page);

    await expect(async () => {
      const m = await schattenKontrast(karte, nachbarKarte);
      expect(m.gegenFlaeche, JSON.stringify(m)).toBeGreaterThanOrEqual(LINIE);
      expect(m.gegenNachbar, JSON.stringify(m)).toBeGreaterThanOrEqual(LINIE);
      expect((await flaeche(karte)).join(), 'Karte ohne Tönung').not.toBe(
        (await flaeche(nachbarKarte)).join(),
      );
      // Dieselben Rollen wie die Tabellenzeile.
      await pruefeRollen(page, karte, nachbarKarte, 'Karte');
      await pruefeText(karte.getByText('Brandt, Bernd'), TEXT[modus], 'markierte Karte');
    }).toPass({ timeout: 10_000 });
  });

  test(`${modus}: ETB-Zeile per Deeplink — Linie neben der inline gesetzten Fläche`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 698 ETB ${modus} ${Date.now()}`,
    });
    const ids: number[] = [];
    for (const inhalt of ['Erste Meldung', 'Angesprungene Meldung', 'Dritte Meldung']) {
      ids.push(
        (await post(page, `/api/einsaetze/${einsatzId}/etb`, { typ: 'meldung', inhalt })).id,
      );
    }
    await page.goto(`/einsaetze/${einsatzId}/etb?eintrag=${ids[1]}`);
    const zeile = page.locator('[data-testid="etb-ereigniszeile"].zeile-hervorgehoben');
    await expect(zeile).toHaveCount(1);
    await expect(zeile).toContainText('Angesprungene Meldung');
    const nachbar = page
      .locator('[data-testid="etb-ereigniszeile"]:not(.zeile-hervorgehoben)')
      .first();
    await zeigerWeg(page);

    await expect(async () => {
      const m = await schattenKontrast(zeile, nachbar);
      expect(m.gegenFlaeche, JSON.stringify(m)).toBeGreaterThanOrEqual(LINIE);
      expect(m.gegenNachbar, JSON.stringify(m)).toBeGreaterThanOrEqual(LINIE);
      await pruefeText(zeile.getByText('Angesprungene Meldung'), TEXT[modus], 'ETB-Zeile');
      // Fläche inline aus `rollen.bedienFlaeche`, Linie aus `index.css`: dieselben Rollen.
      await pruefeRollen(page, zeile, nachbar, 'ETB-Zeile');
    }).toPass({ timeout: 10_000 });
  });
}
