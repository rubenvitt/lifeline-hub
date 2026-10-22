import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Nachforderung schneller erfassen (LLH-1089, Spec `nachforderung-erfassung`): „2× RTW → BR Nord“
 * mit Schnellwahl, einer Ziffer und Enter. Der einzige aktive Raum steht als Ziel vor; die Karte
 * nennt ihn, das ETB schreibt Kurzname und Ziel. Geklickt, nicht nur sichtbar (`e2e/AGENTS.md`).
 */

async function senden<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `post ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

test('Schnellwahl, Anzahl, Enter: „2× RTW → BR Nord“ an Karte und ETB', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const { id: einsatzId } = await senden(page, '/api/einsaetze', {
    bezeichnung: `Nachforderung schnell ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}`;
  const { id: br } = await senden(page, `${basis}/bereitstellungsraeume`, {
    bezeichnung: 'BR Nord',
  });
  await senden(page, `${basis}/bereitstellungsraeume/${br}/status`, { status: 'aktiv' });

  await page.goto(`/einsaetze/${einsatzId}/nachforderungen`);
  await page.getByRole('button', { name: 'Nachforderung anlegen' }).click();
  const paneel = page.getByRole('region', { name: 'Neue Nachforderung' });
  // Die Vorgabe kommt mit der Raumliste.
  await expect(paneel.getByRole('combobox', { name: 'Wohin' })).toHaveValue('BR Nord');

  await paneel
    .getByRole('group', { name: 'Schnellwahl' })
    .getByRole('button', { name: 'RTW', exact: true })
    .click();
  await expect(paneel.getByRole('combobox', { name: 'Was' })).toHaveValue('RTW');
  await expect(paneel.getByLabel('Anzahl')).toBeFocused();
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');

  const karte = page.locator('[data-nachforderung-id]').filter({ hasText: '2× RTW' });
  await expect(karte).toBeVisible();
  await expect(karte.locator('[data-lfh="nachforderung-ziel"]')).toHaveText('→ BR Nord');
  // Die Serie bleibt offen, „Was“ ist leer, die Vorgabe steht wieder da.
  await expect(paneel.getByRole('combobox', { name: 'Was' })).toHaveValue('');
  await expect(paneel.getByRole('combobox', { name: 'Wohin' })).toHaveValue('BR Nord');

  const etb = await page.request.get(`${basis}/etb`);
  expect(etb.ok()).toBeTruthy();
  const eintraege = (await etb.json()) as { inhalt: string }[];
  expect(eintraege.map((e) => e.inhalt)).toContain('Nachforderung: 2× RTW → BR Nord');
});
