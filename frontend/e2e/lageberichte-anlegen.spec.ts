import { expect, test, type Page } from '@playwright/test';
import { einsatzAnlegen } from './einsatz-kern';

/**
 * Lageberichte (LLH-1064): „Neuer Lagevortrag“ legt mit EINEM POST an und öffnet den Entwurf,
 * der Pfeil wählt eine andere Vorlage, und die Übersicht zeigt den freigegebenen Stand vorn.
 * Seeding (Freigabe) über `page.request`, geprüft wird die Oberfläche.
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

/** Zählt die POSTs, die einen Lagebericht anlegen (nicht Fortschreiben, nicht PATCH). */
function zaehleAnlegen(page: Page, einsatzId: string): { anzahl: number } {
  const zaehler = { anzahl: 0 };
  page.on('request', (r) => {
    if (
      r.method() === 'POST' &&
      new URL(r.url()).pathname === `/api/einsaetze/${einsatzId}/lageberichte`
    ) {
      zaehler.anzahl += 1;
    }
  });
  return zaehler;
}

test.setTimeout(90_000);

test('„Neuer Lagevortrag“ legt mit einem POST an und öffnet den Entwurf', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Lagevortrag ${Date.now()}`);
  const posts = zaehleAnlegen(page, einsatzId);

  await page.goto(`/einsaetze/${einsatzId}/lageberichte`);
  // Leerzustand mit Aktion; der Kopf trägt denselben Knopf.
  await expect(page.getByText('Noch keine Lageberichte')).toBeVisible();
  await page
    .locator('[data-lfh="seitenkopf-aktionen"]')
    .getByRole('button', { name: 'Neuer Lagevortrag' })
    .click();

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lageberichte/\\d+$`));
  await expect(page.getByRole('button', { name: 'Entwurf speichern' })).toBeVisible();
  // Vorlage zur Information: ihr erster Abschnitt steht im Entwurf.
  await expect(page.getByLabel('Auftrag')).toBeAttached();
  await expect(page.getByLabel('Titel')).toHaveValue(/^Lageüberblick \d{4}$/);
  expect(posts.anzahl).toBe(1);
  // Kein Dialog auf dem Weg.
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('der Pfeil legt einen freien Bericht an, die Übersicht zeigt ihn in Arbeit', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Lagevortrag Pfeil ${Date.now()}`);
  const posts = zaehleAnlegen(page, einsatzId);

  await page.goto(`/einsaetze/${einsatzId}/lageberichte`);
  await expect(page.getByText('Noch keine Lageberichte')).toBeVisible();
  await page.getByRole('button', { name: 'Andere Vorlage wählen' }).click();
  const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden)');
  await expect(menue.getByRole('menuitem')).toHaveText([
    'Lagevortrag zur Entscheidung',
    'Freier Bericht',
  ]);
  await menue.getByRole('menuitem', { name: 'Freier Bericht' }).click();

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lageberichte/\\d+$`));
  await expect(page.getByLabel('Titel')).toHaveValue(/^Bericht \d{4}$/);
  expect(posts.anzahl).toBe(1);

  await page.goto(`/einsaetze/${einsatzId}/lageberichte`);
  const inArbeit = page.getByRole('region', { name: 'In Arbeit' });
  await expect(inArbeit.getByRole('link', { name: /^Bericht \d{4}$/ })).toBeVisible();
  await expect(inArbeit.getByText('0/1 Abschnitte')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Aktueller Lagevortrag' })).toHaveCount(0);
});

test('die Übersicht zeigt die jüngste Freigabe vorn, Fortschreiben öffnet die neue Fassung', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Lagevortrag Stand ${Date.now()}`);
  const E = `/api/einsaetze/${einsatzId}/lageberichte`;
  const angelegt = await page.request.post(E, {
    data: {
      vorlage: 'lagebericht',
      titel: 'Lageüberblick 0900',
      abschnitte: [{ schluessel: 'zusammenfassung', text: 'Lage in der Unterstadt angespannt.' }],
    },
  });
  expect(angelegt.ok(), await angelegt.text()).toBe(true);
  const { id } = (await angelegt.json()) as { id: number };
  const frei = await page.request.post(`${E}/${id}/freigeben`);
  expect(frei.ok(), await frei.text()).toBe(true);

  await page.goto(`/einsaetze/${einsatzId}/lageberichte`);
  const aktuell = page.getByRole('region', { name: 'Aktueller Lagevortrag' });
  await expect(aktuell.getByRole('heading', { name: 'Lageüberblick 0900' })).toBeVisible();
  await expect(aktuell.getByText('Lage in der Unterstadt angespannt.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'In Arbeit' })).toContainText(
    'Kein Entwurf in Arbeit',
  );

  await aktuell.getByRole('button', { name: 'Fortschreiben' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lageberichte/\\d+$`));
  await expect(page).not.toHaveURL(new RegExp(`/lageberichte/${id}$`));
  await expect(page.getByRole('button', { name: 'Freigeben' })).toBeVisible();
});
