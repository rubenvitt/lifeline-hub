import { expect, test, type Page } from '@playwright/test';
import { einsatzAnlegen } from './einsatz-kern';

/**
 * Aktionen eines Abschnitts gegliederter Dokumente im Browser (LLH-1601, Spec `dokument-entwurf`,
 * `openspec/changes/amp1au76-gliederung-kontextmenue/design.md`). Was jsdom nicht belegt: der
 * echte Rechtsklick ohne Browsermenü, die Fokusfolge nach dem Schließen des Menüs (D3) und dass
 * „Abschnitt leeren“ den Verlustschutz der Seite erreicht (D2). Seeding per `page.request`.
 */

test.setTimeout(90_000);

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function lageberichtMitText(page: Page) {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gliederung-Menü ${Date.now()}`);
  const angelegt = await page.request.post(`/api/einsaetze/${einsatzId}/lageberichte`, {
    data: { vorlage: 'lagebeurteilung', titel: 'Gliederung Menü' },
  });
  expect(angelegt.ok(), await angelegt.text()).toBe(true);
  const id = (await angelegt.json()).id as number;
  const api = `/api/einsaetze/${einsatzId}/lageberichte/${id}`;
  const gefuellt = await page.request.patch(api, {
    data: { abschnitte: [{ schluessel: 'auftrag', text: 'Auftrag steht' }] },
  });
  expect(gefuellt.ok(), await gefuellt.text()).toBe(true);
  return { api, detail: `/einsaetze/${einsatzId}/lageberichte/${id}` };
}

const gliederung = (page: Page) => page.getByRole('navigation', { name: 'Gliederung' });

test('Rechtsklick in der Gliederung: Sprung fokussiert das Feld, Leeren erreicht den Verlustschutz', async ({
  page,
}) => {
  const { api, detail } = await lageberichtMitText(page);
  // Speichern scheitert: die Fassung bleibt offen, und der Verlustschutz muss sie halten.
  await page.route(`**${api}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"Offline"}',
      });
    } else await route.continue();
  });
  await page.goto(detail);
  const feld = page.getByRole('textbox', { name: 'Auftrag', exact: true });
  await expect(feld).toHaveValue('Auftrag steht');

  const eintrag = gliederung(page).getByRole('button', { name: 'Auftrag', exact: true });
  await eintrag.click({ button: 'right' });
  const menue = page.getByRole('menu', { name: 'Aktionen zu Abschnitt Auftrag in der Gliederung' });
  await expect(menue).toBeVisible();
  await expect(menue.getByRole('menuitem')).toHaveText([
    'Zum Abschnitt springen',
    'Text kopieren',
    'In der Lesefassung zeigen',
    'Abschnitt leeren',
  ]);

  // Der Sprung behält das Feld: das Menü gibt seinen Fokus vorher an den Eintrag zurück.
  await menue.getByRole('menuitem', { name: 'Zum Abschnitt springen' }).click();
  await expect(menue).toBeHidden();
  await expect(feld).toBeFocused();

  await eintrag.click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Aktionen zu Abschnitt Auftrag in der Gliederung' })
    .getByRole('menuitem', { name: 'Abschnitt leeren' })
    .click();
  const rueckfrage = page.getByRole('dialog', { name: 'Abschnitt „Auftrag“ leeren?' });
  await rueckfrage.getByRole('button', { name: 'Abschnitt leeren' }).click();
  await expect(rueckfrage).toBeHidden();
  await expect(feld).toHaveValue('');
  await expect(gliederung(page).getByRole('button', { name: 'Auftrag leer' })).toBeVisible();

  // Der Verlustschutz hat das Leeren gesehen: der Wechsel wird angehalten.
  await page.locator('.ant-breadcrumb').getByRole('link', { name: 'Lageberichte' }).click();
  await expect(page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })).toBeVisible();
  await expect(page).toHaveURL(detail);
});

test('Im Textfeld bleibt das Browsermenü; das ⋮ im Kopf führt in die Lesefassung', async ({
  page,
}) => {
  const { detail } = await lageberichtMitText(page);
  await page.goto(detail);
  const feld = page.getByRole('textbox', { name: 'Auftrag', exact: true });
  await expect(feld).toHaveValue('Auftrag steht');

  // Kein eigenes Menü: das `contextmenu` bleibt unverhindert beim Browser.
  const verhindert = await feld.evaluate((el) => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(verhindert).toBe(false);
  await expect(page.getByRole('menu')).toHaveCount(0);

  await page.getByRole('button', { name: 'Aktionen zu Abschnitt Auftrag', exact: true }).click();
  await page.getByRole('menuitem', { name: 'In der Lesefassung zeigen' }).click();
  await expect(page.getByRole('tab', { name: 'Lesefassung' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const lesen = page.getByRole('tabpanel', { name: 'Lesefassung' });
  const abschnitt = lesen.locator('section', {
    has: page.getByRole('heading', { level: 3, name: 'Auftrag', exact: true }),
  });
  await expect(abschnitt).toBeFocused();
  await expect(abschnitt).toBeInViewport();
});

test('Befehl: ⋮ und Rechtsklick auf den Abschnittskopf zeigen dieselben Einträge', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Befehl-Menü ${Date.now()}`);
  const angelegt = await page.request.post(`/api/einsaetze/${einsatzId}/befehle`, {
    data: { vorlage: 'befehl_ladef', titel: 'Befehl Menü' },
  });
  expect(angelegt.ok(), await angelegt.text()).toBe(true);
  const id = (await angelegt.json()).id as number;
  await page.goto(`/einsaetze/${einsatzId}/auftraege/befehle/${id}`);

  const erwartet = ['Text kopieren', 'In der Lesefassung zeigen', 'Abschnitt leeren'];
  await page.getByRole('button', { name: 'Aktionen zu Abschnitt Lage', exact: true }).click();
  const dreipunkt = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
  await expect(dreipunkt.getByRole('menuitem')).toHaveText(erwartet);
  // Leerer Abschnitt: nichts zu kopieren.
  await expect(dreipunkt.getByRole('menuitem', { name: 'Text kopieren' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(dreipunkt).toHaveCount(0);

  await page
    .getByRole('heading', { level: 3, name: 'Lage', exact: true })
    .click({ button: 'right' });
  const kontext = page.getByRole('menu', { name: 'Aktionen zu Abschnitt Lage', exact: true });
  await expect(kontext.getByRole('menuitem')).toHaveText(erwartet);
});
