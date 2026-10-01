import { expect, test, type Locator, type Page } from '@playwright/test';
import { randKontrast, umrissKontrast } from './kontrast-kern';

/**
 * Der Fokusring hält gegen den Grund ≥ 3 : 1, Tag und Nacht (LFH-737, Kriterium 5, WCAG 1.4.11).
 * antd zeichnet ihn als `outline` in `colorPrimaryBorder`; vor LFH-737 war das eine helle
 * Ableitung aus `bedien` (gemessen 1,45–2,46 : 1, Prüfliste LFH-690), jetzt die Rolle selbst.
 * Gerechnet steht dasselbe in `src/theme/bedienKontrast.test.ts`; hier zählt, was der Browser
 * wirklich zeichnet. Der Boden steht als Literal.
 *
 * GEMESSEN an den drei Arten aus dem Ticket:
 * - **Knopf**: „Anmelden“ (Primär, auf der Anmeldeseite) und „Neuer Einsatz“ (Standard, im
 *   Seitenkopf der Einsatzliste) — antds Umriss.
 * - **Link**: „Einsätze“ im Ortspfad einer Einsatzseite (antds `Breadcrumb`, ein `<a>`) — antds
 *   Umriss.
 * - **Eingabefeld**: „Benutzername“. antd zeichnet hier keinen Umriss, sondern färbt den Rand in
 *   `colorPrimary` (= `bedien`); gemessen wird der Rand gegen BEIDE angrenzenden Flächen, und
 *   der Spec sichert zu, dass er sich gegenüber der Ruhe ändert, sonst wäre „Fokus gemessen“
 *   trivial wahr.
 *
 * Erreicht wird jedes Ziel per TASTATUR: antd zeichnet den Umriss nur unter `:focus-visible`,
 * und ein `focus()` ohne Tastatur zeigt nichts (Prüfliste LFH-690). Der Spec prüft
 * `:focus-visible` als Vorbedingung.
 */

const BODEN = 3;

/** Tabuliert vorwärts, bis `ziel` den Fokus hat; scheitert laut, statt still vorbeizulaufen. */
async function tabBis(page: Page, ziel: Locator, name: string, hoechstens = 80) {
  for (let i = 0; i < hoechstens; i++) {
    if (await ziel.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  expect(await ziel.evaluate((el) => el === document.activeElement), `${name}: erreicht`).toBe(
    true,
  );
  expect(await ziel.evaluate((el) => el.matches(':focus-visible')), `${name}: :focus-visible`).toBe(
    true,
  );
}

async function umrissHaelt(page: Page, ziel: Locator, name: string) {
  await expect(ziel, name).toBeVisible();
  await tabBis(page, ziel, name);
  // Einblendungen laufen als Opacity-Gruppe, die der Messkern ablehnt, bis sie stehen.
  await expect(async () => {
    const m = await umrissKontrast(ziel);
    expect(m.verhaeltnis, `${name}: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(BODEN);
  }).toPass({ timeout: 10_000 });
}

for (const modus of ['light', 'dark'] as const) {
  test(`Fokusring an Knopf, Link und Eingabefeld — ${modus}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);

    // Eingabefeld: Rand in Ruhe, dann per Tastatur fokussiert.
    const feld = page.getByLabel('Benutzername');
    await expect(feld).toBeVisible();
    await feld.evaluate((el) => (el as HTMLElement).blur());
    // Die Anmeldekarte blendet ein (Opacity-Gruppe); gemessen wird erst, wenn sie steht.
    let ruhe: Awaited<ReturnType<typeof randKontrast>> | undefined;
    await expect(async () => {
      ruhe = await randKontrast(feld);
    }).toPass({ timeout: 10_000 });
    await tabBis(page, feld, `${modus}/Benutzername`, 20);
    // antd blendet den Rand über (`motionDurationMid`); ein Zwischenbild bestünde den Wechsel
    // schon, deshalb erst nach dem Ende aller Übergänge messen.
    await expect(async () => {
      await feld.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const fokus = await randKontrast(feld);
      expect(fokus.rand, `${modus}/Benutzername: Rand wechselt im Fokus`).not.toEqual(ruhe!.rand);
      const name = `${modus}/Benutzername: ${JSON.stringify(fokus)}`;
      expect(fokus.gegenAussen, name).toBeGreaterThanOrEqual(BODEN);
      expect(fokus.gegenInnen, name).toBeGreaterThanOrEqual(BODEN);
    }).toPass({ timeout: 10_000 });

    const anmelden = page.getByRole('button', { name: 'Anmelden', exact: true });
    await umrissHaelt(page, anmelden, `${modus}/Anmelden`);

    await page.getByLabel('Benutzername').fill('admin');
    await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
    await anmelden.click();
    await expect(page).toHaveURL(/\/einsaetze/);

    await umrissHaelt(
      page,
      page.getByRole('button', { name: 'Neuer Einsatz' }),
      `${modus}/Neuer Einsatz`,
    );

    const antwort = await page.request.post('/api/einsaetze', {
      data: { bezeichnung: `E2E 737 ${modus} ${Date.now()}` },
    });
    expect(antwort.ok(), `Einsatz anlegen: ${antwort.status()}`).toBeTruthy();
    const { id } = (await antwort.json()) as { id: number };
    await page.goto(`/einsaetze/${id}/auftraege`);
    await umrissHaelt(
      page,
      page.locator('.ant-breadcrumb').getByRole('link', { name: 'Einsätze', exact: true }),
      `${modus}/Ortspfad-Link`,
    );
  });
}
