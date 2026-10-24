import { expect, test, type Locator, type Page } from '@playwright/test';
import { flaeche, kontrast, schattenKontrast } from './kontrast-kern';

/**
 * Deeplink-Hervorhebung (LFH-698, Spec `deeplink-hervorhebung`): die angesprungene Zeile trägt
 * zwei Kanäle aus Rollen — getönte Fläche und eine Linie oben und unten. Die Kommunikationskarten
 * (Meldung, Auftrag, Einsatzbefehl) tragen dieselbe Form statt eines Rings; eine alarmierte Karte
 * behält ihre Alarmfläche, die Markierung legt nur die Linie darüber (LFH-896). Eine gewählte, nicht
 * angesprungene Karte (Muster „Liste + Detailpaneel“) trägt die Auswahlfläche und keine Linie
 * (Change oxgob5gk, Spec „Markierung bleibt von der Auswahl unterscheidbar“). Der Materialposten per
 * `?material=` (LLH-1260) trägt dieselbe Zeilenform. Gemessen im Browser,
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

  test(`${modus}: Materialposten per ?material= — dieselbe Fläche und Linie (LLH-1260)`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 1260 ${modus} ${Date.now()}`,
    });
    const ids: number[] = [];
    for (const bezeichnung of ['Feldbett', 'Tauchpumpe', 'Wolldecke']) {
      const posten = await post(page, `/api/einsaetze/${einsatzId}/material`, {
        adhoc: { bezeichnung },
        menge: 1,
      });
      ids.push(posten.id);
    }

    await page.goto(`/einsaetze/${einsatzId}/material?material=${ids[1]}`);
    const zeile = page.locator(`tr[data-row-key="${ids[1]}"]`);
    await expect(zeile).toHaveClass(/zeile-hervorgehoben/);
    // Apply-then-clean: der Parameter ist geräumt, die Markierung bleibt stehen.
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/material$`));
    await zeigerWeg(page);

    const zellen = zeile.locator('> td');
    const nachbarZellen = page.locator(`tr[data-row-key="${ids[0]}"] > td`);
    await expect(async () => {
      const anzahl = await zellen.count();
      for (let i = 0; i < anzahl; i += 1) {
        const m = await schattenKontrast(zellen.nth(i), nachbarZellen.nth(i));
        const text = `Zelle ${i}: ${JSON.stringify(m)}`;
        expect(m.gegenFlaeche, text).toBeGreaterThanOrEqual(LINIE);
        expect(m.gegenNachbar, text).toBeGreaterThanOrEqual(LINIE);
        await pruefeRollen(page, zellen.nth(i), nachbarZellen.nth(i), `Zelle ${i}`);
      }
      await pruefeText(zellen, TEXT[modus], 'markierter Posten');
    }).toPass({ timeout: 10_000 });
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
        (
          await post(page, `/api/einsaetze/${einsatzId}/etb`, {
            typ: 'meldung',
            von: 'ELW 1',
            an: 'Leitstelle',
            inhalt,
          })
        ).id,
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

  test(`${modus}: Kommunikationskarte per Deeplink — Linie statt Ring, Gefahr gewinnt`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 896 ${modus} ${Date.now()}`,
    });
    const auftrag = async (auftrag_text: string, frist_at?: string) =>
      (
        await post(page, `/api/einsaetze/${einsatzId}/auftraege`, {
          auftrag_text,
          empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'Abschnitt Nord' }],
          ...(frist_at ? { frist_at } : {}),
        })
      ).id;
    const nachbarId = await auftrag('Nachbarauftrag');
    const zielId = await auftrag('Angesprungener Auftrag');
    // Frist in der Vergangenheit, Empfänger unquittiert: überfällig, die Karte ist alarmiert.
    const alarmId = await auftrag('Überfälliger Auftrag', '2026-06-01 10:00:00');
    const karte = (id: number) => page.locator(`[data-lfh="komm-karte"][data-auftrag-id="${id}"]`);
    const nachbar = karte(nachbarId);

    // Gewöhnliche Karte: dieselbe Fläche und Linie wie die Tabellenzeile, kein Ring
    // (`schattenKontrast` prüft die Linienform vorab: genau zwei `inset`-Linien oben und unten).
    await page.goto(`/einsaetze/${einsatzId}/auftraege?auftrag=${zielId}`);
    const ziel = karte(zielId);
    await expect(ziel).toHaveAttribute('data-hervorgehoben', 'true');
    // Angesprungen heißt auch gewählt; die Markierung steht über der Auswahlfläche (oxgob5gk).
    await expect(ziel).toHaveAttribute('data-gewaehlt', 'true');
    await expect(nachbar).not.toHaveAttribute('data-hervorgehoben');
    await zeigerWeg(page);
    await expect(async () => {
      const m = await schattenKontrast(ziel, nachbar);
      expect(m.gegenFlaeche, JSON.stringify(m)).toBeGreaterThanOrEqual(LINIE);
      expect(m.gegenNachbar, JSON.stringify(m)).toBeGreaterThanOrEqual(LINIE);
      await pruefeRollen(page, ziel, nachbar, 'Kommunikationskarte');
      await pruefeText(
        ziel.getByText('Angesprungener Auftrag', { exact: true }),
        TEXT[modus],
        'Kommunikationskarte',
      );
    }).toPass({ timeout: 10_000 });

    // Alarmierte Karte: Alarmfläche und Alarmkante bleiben, die Linie kommt dazu und hält auf
    // der Alarmfläche.
    await page.goto(`/einsaetze/${einsatzId}/auftraege?auftrag=${alarmId}`);
    const alarm = karte(alarmId);
    await expect(alarm).toHaveAttribute('data-hervorgehoben', 'true');
    await expect(alarm).toHaveAttribute('data-alarm', 'true');
    await zeigerWeg(page);
    await expect(async () => {
      const m = await schattenKontrast(alarm, nachbar);
      expect(m.gegenFlaeche, JSON.stringify(m)).toBeGreaterThanOrEqual(LINIE);
      expect(m.gegenNachbar, JSON.stringify(m)).toBeGreaterThanOrEqual(LINIE);
      expect(rgb(m.linie), 'Alarmkarte: Linie').toBe(await rolle(page, '--lfh-bedien'));
      expect(rgb(await flaeche(alarm)), 'Alarmkarte: Fläche').toBe(
        await rolle(page, '--lfh-alarm-flaeche'),
      );
      const kante = await alarm.evaluate((el) => getComputedStyle(el).borderLeftColor);
      expect(rgb((kante.match(/[\d.]+/g) ?? []).map(Number)), 'Alarmkarte: Kante').toBe(
        await rolle(page, '--lfh-alarm'),
      );
      await pruefeText(
        alarm.getByText('Überfälliger Auftrag', { exact: true }),
        TEXT[modus],
        'Alarmkarte',
      );
    }).toPass({ timeout: 10_000 });
  });

  test(`${modus}: Befehlskarte per ?befehl= — dieselbe Fläche und Linie wie der Auftrag`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E oxgob5gk Befehl ${modus} ${Date.now()}`,
    });
    const befehl = async (titel: string) =>
      (await post(page, `/api/einsaetze/${einsatzId}/befehle`, { vorlage: 'befehl_lad', titel }))
        .id;
    const nachbarId = await befehl('Nachbarbefehl');
    const zielId = await befehl('Angesprungener Befehl');
    const karte = (id: number) => page.locator(`[data-lfh="komm-karte"][data-befehl-id="${id}"]`);
    const nachbar = karte(nachbarId);

    // Der Ortspfad der Vollseite führt so zurück (oxgob5gk D6): Befehl gewählt UND markiert.
    await page.goto(`/einsaetze/${einsatzId}/auftraege?befehl=${zielId}&reiter=befehle`);
    const ziel = karte(zielId);
    await expect(ziel).toHaveAttribute('data-hervorgehoben', 'true');
    await expect(ziel).toHaveAttribute('data-gewaehlt', 'true');
    await expect(nachbar).not.toHaveAttribute('data-hervorgehoben');
    await expect(nachbar).not.toHaveAttribute('data-gewaehlt');
    await zeigerWeg(page);
    await expect(async () => {
      const m = await schattenKontrast(ziel, nachbar);
      expect(m.gegenFlaeche, JSON.stringify(m)).toBeGreaterThanOrEqual(LINIE);
      expect(m.gegenNachbar, JSON.stringify(m)).toBeGreaterThanOrEqual(LINIE);
      // Markierung über der Auswahlfläche (Spec „Markierung bleibt von der Auswahl unterscheidbar“).
      await pruefeRollen(page, ziel, nachbar, 'Befehlskarte');
      await pruefeText(
        ziel.getByText('Angesprungener Befehl', { exact: true }),
        TEXT[modus],
        'Befehlskarte',
      );
    }).toPass({ timeout: 10_000 });
  });

  test(`${modus}: gewählte, nicht angesprungene Karte — Auswahlfläche ohne Linie`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E oxgob5gk Wahl ${modus} ${Date.now()}`,
    });
    const ids: number[] = [];
    for (const auftrag_text of ['Erster Auftrag', 'Gewählter Auftrag', 'Dritter Auftrag']) {
      ids.push(
        (
          await post(page, `/api/einsaetze/${einsatzId}/auftraege`, {
            auftrag_text,
            empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'Abschnitt Nord' }],
          })
        ).id,
      );
    }
    const karte = (id: number) => page.locator(`[data-lfh="komm-karte"][data-auftrag-id="${id}"]`);

    // Ohne Deeplink: ab lg ist eine Karte vorgewählt, keine markiert.
    await page.goto(`/einsaetze/${einsatzId}/auftraege`);
    await expect(page.locator('[data-lfh="komm-karte"][data-gewaehlt="true"]')).toHaveCount(1);
    // Von Hand wählen: eine Karte, die nicht die vorgewählte ist.
    const vorgewaehlt = await page
      .locator('[data-lfh="komm-karte"][data-gewaehlt="true"]')
      .getAttribute('data-auftrag-id');
    const zielId = ids.find((id) => String(id) !== vorgewaehlt)!;
    const ziel = karte(zielId);
    await ziel.locator('[data-lfh="auswahl-ziel"]').click();
    await expect(ziel).toHaveAttribute('data-gewaehlt', 'true');
    await expect(page.locator('[data-lfh="komm-karte"][data-gewaehlt="true"]')).toHaveCount(1);
    await expect(page.locator('[data-lfh="komm-karte"][data-hervorgehoben]')).toHaveCount(0);
    const nachbar = page.locator('[data-lfh="komm-karte"]:not([data-gewaehlt])').first();
    await zeigerWeg(page);

    await expect(async () => {
      // Keine Linie: die bleibt allein der Markierung.
      expect(await ziel.evaluate((el) => getComputedStyle(el).boxShadow), 'gewählt: Linie').toBe(
        'none',
      );
      expect(rgb(await flaeche(ziel)), 'gewählt: Fläche').toBe(
        await rolle(page, '--lfh-auswahl-flaeche'),
      );
      expect(rgb(await flaeche(ziel)), 'gewählt gleicht der Markierung').not.toBe(
        await rolle(page, '--lfh-bedien-flaeche'),
      );
      expect(rgb(await flaeche(ziel)), 'gewählt gleicht der Nachbarkarte').not.toBe(
        rgb(await flaeche(nachbar)),
      );
      await pruefeText(
        ziel.getByText('Gewählter Auftrag', { exact: true }),
        TEXT[modus],
        'gewählte Karte',
      );
    }).toPass({ timeout: 10_000 });
  });
}
