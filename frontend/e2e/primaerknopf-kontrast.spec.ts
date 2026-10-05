import { expect, test } from '@playwright/test';
import { gedrueckt, ruheUndZeiger } from './kontrast-kern';

/**
 * Beschriftung des Primärknopfs (Text auf satter Bedienfläche) in Ruhe, unter dem Zeiger und
 * gedrückt, Tag und Nacht (LFH-661, LFH-897, Spec `farbrollen-kontrast`). Kein eigener
 * Knopfboden: der Textboden aus Kriterium 5 gilt als Literal, Tag ≥ 7 : 1, Nacht ≥ 5 : 1.
 * Gerechnet steht dasselbe in `src/theme/bedienKontrast.test.ts`; hier zählt, was der Browser
 * wirklich zeichnet.
 *
 * GEMESSEN: „Anmelden“ der Anmeldeseite (großer Knopf, ohne Saat) und „Anlegen“ im Dialog
 * „Neuen Einsatz anlegen“ (`ErfassungsModal`, dieselbe Hülle wie die Absende-Knöpfe der
 * Ablösung). Unter dem Zeiger wird erst gemessen, wenn die Fläche gewechselt hat; der Spec
 * sichert den Wechsel zu, sonst wäre „Hover gemessen“ trivial wahr. Die Messung in Ruhe und
 * unter dem Zeiger (`ruheUndZeiger`) teilt er mit `gefahr-kontrast.spec.ts` über den Messkern.
 * Gedrückt (LFH-897) misst er „Anmelden“: antds abgeleiteter Drückton lag nachts DUNKLER als die
 * Ruhe und unter der dunklen Schrift bei 3,35 : 1. Losgelassen wird neben dem Knopf, also ohne
 * Anmeldung (`gedrueckt`).
 */

const TEXT = { light: 7, dark: 5 } as const;

for (const modus of ['light', 'dark'] as const) {
  test(`Primärknopf in Ruhe, unter dem Zeiger und gedrückt — ${modus}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await page.goto('/login');

    const anmelden = page.getByRole('button', { name: 'Anmelden', exact: true });
    const { ruhe } = await ruheUndZeiger(page, anmelden, TEXT[modus], `${modus}/Anmelden`);
    await gedrueckt(page, anmelden, TEXT[modus], `${modus}/Anmelden`, ruhe);
    await expect(page).toHaveURL(/\/login/);

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
