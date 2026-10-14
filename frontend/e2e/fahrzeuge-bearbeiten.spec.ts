import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Fahrzeuge im Einsatz bearbeiten (LLH-1073 Teil I), Durchstich im Browser: die Einheit eines
 * Fahrzeugs in seiner Zeile wählen (der Abschnitt folgt, das Meldebild zeigt es bei der Einheit,
 * ein Wechsel nennt im ETB die vorige) und die Angaben eines Ad-hoc-Fahrzeugs ändern (ein
 * ETB-Eintrag zählt die Änderungen auf). Gesät wird per API, gewartet auf Inhaltsanker, nie auf
 * `networkidle` (LFH-385).
 */

/** Breit genug, dass auch der Abschnitt steht (er weicht unter `xxl`, design.md D5). */
const BREIT = { width: 1700, height: 900 } as const;

async function seede(page: Page, funkrufname: string) {
  const post = async (pfad: string, data: unknown) => {
    const antwort = await page.request.post(pfad, { data });
    expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
    return ((await antwort.json()) as { id: number }).id;
  };
  const einsatzId = await post('/api/einsaetze', { bezeichnung: `E2E Fahrzeuge ${Date.now()}` });
  const basis = `/api/einsaetze/${einsatzId}`;
  const abschnitt = await post(`${basis}/abschnitte`, { name: 'Sanitätsdienst' });
  const zug = await post(`${basis}/einheiten`, { name: 'Zug 1', abschnitt_id: abschnitt });
  const staffel = await post(`${basis}/einheiten`, { name: 'Staffel A', ueber_einheit_id: zug });
  const fahrzeug = await post(`${basis}/fahrzeuge`, { adhoc: { funkrufname } });
  return { einsatzId, zug, staffel, fahrzeug };
}

/** Wählt in der Einheit-Auswahl einer Zeile und speichert. */
async function waehleEinheit(page: Page, funkrufname: string, pfad: string, leer: boolean) {
  const region = page.getByRole('region', { name: 'Fahrzeuge im Einsatz', exact: true });
  await region
    .getByRole('button', { name: `Einheit zu ${funkrufname} ${leer ? 'eintragen' : 'bearbeiten'}` })
    .click();
  await page.getByRole('combobox', { name: `Einheit zu ${funkrufname}` }).click();
  await page.locator(`.ant-select-item-option[title="${pfad}"]`).click();
  await region.getByRole('button', { name: `Einheit zu ${funkrufname} speichern` }).click();
}

test('Fahrzeug einer Einheit zuordnen: der Abschnitt folgt, das Meldebild zeigt es dort, ein Wechsel nennt die vorige', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const { einsatzId, staffel } = await seede(page, '83-1');
  await page.setViewportSize(BREIT);
  await page.goto(`/einsaetze/${einsatzId}/fahrzeuge?ansicht=liste`);
  const region = page.getByRole('region', { name: 'Fahrzeuge im Einsatz', exact: true });
  const zeile = region.locator('tr.ant-table-row').filter({ hasText: '83-1' });
  await expect(zeile).toHaveCount(1);

  // Die Staffel trägt keinen eigenen Abschnitt: sie erbt den des Zugs (design.md D4).
  await waehleEinheit(page, '83-1', 'Zug 1 › Staffel A', true);
  await expect(zeile.getByRole('button', { name: 'Einheit zu 83-1 bearbeiten' })).toHaveText(
    'Staffel A',
  );
  await expect(zeile.getByText('Sanitätsdienst', { exact: true })).toBeVisible();

  // Das Meldebild zeigt das Fahrzeug bei der Staffel.
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht?einheit=${staffel}`);
  const meldebild = page.getByRole('region', { name: 'Meldebild' });
  const markiert = meldebild.locator('tr.zeile-hervorgehoben');
  await expect(markiert).toContainText('Staffel A');
  // Der Funkrufname steht in der Zeile der Staffel und als ihr Mittel darunter.
  await expect(meldebild.getByText('83-1', { exact: true }).first()).toBeVisible();

  // Umhängen zum Zug: das ETB nennt die vorige Einheit.
  await page.goto(`/einsaetze/${einsatzId}/fahrzeuge?ansicht=liste`);
  await waehleEinheit(page, '83-1', 'Zug 1', false);
  await expect(zeile.getByRole('button', { name: 'Einheit zu 83-1 bearbeiten' })).toHaveText(
    'Zug 1',
  );
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(
    page.getByText('Einheit «Zug 1»: Fahrzeug «83-1» zugeordnet, vorher «Staffel A»'),
  ).toBeVisible();
});

test('Angaben eines Ad-hoc-Fahrzeugs ändern: die Zeile zeigt den neuen Namen, ein ETB-Eintrag zählt die Änderungen auf', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const alt = 'Florian Nachbarstdt 44/1';
  const neu = 'Florian Nachbarstadt 44/1';
  const { einsatzId } = await seede(page, alt);
  await page.goto(`/einsaetze/${einsatzId}/fahrzeuge?ansicht=liste`);
  const region = page.getByRole('region', { name: 'Fahrzeuge im Einsatz', exact: true });
  await expect(region.getByText(alt, { exact: true })).toBeVisible();

  await region.getByRole('button', { name: `Weitere Aktionen zu ${alt}` }).click();
  await page.getByRole('menuitem', { name: 'Angaben ändern …' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Funkrufname')).toHaveValue(alt);
  await dialog.getByLabel('Funkrufname').fill(neu);
  await dialog.getByLabel('Fahrzeugtyp').fill('HLF 20');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(region.getByText(neu, { exact: true })).toBeVisible();
  await expect(region.getByText(alt, { exact: true })).toHaveCount(0);

  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(
    page.getByText(`Fahrzeug «${alt}»: Funkrufname «${alt}» → «${neu}», Typ «—» → «HLF 20»`),
  ).toBeVisible();
});
