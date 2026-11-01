import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Detailseite einer Betreuungsstelle (LLH-1044): aus der Übersicht über die Kennung hinein,
 * „Belegung melden“ aus dem Kopf, die Zahl im Band „Belegung in Zahlen“ folgt; Leitung und
 * Kontakt in der Ansicht bearbeiten. Geklickt, nicht nur sichtbar (`e2e/AGENTS.md`). Mit der
 * zweiten Meldung entsteht die Stufenlinie der Belegung (LLH-1347).
 */

async function senden<T = { id: number }>(
  page: Page,
  methode: 'post' | 'patch',
  pfad: string,
  data?: unknown,
): Promise<T> {
  const r = await page.request[methode](pfad, { data });
  expect(r.ok(), `${methode} ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

const STELLE = 'Grundschule Am Deich';

async function saeStelle(page: Page): Promise<{ einsatzId: number; stelleId: number }> {
  const { id: einsatzId } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `Stelle Detail ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}/betreuung`;
  const { id: stelleId } = await senden(page, 'post', `${basis}/stellen`, {
    bezeichnung: STELLE,
    art: 'notunterkunft',
    kapazitaet_personen: 120,
  });
  await senden(page, 'patch', `${basis}/stellen/${stelleId}`, { status: 'in_betrieb' });
  await senden(page, 'post', `${basis}/stellen/${stelleId}/belegungen`, { belegt: 40 });
  return { einsatzId, stelleId };
}

test('Übersicht → Detailseite → Belegung melden: die Kennzahl folgt, Stammdaten in der Ansicht', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const { einsatzId, stelleId } = await saeStelle(page);

  await page.goto(`/einsaetze/${einsatzId}/betreuung`);
  const tabelle = page.getByRole('region', { name: 'Betreuungsstellen', exact: true });
  await tabelle.getByRole('link', { name: STELLE, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/betreuung/${stelleId}$`));
  await expect(
    page.getByRole('heading', { level: 1, name: new RegExp(`Betreuungsstelle ${STELLE}`) }),
  ).toBeVisible();

  const band = page.getByRole('group', { name: 'Belegung in Zahlen' });
  await expect(band).toContainText('Belegt40');
  await expect(band).toContainText('Frei80');

  await page.getByRole('button', { name: 'Belegung melden', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Belegung melden: ${STELLE}` });
  await dialog.getByLabel('Belegt gesamt (Personen)').fill('115');
  await dialog.getByRole('button', { name: 'Melden', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(band).toContainText('Belegt115fast voll');
  await expect(band).toContainText('Frei5');
  // Ab der zweiten Meldung steht der Belegungsverlauf als Stufenlinie über der Liste (LLH-1347).
  const linie = page.locator('[data-lfh="stelle-belegungslinie"]');
  await expect(linie.getByRole('img')).toHaveAccessibleName(
    /^Belegung von 40 \(.+\) auf 115 \(.+\), 2 Meldungen, Kapazität 120$/,
  );
  await expect(linie.locator('circle')).toHaveCount(2);

  // Leitung und Kontakt (LLH-1134, vormals „Erreichbarkeit“): Bearbeiten am Paneel „Stelle“, Speichern in der Leiste.
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await page.getByLabel('Leitung').fill('Frau Schulz');
  await page.getByLabel('Kontakt', { exact: true }).fill('Kanal 3');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByLabel('Leitung')).toHaveCount(0);
  const raster = page.locator('dl[aria-label="Stammdaten der Stelle"]');
  await expect(raster).toContainText('Frau Schulz');
  await expect(raster).toContainText('Kanal 3');

  // Ein alter Link mit `?stelle=` landet ebenfalls hier.
  await page.goto(`/einsaetze/${einsatzId}/betreuung?stelle=${stelleId}`);
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/betreuung/${stelleId}$`));
  await expect(band).toContainText('Belegt115');
});

/**
 * Bedarf einer Stelle (LLH-1082): „Bedarf anfordern“ öffnet die Erfassung der Nachforderungen mit
 * Stellenbezug und vorbelegter Begründung; zurück auf der Stelle steht die Nachforderung im Paneel
 * „Bedarf“, und ihre Karte führt auf die Stelle.
 */
test('Detailseite → Bedarf anfordern → Nachforderung mit Stellenbezug steht im Paneel „Bedarf“', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const { einsatzId, stelleId } = await saeStelle(page);

  await page.goto(`/einsaetze/${einsatzId}/betreuung/${stelleId}`);
  const bedarf = page.getByRole('region', { name: 'Bedarf', exact: true });
  await expect(bedarf).toContainText('Kein offener Bedarf angefordert');
  await bedarf.getByRole('link', { name: /Bedarf anfordern/ }).click();

  await expect(page).toHaveURL(
    new RegExp(`/einsaetze/${einsatzId}/nachforderungen\\?stelle=${stelleId}$`),
  );
  await expect(page.locator('[data-lfh="nachforderung-bezug"]')).toContainText(
    `Für Betreuungsstelle ${STELLE}`,
  );
  await expect(page.getByLabel('Begründung / Lagebezug')).toHaveValue(
    `Für Betreuungsstelle ${STELLE}`,
  );
  await page.getByRole('combobox', { name: 'Was' }).fill('Feldbetten');
  await page.getByLabel('Anzahl', { exact: true }).fill('40');
  // Details stehen unter „Weitere Angaben“ (LLH-1089).
  await page.getByRole('button', { name: /^Weitere Angaben/ }).click();
  await page.getByLabel('Details / Zweck', { exact: true }).fill('Feldbetten für die Nacht');
  await page.getByRole('button', { name: 'Nachforderung absetzen', exact: true }).click();

  // Gefiltert auf die Stelle; die Karte nennt sie und führt zurück.
  const karte = page
    .locator('[data-nachforderung-id]')
    .filter({ hasText: 'Feldbetten für die Nacht' });
  await expect(karte).toContainText(`Für Betreuungsstelle ${STELLE}`);
  await expect(page.getByText('Gefiltert', { exact: true })).toBeVisible();
  await karte.getByRole('link', { name: new RegExp(STELLE) }).click();

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/betreuung/${stelleId}$`));
  await expect(bedarf.getByRole('link', { name: '40× Feldbetten', exact: true })).toBeVisible();
  await expect(bedarf).toContainText('Angefordert');
  await expect(bedarf).toContainText('1 offen');
});
