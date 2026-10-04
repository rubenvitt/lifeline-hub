import { expect, test } from '@playwright/test';
import { kontrast, pruefe } from './kontrast-kern';

/**
 * Warntext in der Textrolle des Status, Tag und Nacht (LFH-876, Spec `textkontrast-rollen`,
 * „Warn- und Erfolgstext in der Textrolle des Status“). `Typography` `warning` liest antds
 * `colorWarningText`; vorher war das am Tag die Füllfarbe `achtung` und nachts ein von antd
 * abgeleiteter Ton. Textboden aus Kriterium 5 als Literal, Tag ≥ 7 : 1, Nacht ≥ 5 : 1, gegen den
 * tatsächlich komponierten Grund der Leiste. Gerechnet steht dasselbe für jede deckende Fläche in
 * `src/theme/statustextKontrast.test.ts`; `success` hat heute keine Stelle in der App.
 *
 * GEMESSEN: „nicht verortet“ im Paneel „Einsatzort“ der Lagekarte eines neuen Einsatzes ohne Ort.
 */

const TEXT = { light: 7, dark: 5 } as const;

for (const modus of ['light', 'dark'] as const) {
  test(`Warntext „nicht verortet“ auf der Lagekarte — ${modus}`, async ({ page }) => {
    test.setTimeout(120_000);
    // Ab `lg` steht die Leiste neben der Karte (`leistenWahl.ts`).
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await page.goto('/login');
    await page.getByLabel('Benutzername').fill('admin');
    await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page).toHaveURL(/\/einsaetze/);

    const r = await page.request.post('/api/einsaetze', {
      data: { bezeichnung: `E2E 876 Statustext ${modus} ${Date.now()}` },
    });
    expect(r.ok(), `Einsatz anlegen: ${r.status()} ${await r.text()}`).toBeTruthy();
    const { id: einsatzId } = (await r.json()) as { id: number };

    await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);

    const warntext = page.getByText('nicht verortet', { exact: true });
    await expect(warntext).toBeVisible({ timeout: 30_000 });
    // Der Warntext ist antds Statustext, nicht ein beliebig gefärbtes Wort.
    await expect(warntext).toHaveClass(/ant-typography-warning/);
    await pruefe(warntext, TEXT[modus], `${modus}/nicht verortet`);

    test.info().annotations.push({
      type: 'messwert',
      description: `nicht verortet ${(await kontrast(warntext)).verhaeltnis.toFixed(2)}`,
    });
  });
}
