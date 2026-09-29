import { expect, test, type Page } from '@playwright/test';

/**
 * Der Helligkeitsregler im Browser (LFH-397, design.md D4/D5). jsdom rendert kein
 * `::after`; was die Deckschicht tut, ist nur hier messbar:
 *  - das Bootstrap-Skript in `index.html` dunkelt VOR der App ab,
 *  - ein Klick geht durch die Schicht hindurch (LFH-355: `toBeVisible()` ist kein Beleg
 *    für Klickbarkeit — deshalb wird geklickt),
 *  - der Druck wird nie abgedunkelt.
 * Die Warnsperre selbst belegen `theme/helligkeit.test.ts` (Regel),
 * `theme/helligkeitProvider.test.tsx` (Austritt) und `einsatz/EinsatzLayout.test.tsx`
 * (Warnquelle im Rahmen).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function waehle40(page: Page) {
  await page.evaluate(() => localStorage.setItem('lifeline-hub.helligkeit', '40'));
}

/** Die Deckschicht, wie der Browser sie berechnet. */
function schicht(page: Page) {
  return page.evaluate(() => {
    const s = getComputedStyle(document.documentElement, '::after');
    return {
      merkmal: document.documentElement.dataset.helligkeit ?? null,
      content: s.content,
      opacity: s.opacity,
      pointerEvents: s.pointerEvents,
    };
  });
}

test('Bootstrap: die gespeicherte Stufe dunkelt ab, bevor ein App-Skript läuft', async ({
  page,
}) => {
  await anmelden(page);
  await waehle40(page);
  // Jedes externe Skript abweisen: übrig bleiben nur die Inline-Skripte aus `index.html`.
  // Steht das Merkmal danach, hat es das Bootstrap-Skript gesetzt — nicht der Provider.
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'script' ? route.abort() : route.continue(),
  );
  await page.goto('/einsaetze');
  // Geprüft wird, was das Skript setzt — Merkmal und Deckkraft —, nicht die Regel: die
  // kommt mit dem Stylesheet (im Produktions-Bundle ein `<link>` im Kopf, unter dem
  // Vite-Dev-Server erst über das Modul, das hier abgewiesen ist). Die Regel selbst belegen
  // die übrigen Tests dieser Datei.
  expect(
    await page.evaluate(() => ({
      merkmal: document.documentElement.dataset.helligkeit ?? null,
      deckkraft: document.documentElement.style.getPropertyValue('--lfh-abdunkelung'),
    })),
  ).toEqual({ merkmal: '40', deckkraft: '0.6' });
});

test('Klick durch die Deckschicht: bei 40 % löst ein Knopf aus', async ({ page }) => {
  await anmelden(page);
  await waehle40(page);
  await page.reload();
  expect((await schicht(page)).opacity).toBe('0.6');
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('Druck: bei 40 % wird nichts abgedunkelt, am Schirm schon', async ({ page }) => {
  await anmelden(page);
  await waehle40(page);
  await page.reload();
  expect((await schicht(page)).content).toBe('""');
  await page.emulateMedia({ media: 'print' });
  expect((await schicht(page)).content).toBe('none');
});

test('volle Helligkeit: keine Deckschicht', async ({ page }) => {
  await anmelden(page);
  await page.evaluate(() => localStorage.removeItem('lifeline-hub.helligkeit'));
  await page.reload();
  const s = await schicht(page);
  expect(s.merkmal).toBe('100');
  expect(s.content).toBe('none');
});
