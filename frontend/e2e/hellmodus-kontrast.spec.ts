import { expect, test, type Page } from '@playwright/test';
import { kontrast, pruefe } from './kontrast-kern';

// Browsermessung des Tagmodus: ETB-Typwörter, Zeilentönungen, die Lückenmarke der Betroffenen
// und die Augenbraue (Tertiärtext `schwach`, LFH-643) auf `grund`, `paneel` und `flaeche`.
// Böden aus Kriterium 5 als Literale: Tag ≥ 7, Nacht ≥ 5.
const ZIEL = { light: 7, dark: 5 } as const;

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
      ids[typ] = (await post(page, `${basis}/etb`, { typ, inhalt: `Messung ${typ}` })).id;
    }
    await post(page, `${basis}/etb`, {
      typ: 'berichtigung',
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
    }
    const berichtigung = page.locator(
      '[data-lfh-eintrag="zeitachse"][data-toenung="berichtigung"]',
    );
    await expect(berichtigung).toHaveCount(1);
    await pruefe(
      berichtigung.getByText('Messung Berichtigung', { exact: true }),
      ZIEL[modus],
      `${modus}/ETB/Berichtigungszeile/Text`,
    );

    await page.goto(`/einsaetze/${einsatzId}/personen`);
    await page.mouse.move(0, 0);
    const luecke = page.locator('[data-lfh="luecke"]').first();
    await expect(luecke).toContainText('offen');
    await pruefe(luecke, ZIEL[modus], `${modus}/Betroffene/Lückenmarke`);
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
        page.locator('[data-lfh="paneel"] .lfh-augenbraue').filter({ hasText: 'Offene Aufträge' }),
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
