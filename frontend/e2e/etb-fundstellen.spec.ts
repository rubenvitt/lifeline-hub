import { expect, test, type Page } from '@playwright/test';
import { flaeche, kontrast } from './kontrast-kern';

/**
 * Fundstellen der ETB-Volltextsuche (LFH-1056): mit `?q=` markiert die Zeitachse, was die Suche
 * traf, in Inhalt (gerendertes Markdown), Von/An und Veranlassung. Text auf der Markierung hält
 * den Textboden; ihr Grund ist die Rolle `achtung-flaeche`, die die Seite selbst auflöst (`rolle`).
 * Boden als Literal: Tag ≥ 7, Nacht ≥ 5.
 */
const TEXT = { light: 7, dark: 5 } as const;

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

for (const modus of ['light', 'dark'] as const) {
  test(`${modus}: Volltextsuche markiert Inhalt, Von/An und Veranlassung`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 1056 ${modus} ${Date.now()}`,
    });
    await post(page, `/api/einsaetze/${einsatzId}/etb`, {
      typ: 'meldung',
      inhalt: '**Deichbruch** bei Hochdeich',
      von: 'EA Nord',
      an: 'Leitstelle',
      veranlassung: 'Pegel steigt',
    });

    await page.goto(`/einsaetze/${einsatzId}/etb?q=${encodeURIComponent('deich nord pegel')}`);
    const zeile = page
      .locator('[data-testid="etb-ereigniszeile"]')
      .filter({ hasText: 'Hochdeich' });
    await expect(zeile).toHaveCount(1);
    await page.mouse.move(1, 1);

    const marken = zeile.locator('mark');
    // Wortanfänge: „Deich" in „Deichbruch", nicht in „Hochdeich".
    await expect
      .poll(async () => (await marken.allInnerTexts()).sort())
      .toEqual(['Deich', 'Nord', 'Pegel']);
    await expect(zeile.locator('strong mark')).toHaveText('Deich');
    await expect(zeile).toContainText('Veranlassung: Pegel steigt');

    const deich = zeile.locator('strong mark');
    await expect(async () => {
      const m = await kontrast(deich);
      expect(m.verhaeltnis, `Text auf der Fundstelle: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(
        TEXT[modus],
      );
      expect(rgb(await flaeche(deich)), 'Grund der Fundstelle').toBe(
        await rolle(page, '--lfh-achtung-flaeche'),
      );
    }).toPass({ timeout: 10_000 });

    // Ohne Suchbegriff keine Markierung und keine Veranlassung in der Zeile.
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await expect(zeile).toHaveCount(1);
    await expect(zeile.locator('mark')).toHaveCount(0);
    await expect(zeile).not.toContainText('Veranlassung');
  });
}
