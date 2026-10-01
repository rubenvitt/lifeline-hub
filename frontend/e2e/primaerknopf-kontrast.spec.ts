import { expect, test } from '@playwright/test';
import { ruheUndZeiger } from './kontrast-kern';

/**
 * Beschriftung des Primärknopfs (Text auf satter Bedienfläche) in Ruhe UND unter dem Zeiger,
 * Tag und Nacht (LFH-661, Spec `farbrollen-kontrast`). Kein eigener Knopfboden: der Textboden
 * aus Kriterium 5 gilt als Literal, Tag ≥ 7 : 1, Nacht ≥ 5 : 1. Gerechnet steht dasselbe in
 * `src/theme/bedienKontrast.test.ts`; hier zählt, was der Browser wirklich zeichnet.
 *
 * GEMESSEN: „Anmelden“ der Anmeldeseite (großer Knopf, ohne Saat) und „Anlegen“ im Dialog
 * „Neuen Einsatz anlegen“ (`ErfassungsModal`, dieselbe Hülle wie die Absende-Knöpfe der
 * Ablösung). Unter dem Zeiger wird erst gemessen, wenn die Fläche gewechselt hat; der Spec
 * sichert den Wechsel zu, sonst wäre „Hover gemessen“ trivial wahr. Die Messung in Ruhe und
 * unter dem Zeiger (`ruheUndZeiger`) teilt er mit `gefahr-kontrast.spec.ts` über den Messkern.
 */

const TEXT = { light: 7, dark: 5 } as const;

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
