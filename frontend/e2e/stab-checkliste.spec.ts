import { expect, test, type Page } from '@playwright/test';
import { einsatzAnlegen } from './einsatz-kern';

/**
 * Checkliste Arbeitsaufnahme (LFH-551): der Klickweg im echten Browser.
 *
 * - Ein Tipp auf den ZEILENTEXT (nicht die Box) hakt ab: das `<label>` ist das Bedienziel.
 *   Geklickt, nicht `toBeVisible()` — Sichtbarkeit ist kein Beleg für Klickbarkeit (LFH-355).
 * - Der Haken ist nach dem Neuladen noch da (Server, nicht Komponentenzustand).
 * - Ins ETB schreibt allein die Meldung an die Leitstelle, genau einmal, und der Eintrag steht
 *   in der ETB-Zeitachse. Ein anderer Punkt schreibt nichts.
 * - Die Rücknahme ist ein zweiter Beleg (E1 = A), ohne Rückfrage.
 *
 * Trefflächen je Dichtestufe misst `gate3-trefflaeche.spec.ts` (Stab, auch als Beobachter).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const FUEKW = { width: 1366, height: 768 };
const GEMELDET = 'Einsatzbereitschaft der Führungseinheit an die Leitstelle gemeldet';
const ZURUECK = 'Meldung der Einsatzbereitschaft an die Leitstelle zurückgenommen';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** System-ETB-Einträge, deren Inhalt `nadel` enthält — gezählt am Server, nicht am DOM. */
async function etbTreffer(page: Page, einsatzId: string, nadel: string): Promise<number> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/etb`);
  expect(antwort.ok()).toBeTruthy();
  const eintraege = (await antwort.json()) as { typ: string; inhalt: string }[];
  return eintraege.filter((e) => e.typ === 'system' && e.inhalt.includes(nadel)).length;
}

test('Arbeitsaufnahme: Tipp auf den Zeilentext hakt ab, übersteht das Neuladen, nur die Meldung belegt im ETB', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Arbeitsaufnahme ${Date.now()}`);

  await page.goto(`/einsaetze/${einsatzId}/stab`);
  const paneel = page.getByRole('region', { name: 'Arbeitsaufnahme', exact: true });
  await expect(paneel.getByText('0/7 erledigt')).toBeVisible();

  // Ein Punkt ohne Beleg: abhaken über den Text, kein ETB-Eintrag.
  const skizze = paneel.getByRole('checkbox', { name: 'Lageskizze begonnen' });
  await paneel.getByText('Lageskizze begonnen', { exact: true }).click();
  await expect(skizze).toBeChecked();
  const systemVorher = await etbTreffer(page, einsatzId, 'Arbeitsaufnahme');
  expect(systemVorher, 'ein Haken am Arbeitsmittel schreibt nichts ins ETB').toBe(0);

  // Die Meldung an die Leitstelle: genau ein Beleg.
  const meldung = paneel.getByRole('checkbox', {
    name: 'Einsatzbereitschaft an die Leitstelle gemeldet',
  });
  await paneel.getByText('Einsatzbereitschaft an die Leitstelle gemeldet', { exact: true }).click();
  await expect(meldung).toBeChecked();
  await expect(paneel.getByText('2/7 erledigt')).toBeVisible();
  await expect.poll(() => etbTreffer(page, einsatzId, GEMELDET)).toBe(1);

  // Der Stand kommt vom Server.
  await page.reload();
  await expect(paneel.getByText('2/7 erledigt')).toBeVisible();
  await expect(meldung).toBeChecked();
  await expect(skizze).toBeChecked();

  // Rücknahme ohne Rückfrage, belegt.
  await meldung.click();
  await expect(meldung).not.toBeChecked();
  await expect(page.locator('.ant-modal, .ant-popconfirm')).toHaveCount(0);
  await expect.poll(() => etbTreffer(page, einsatzId, ZURUECK)).toBe(1);
  expect(await etbTreffer(page, einsatzId, GEMELDET)).toBe(1);

  // Der Beleg steht in der ETB-Zeitachse.
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByText(GEMELDET)).toHaveCount(1);
});

/**
 * LLH-1124 (design.md D6): der siebte Haken klappt nicht unter der Hand ein; nach dem Neuladen
 * steht das Paneel eingeklappt mit „7/7 erledigt“ und klappt per Knopf wieder auf.
 */
test('Arbeitsaufnahme: bei 7/7 nach dem Neuladen eingeklappt, „Aufklappen“ zeigt die Punkte', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Arbeitsaufnahme 7/7 ${Date.now()}`);
  for (const punkt of [
    'aufstellort',
    'einweisung',
    'lageskizze',
    'funkarbeitsplaetze',
    'sprechgruppen',
    'etb_eroeffnet',
  ]) {
    const antwort = await page.request.put(`/api/einsaetze/${einsatzId}/stab/checkliste/${punkt}`, {
      data: { erledigt: true },
    });
    expect(antwort.ok(), `${punkt}: ${antwort.status()}`).toBe(true);
  }

  await page.goto(`/einsaetze/${einsatzId}/stab`);
  const paneel = page.getByRole('region', { name: 'Arbeitsaufnahme', exact: true });
  await expect(paneel.getByText('6/7 erledigt')).toBeVisible();
  await paneel.getByText('Einsatzbereitschaft an die Leitstelle gemeldet', { exact: true }).click();
  await expect(paneel.getByText('7/7 erledigt')).toBeVisible();
  // Der letzte Haken klappt nicht ein: die Punkte bleiben stehen.
  await expect(paneel.getByRole('checkbox')).toHaveCount(7);

  await page.reload();
  await expect(paneel.getByText('7/7 erledigt')).toBeVisible();
  const auf = paneel.getByRole('button', { name: 'Aufklappen', exact: true });
  await expect(auf).toHaveAttribute('aria-expanded', 'false');
  await expect(paneel.getByRole('checkbox')).toHaveCount(0);
  await auf.click();
  await expect(paneel.getByRole('checkbox')).toHaveCount(7);
  await expect(paneel.getByRole('button', { name: 'Einklappen', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});
