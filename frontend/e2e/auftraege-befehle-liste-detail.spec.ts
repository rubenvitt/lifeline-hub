import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Aufträge und Befehle im Muster „Liste + Detailpaneel“ (Change
 * `oxgob5gk-auftraege-befehle-angleichen`, Specs `liste-detail` und `auftraege-befehle`): beide
 * Abläufe Ende-zu-Ende am Fükw-Schirm und auf dem Handschirm. Die Treffflächen im Handschuh-Betrieb
 * misst `trefflaeche-pruefflaechen.spec.ts`.
 */

test.setTimeout(90_000);

async function einsatz(page: Page): Promise<string> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Liste und Detail ${Date.now()}` },
  });
  expect(r.ok(), `POST /api/einsaetze: ${r.status()} ${await r.text()}`).toBe(true);
  return String(((await r.json()) as { id: number }).id);
}

async function auftragPerApi(page: Page, einsatzId: string, text: string) {
  const r = await page.request.post(`/api/einsaetze/${einsatzId}/auftraege`, {
    data: {
      auftrag_text: text,
      empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'EA Nord' }],
    },
  });
  expect(r.ok(), `Auftrag: ${r.status()}`).toBe(true);
}

/** Kein waagerechtes Scrollen der Seite (Spec `liste-detail`, „Anordnung je Breite“). */
async function keinQuerScroll(page: Page) {
  const { breite, sicht } = await page.evaluate(() => ({
    breite: document.documentElement.scrollWidth,
    sicht: window.innerWidth,
  }));
  expect(breite).toBeLessThanOrEqual(sicht);
}

const detail = (page: Page) => page.locator('[data-lfh="liste-detail-detail"]');

for (const kontext of [
  { name: 'Fükw', breite: 1366, hoehe: 768 },
  { name: 'Handschirm', breite: 390, hoehe: 844 },
] as const) {
  test(`Auftrag erteilen, quittieren, Vollzug melden und abnehmen (${kontext.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: kontext.breite, height: kontext.hoehe });
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatz(page);
    await page.goto(`/einsaetze/${einsatzId}/auftraege`);

    // Erteilen im Dialog, nicht mehr im Paneel über der Liste.
    await page.getByRole('button', { name: 'Auftrag erteilen' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Auftrag erteilen' });
    await expect(dialog).toBeVisible();
    const empfaenger = dialog.getByRole('combobox', { name: 'Empfänger' });
    await empfaenger.fill('EA Nord');
    await empfaenger.press('Enter');
    await dialog.getByLabel('Auftrag / Was').fill('Hydrant H12 freilegen');
    await dialog.getByRole('button', { name: 'Auftrag erteilen', exact: true }).click();
    await expect(dialog).toBeHidden();

    const ziel = page.getByRole('button', { name: /: Hydrant H12 freilegen$/ });
    await expect(ziel).toBeVisible();
    // Ab lg ist der einzige Auftrag vorgewählt; auf dem Handschirm wird er aufgeklappt.
    if (kontext.breite < 992) {
      await expect(ziel).toHaveAttribute('aria-expanded', 'false');
      await ziel.click();
      await expect(ziel).toHaveAttribute('aria-expanded', 'true');
    } else {
      await expect(ziel).toHaveAttribute('aria-current', 'true');
    }
    await keinQuerScroll(page);

    // Quittieren im Detail.
    await detail(page).getByRole('button', { name: 'Empfang für EA Nord quittieren' }).click();
    await page.getByRole('button', { name: 'Empfang quittieren' }).click();
    await expect(page.locator('[data-auftrag-id]').getByText('1/1 quittiert')).toBeVisible();

    // Vollzug melden: der Auftrag fällt aus „Offen“, das Detail bleibt mit Hinweis.
    await detail(page).getByRole('button', { name: 'Vollzug melden' }).click();
    const vollzug = page.getByRole('dialog', { name: 'Vollzug melden' });
    await vollzug.getByPlaceholder('Rückmeldung zur Erledigung').fill('Hydrant frei');
    await vollzug.getByRole('button', { name: 'Vollzug melden' }).click();
    await expect(detail(page).getByText('Nicht mehr in dieser Ansicht')).toBeVisible();
    await expect(page.locator('[data-auftrag-id]')).toHaveCount(0);

    // In „Abgeschlossen“ wählen und abnehmen.
    await page.getByRole('radio', { name: /^Abgeschlossen/ }).click();
    const abgeschlossen = page.getByRole('button', { name: /: Hydrant H12 freilegen$/ });
    if (kontext.breite < 992) await abgeschlossen.click();
    await detail(page).getByRole('button', { name: 'Abnehmen' }).click();
    await page.getByRole('button', { name: 'Auftrag abnehmen' }).click();
    await expect(detail(page).getByRole('list', { name: 'Verlauf' })).toContainText('abgenommen');
    await keinQuerScroll(page);
  });

  test(`Befehl entwerfen, auf der Vollseite schreiben, im Detail freigeben (${kontext.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: kontext.breite, height: kontext.hoehe });
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatz(page);
    await page.goto(`/einsaetze/${einsatzId}/auftraege?reiter=befehle`);

    await page.getByRole('button', { name: 'Befehl entwerfen', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Titel').fill('Befehl an 2. Zug');
    await dialog.getByRole('button', { name: 'Entwurf anlegen' }).click();
    await expect(page).toHaveURL(/\/auftraege\/befehle\/\d+$/);

    // Auf der Vollseite schreiben, dann über den Ortspfad zurück.
    await page.getByRole('textbox', { name: /Lage/ }).first().fill('Brand im Lager Nord.');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await expect(page.getByText(/zuletzt gespeichert/)).toBeVisible();
    await page.getByRole('link', { name: 'Aufträge/Befehle', exact: true }).click();

    // Zurück: Reiter Befehle, der Befehl gewählt und markiert (D6).
    const ziel = page.getByRole('button', { name: 'Befehl v1: Befehl an 2. Zug' });
    await expect(ziel).toBeVisible();
    await expect(page.locator('[data-befehl-id]').first()).toHaveAttribute(
      'data-hervorgehoben',
      'true',
    );
    await expect(detail(page).getByText('Brand im Lager Nord.')).toBeVisible();
    await keinQuerScroll(page);

    // Freigeben im Detail: Rückfrage mit Folge, dann fällt der Befehl aus „Entwürfe“.
    await detail(page).getByRole('button', { name: 'Freigeben' }).click();
    const freigabe = page.getByRole('dialog', { name: 'Befehl freigeben?' });
    await expect(freigabe).toContainText('Endgültig: geht ins ETB');
    await freigabe.getByRole('button', { name: 'Freigeben' }).click();
    await expect(detail(page).getByText('Nicht mehr in dieser Ansicht')).toBeVisible();
    await expect(detail(page).getByRole('button', { name: 'Fortschreiben' })).toBeVisible();

    await page.getByRole('radio', { name: /^Freigegeben/ }).click();
    await expect(page.getByRole('button', { name: 'Befehl v1: Befehl an 2. Zug' })).toBeVisible();
  });
}

test('ab lg bleibt das Detail beim Scrollen der Liste im Blick (Fükw)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatz(page);
  for (let i = 0; i < 14; i += 1) await auftragPerApi(page, einsatzId, `Auftrag Nummer ${i}`);
  await page.goto(`/einsaetze/${einsatzId}/auftraege`);
  await expect(detail(page)).toBeVisible();
  await page.mouse.wheel(0, 4000);
  await expect.poll(async () => (await detail(page).boundingBox())!.y).toBeGreaterThanOrEqual(0);
  const kasten = (await detail(page).boundingBox())!;
  expect(kasten.y).toBeLessThan(768);
  // Die oberste Karte ist aus dem Bild gescrollt, das Detail nicht.
  const erste = (await page.locator('[data-auftrag-id]').first().boundingBox())!;
  expect(erste.y + erste.height).toBeLessThan(0);
});
