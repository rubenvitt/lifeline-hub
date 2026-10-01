import { expect, test, type Locator, type Page } from '@playwright/test';
import { kontrast } from './kontrast-kern';

/**
 * Beschriftung des Primärknopfs (Text auf satter Bedienfläche) in Ruhe UND unter dem Zeiger,
 * Tag und Nacht (LFH-661, Spec `farbrollen-kontrast`). Kein eigener Knopfboden: der Textboden
 * aus Kriterium 5 gilt als Literal, Tag ≥ 7 : 1, Nacht ≥ 5 : 1. Gerechnet steht dasselbe in
 * `src/theme/bedienKontrast.test.ts`; hier zählt, was der Browser wirklich zeichnet.
 *
 * GEMESSEN: „Anmelden“ der Anmeldeseite (großer Knopf, ohne Saat) und „Anlegen“ im Dialog
 * „Neuen Einsatz anlegen“ (`ErfassungsModal`, dieselbe Hülle wie die Absende-Knöpfe der
 * Ablösung). Unter dem Zeiger wird erst gemessen, wenn die Fläche gewechselt hat; der Spec
 * sichert den Wechsel zu, sonst wäre „Hover gemessen“ trivial wahr.
 */

const TEXT = { light: 7, dark: 5 } as const;

async function ruheUndZeiger(page: Page, knopf: Locator, schranke: number, name: string) {
  await expect(knopf, name).toBeVisible();
  // Die Begründung „kein eigener Knopfboden“ setzt voraus, dass die Beschriftung kein Großtext
  // nach WCAG 1.4.3 ist (fett erst ab 18,66 px). Wächst ein Knopf darüber, ist das neu zu fragen.
  const schrift = await knopf.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(schrift, `${name}: Schriftgröße`).toBeLessThan(18.66);
  // Kein Zeiger, kein Fokus: die Ruhe.
  await page.mouse.move(0, 0);
  await knopf.evaluate((el) => (el as HTMLElement).blur());
  const ruhe = await stehend(knopf, `${name}, Ruhe`);
  expect(ruhe.verhaeltnis, `${name}, Ruhe: ${JSON.stringify(ruhe)}`).toBeGreaterThanOrEqual(
    schranke,
  );

  await knopf.hover();
  // Ohne den Wechsel wäre „unter dem Zeiger gemessen“ trivial wahr.
  await expect(async () => {
    const zeiger = await kontrast(knopf);
    expect(zeiger.grund, `${name}: Fläche unter dem Zeiger wechselt`).not.toEqual(ruhe.grund);
  }).toPass({ timeout: 10_000 });
  const zeiger = await stehend(knopf, `${name}, Zeiger`);
  expect(zeiger.grund, `${name}: Fläche unter dem Zeiger wechselt`).not.toEqual(ruhe.grund);
  expect(zeiger.verhaeltnis, `${name}, Zeiger: ${JSON.stringify(zeiger)}`).toBeGreaterThanOrEqual(
    schranke,
  );
}

/**
 * Misst erst, wenn das Bild STEHT: antd blendet Knopffläche und -farbe über, und ein früher
 * Wechsel ist ein Zwischenbild (gemessen 1 Farbwert neben der Ruhe), das jede Hover-Farbe
 * bestünde. Gewartet wird auf das Ende aller Übergänge, dann müssen zwei Messungen gleich sein.
 * Einblendungen (Karte, Modal) laufen als Opacity-Gruppe, die der Messkern ablehnt, bis sie
 * stehen.
 */
async function stehend(knopf: Locator, name: string) {
  let messung: Awaited<ReturnType<typeof kontrast>> | undefined;
  const ende = () =>
    knopf.evaluate((el) =>
      Promise.all(
        [el, ...el.querySelectorAll('*')].flatMap((e) => e.getAnimations()).map((a) => a.finished),
      ),
    );
  await expect(async () => {
    await ende();
    const erste = await kontrast(knopf);
    await ende();
    messung = await kontrast(knopf);
    expect(messung, `${name} steht`).toEqual(erste);
  }).toPass({ timeout: 10_000 });
  return messung!;
}

for (const modus of ['light', 'dark'] as const) {
  test(`Primärknopf in Ruhe und unter dem Zeiger — ${modus}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await page.goto('/login');

    const anmelden = page.getByRole('button', { name: 'Anmelden', exact: true });
    await ruheUndZeiger(page, anmelden, TEXT[modus], `${modus}/Anmelden`);

    await page.getByLabel('Benutzername').fill('admin');
    await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
    await anmelden.click();
    await expect(page).toHaveURL(/\/einsaetze/);

    await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
    const dialog = page.getByRole('dialog', { name: 'Neuen Einsatz anlegen' });
    const anlegen = dialog.getByRole('button', { name: 'Anlegen', exact: true });
    await ruheUndZeiger(page, anlegen, TEXT[modus], `${modus}/Anlegen`);
  });
}
