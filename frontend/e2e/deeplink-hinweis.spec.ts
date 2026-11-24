import { expect, test } from '@playwright/test';
import { meldungenPfad } from '../src/routing/deeplinks';
import { pruefe } from './kontrast-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Deeplink auf eine Meldung, die es nicht gibt (LLH-1827, Change `a12ms7g9-seitenzustaende`, D5;
 * Spec `seiten-zustaende`, „Deeplink auf ein Objekt, das es nicht gibt“): über der Liste steht
 * die Hinweisleiste, nicht als Toast und nicht als Alarm, und der Parameter ist aus der Adresse
 * verschwunden. Hier zählt, was nur der Browser zeigt: der echte 404 des Einzelabrufs vom Server,
 * die Adresse nach der Räumung und der Kontrast der Leiste im Tag- und im Nachtmodus. Die Logik
 * der Seite belegt `pages/MeldungenPage.test.tsx`.
 */

const TEXT = { light: 7, dark: 5 } as const;

for (const modus of ['light', 'dark'] as const) {
  test(`?meldung=99999 zeigt die Hinweisleiste — ${modus}`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await anmeldenAlsAdmin(page, { startseite: false });

    const antwort = await page.request.post('/api/einsaetze', {
      data: { bezeichnung: `E2E 1827 Deeplink ${Date.now()}` },
    });
    expect(antwort.ok(), `Seeding Einsatz: ${antwort.status()}`).toBe(true);
    const { id: einsatzId } = (await antwort.json()) as { id: number };

    const einzelabruf = page.waitForResponse((r) =>
      r.url().endsWith(`/api/einsaetze/${einsatzId}/reports/99999`),
    );
    await page.goto(meldungenPfad(einsatzId, { meldung: 99999 }));
    expect((await einzelabruf).status()).toBe(404);

    const leiste = page.locator('[data-lfh="deeplink-hinweis"]');
    await expect(leiste).toHaveText('Meldung #99999 gibt es nicht (mehr)');
    await expect(leiste).toHaveAttribute('role', 'status');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.ant-message-notice')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/meldungen$`));
    await pruefe(
      leiste.getByText('Meldung #99999 gibt es nicht (mehr)'),
      TEXT[modus],
      `${modus}/Hinweisleiste`,
    );

    await leiste.getByRole('button', { name: 'Hinweis schließen' }).click();
    await expect(leiste).toHaveCount(0);
  });
}
