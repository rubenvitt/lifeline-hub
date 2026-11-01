import { expect, test, type Locator, type Page } from '@playwright/test';
import { flaeche, kontrast, pruefe, randKontrast, verhaeltnis } from './kontrast-kern';

// Browsermessung des Tagmodus: ETB-Typwörter und -kanten (LLH-1320), Zeilentönungen, der leise
// Systemeintrag, die Lückenmarke der Betroffenen und die Augenbraue (Tertiärtext `schwach`,
// LFH-643) auf `grund`, `paneel` und `flaeche`.
// Böden aus Kriterium 5 als Literale: Tag ≥ 7, Nacht ≥ 5.
const ZIEL = { light: 7, dark: 5 } as const;
// Die Typkante ist ein grafisches Element (WCAG 1.4.11): ≥ 3 : 1 in beiden Modi (LLH-1320).
const KANTE = 3;

/**
 * Die 2-px-Typkante der Zeitachse (`data-lfh="typkante"`) ist eine deckende Fläche: ihre Farbe
 * ist die komponierte Fläche der Kante selbst, ihr Grund die Fläche der Zeile, in der sie steht.
 */
async function pruefeKante(kante: Locator, name: string) {
  await expect(kante, name).toBeVisible();
  await expect(async () => {
    const [farbe, grund] = await Promise.all([flaeche(kante), flaeche(kante.locator('..'))]);
    const v = verhaeltnis(farbe, grund);
    expect(v, `${name}: ${JSON.stringify({ farbe, grund })}`).toBeGreaterThanOrEqual(KANTE);
  }).toPass({ timeout: 10_000 });
}

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

for (const modus of ['light', 'dark'] as const) {
  test(`${modus}: ETB-Typwörter, Berichtigungszeile und Lückenmarke`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 618 ${modus} ${Date.now()}`,
    });
    const basis = `/api/einsaetze/${einsatzId}`;
    const ids: Record<string, number> = {};
    for (const typ of ['meldung', 'anordnung', 'entscheidung', 'lage']) {
      ids[typ] = (
        await post(page, `${basis}/etb`, {
          typ,
          inhalt: `Messung ${typ}`,
          von: 'ELW 1',
          an: 'Leitstelle',
        })
      ).id;
    }
    await post(page, `${basis}/etb`, {
      typ: 'berichtigung',
      von: 'ELW 1',
      an: 'Leitstelle',
      inhalt: 'Messung Berichtigung',
      berichtigt_eintrag_id: ids.meldung,
    });
    // Eine Person ohne Fundort und Verbleib: trägt die Lückenmarke UND erzeugt einen
    // Systemeintrag im ETB.
    await post(page, `${basis}/personen`, { sichtung: 'sk2' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);

    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await page.mouse.move(0, 0);
    for (const typ of ['meldung', 'anordnung', 'entscheidung', 'lage', 'berichtigung', 'system']) {
      const wort = page
        .locator(`[data-lfh-eintrag="zeitachse"][data-typ="${typ}"] [data-lfh="typwort"]`)
        .first();
      await pruefe(wort, ZIEL[modus], `${modus}/ETB/${typ}/Typwort`);
      const kante = page
        .locator(`[data-lfh-eintrag="zeitachse"][data-typ="${typ}"] [data-lfh="typkante"]`)
        .first();
      await pruefeKante(kante, `${modus}/ETB/${typ}/Typkante`);
    }
    // Die Erfassungszeile trägt die Kante des Typs, den sie gerade schreibt (LLH-1112): vorn
    // 2 px gegen die Zeile selbst und gegen die Leiste, auf der sie steht (LLH-1320).
    await page.getByPlaceholder('Inhalt …').fill('/entscheidung Messung Kante');
    await expect(
      page.getByRole('button', { name: 'Eintragstyp Entscheidung ändern' }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    const zeile = page.locator('.lfh-schnellerfassung[data-rahmen-farbe]');
    await expect(zeile).toHaveCount(1);
    await expect(async () => {
      const rand = await randKontrast(zeile, 'left');
      const name = `${modus}/ETB/Erfassungszeile/Kante Entscheidung`;
      expect(rand.gegenInnen, `${name} innen: ${JSON.stringify(rand)}`).toBeGreaterThanOrEqual(
        KANTE,
      );
      expect(rand.gegenAussen, `${name} außen: ${JSON.stringify(rand)}`).toBeGreaterThanOrEqual(
        KANTE,
      );
    }).toPass({ timeout: 10_000 });
    await page.getByPlaceholder('Inhalt …').fill('');
    const berichtigung = page.locator(
      '[data-lfh-eintrag="zeitachse"][data-toenung="berichtigung"]',
    );
    await expect(berichtigung).toHaveCount(1);
    await pruefe(
      berichtigung.getByText('Messung Berichtigung', { exact: true }),
      ZIEL[modus],
      `${modus}/ETB/Berichtigungszeile/Text`,
    );
    // Der Systemeintrag steht leise (LLH-1106): Text in `gedaempft`, eine Stufe kleiner — er hält
    // denselben Boden wie jeder Text.
    const leise = page.locator('[data-lfh-eintrag="zeitachse"][data-typ="system"][data-leise]');
    // Die Person erzeugt mehr als einen Systemeintrag; gemessen wird der erste.
    await expect(leise.first()).toBeVisible();
    await pruefe(
      leise.locator('.markdown').first(),
      ZIEL[modus],
      `${modus}/ETB/Systemeintrag/Text`,
    );

    await page.goto(`/einsaetze/${einsatzId}/personen`);
    await page.mouse.move(0, 0);
    const luecke = page.locator('[data-lfh="luecke"]').first();
    await expect(luecke).toContainText('offen');
    await pruefe(luecke, ZIEL[modus], `${modus}/Betroffene/Lückenmarke`);
  });
}

// Der Titel-Link einer Datensicht ist ein react-router-`Link` ohne eigene Farbe: er erbt antds
// Linkfarbe. Die trägt seit LFH-652 die Textrolle (Spec `textkontrast-rollen`); aus `bedien`
// abgeleitet lag sie nachts bei 4,55.
for (const modus of ['light', 'dark'] as const) {
  test(`${modus}: Datensicht-Titel-Link erbt die Linkfarbe und hält den Boden`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 652 ${modus} ${Date.now()}`,
    });
    await post(page, `/api/einsaetze/${einsatzId}/schaeden`, {
      typ: 'sachschaden',
      ausmass: 'gering',
      ort: 'Messung Titel-Link',
    });
    await page.goto(`/einsaetze/${einsatzId}/schaeden`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    await page.mouse.move(0, 0);
    const titel = page
      .locator('.ant-table-tbody tr.ant-table-row')
      .first()
      .locator(`a[href*="/schaeden/"]`)
      .first();
    await pruefe(titel, ZIEL[modus], `${modus}/Datensicht/Titel-Link`);
  });
}

/** Die Rollenfläche als `rgb(…)`, so wie der Browser sie für `--lfh-<rolle>` auflöst. */
async function rollenGrund(page: Page, rolle: string): Promise<string> {
  return page.evaluate((r) => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = `var(--lfh-${r})`;
    document.body.append(probe);
    const farbe = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return farbe;
  }, rolle);
}

for (const modus of ['light', 'dark'] as const) {
  test(`${modus}: Augenbraue auf grund, paneel und flaeche (LFH-643)`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 643 ${modus} ${Date.now()}`,
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);

    // Fundstellen: Kopf eines Bereichs auf dem Seitengrund, Paneelkopf, Kennzahl im Band.
    const faelle = [
      [
        'grund',
        'auftraege',
        page.locator('[data-lfh="bereichskopf"] .lfh-augenbraue').filter({ hasText: 'Aufträge' }),
      ],
      [
        'paneel',
        'ueberblick',
        page.locator('[data-lfh="paneel"] .lfh-augenbraue').filter({ hasText: 'Offene Vorgänge' }),
      ],
      [
        'flaeche',
        'ueberblick',
        page.locator('[data-lfh="kennzahl"] .lfh-augenbraue').filter({ hasText: 'Betroffene' }),
      ],
    ] as const;
    for (const [rolle, modul, augenbraue] of faelle) {
      await page.goto(`/einsaetze/${einsatzId}/${modul}`);
      await page.mouse.move(0, 0);
      const ziel = augenbraue.first();
      const name = `${modus}/Augenbraue auf ${rolle}`;
      await pruefe(ziel, ZIEL[modus], name);
      // Der Grund ist wirklich die genannte Fläche — sonst wiche die Messung still aus.
      const { grund, verhaeltnis } = await kontrast(ziel);
      const gemessen = `rgb(${grund.slice(0, 3).map(Math.round).join(', ')})`;
      expect(gemessen, `${name}: gemessener Grund`).toBe(await rollenGrund(page, rolle));
      test.info().annotations.push({
        type: 'messwert',
        description: `${name}: ${verhaeltnis.toFixed(2)} : 1`,
      });
    }
  });
}
