import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';
import { waehleStehend } from './auswahl-kern';

/**
 * Eine Person einteilen (LLH-1060, Spec `personal-ansicht`), Durchstich im Browser: in der Zeile
 * der Personalliste Einheit und Fahrzeug setzen (wählen, dann „Speichern“), über den Namen die
 * Personenansicht öffnen, die Fahrzeugseite nennt die Besatzung, und das Meldebild zeigt die
 * Person unter dem Fahrzeug ihrer Einheit. Gewartet wird auf Inhaltsanker, nie auf
 * `networkidle` (LFH-385).
 */

const NAME = 'Einteilung, Emil';
const EINHEIT = 'Rettungsstaffel Nord';
const FAHRZEUG = 'Akkon Nord 83-1';

interface Saat {
  einsatzId: string;
  einheitId: number;
  fahrzeugId: number;
  epId: number;
}

async function seed(page: Page): Promise<Saat> {
  const post = async (pfad: string, data: unknown) => {
    const antwort = await page.request.post(pfad, { data });
    expect(antwort.ok(), `${pfad}: ${await antwort.text()}`).toBe(true);
    return ((await antwort.json()) as { id: number }).id;
  };
  const einsatzId = String(
    await post('/api/einsaetze', { bezeichnung: `E2E Einteilen ${Date.now()}` }),
  );
  const einheitId = await post(`/api/einsaetze/${einsatzId}/einheiten`, { name: EINHEIT });
  const fahrzeugId = await post(`/api/einsaetze/${einsatzId}/fahrzeuge`, {
    adhoc: { funkrufname: FAHRZEUG },
  });
  // Das Fahrzeug gehört der Einheit: dann steht die Person im Meldebild unter ihm.
  const fz = await page.request.put(
    `/api/einsaetze/${einsatzId}/einheiten/${einheitId}/fahrzeug/${fahrzeugId}`,
  );
  expect(fz.ok(), await fz.text()).toBe(true);
  const epId = await post(`/api/einsaetze/${einsatzId}/personal`, {
    adhoc: { name: NAME, funktion: 'Sanitäter' },
  });
  return { einsatzId, einheitId, fahrzeugId, epId };
}

test('Einheit und Fahrzeug in der Zeile setzen, Ansicht, Fahrzeugseite und Meldebild folgen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await anmeldenAlsAdmin(page);
  const s = await seed(page);

  await page.goto(`/einsaetze/${s.einsatzId}/personal`);
  const region = page.getByRole('region', { name: 'Personal im Einsatz', exact: true });
  const zeile = region.locator('tr.ant-table-row').filter({ hasText: NAME });
  await expect(region.getByText(/1 nicht eingeteilt/)).toBeVisible();

  // ── Einheit: wählen allein schreibt nicht, erst „Speichern“ ──
  await zeile.getByRole('button', { name: `Einheit zu ${NAME} eintragen` }).click();
  await zeile.getByRole('combobox', { name: `Einheit zu ${NAME}` }).click();
  await waehleStehend(page, EINHEIT);
  await zeile.getByRole('button', { name: `Einheit zu ${NAME} speichern` }).click();
  const einheitWert = zeile.getByRole('button', { name: `Einheit zu ${NAME} bearbeiten` });
  await expect(einheitWert).toHaveText(EINHEIT);

  // ── Fahrzeug: die Fahrzeuge der eigenen Einheit stehen vorn ──
  await zeile.getByRole('button', { name: `Fahrzeug zu ${NAME} eintragen` }).click();
  await zeile.getByRole('combobox', { name: `Fahrzeug zu ${NAME}` }).click();
  await waehleStehend(page, FAHRZEUG);
  await zeile.getByRole('button', { name: `Fahrzeug zu ${NAME} speichern` }).click();
  await expect(zeile.getByRole('button', { name: `Fahrzeug zu ${NAME} bearbeiten` })).toHaveText(
    FAHRZEUG,
  );
  // Eigenes Fahrzeug der Einheit: keine Marke „andere Einheit“.
  await expect(zeile.getByText('andere Einheit')).toHaveCount(0);

  // Fokus und Zeiger verlassen die Liste, dann wandert die Zeile in die Gruppe der Einheit.
  await page.mouse.move(0, 0);
  await page.getByRole('link', { name: 'Meldebild' }).focus();
  await expect(region.getByText(new RegExp(`1 ${EINHEIT}`))).toBeVisible();
  await expect(region.getByText(/nicht eingeteilt/)).toHaveCount(0);

  // ── Der Name öffnet die Personenansicht ──
  await region.getByRole('link', { name: NAME }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${s.einsatzId}/personal/${s.epId}$`));
  await expect(page.getByRole('heading', { name: new RegExp(NAME), level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Einheit bearbeiten' })).toHaveText(EINHEIT);
  await expect(page.getByRole('button', { name: 'Fahrzeug bearbeiten' })).toHaveText(FAHRZEUG);
  // Die Ansicht trägt keinen Aufklapper, die Zeitachse steht als Paneel.
  await expect(page.getByRole('heading', { name: 'Zeitachse', exact: true })).toBeVisible();

  // ── Die Fahrzeugseite nennt die Besatzung ──
  await page.goto(`/einsaetze/${s.einsatzId}/fahrzeuge`);
  const fahrzeuge = page.getByRole('region', { name: 'Fahrzeuge im Einsatz', exact: true });
  const fzZeile = fahrzeuge.locator('tr.ant-table-row').filter({ hasText: FAHRZEUG });
  await fzZeile.getByRole('button', { name: /^Details zu / }).click();
  await expect(fahrzeuge.getByText(NAME)).toBeVisible();

  // ── Das Meldebild zeigt die Person unter dem Fahrzeug (Stufe „mit Fahrzeugen“) ──
  await page.goto(`/einsaetze/${s.einsatzId}/kraefteuebersicht`);
  const meldebild = page.getByRole('region', { name: 'Meldebild' });
  await page.getByRole('radio', { name: 'mit Fahrzeugen', exact: true }).click();
  const fzKnoten = meldebild.locator(`tr[data-row-key="ef-${s.fahrzeugId}"]`);
  await expect(fzKnoten).toBeVisible();
  await fzKnoten.locator('.ant-table-row-expand-icon').click();
  const person = meldebild.locator(`tr[data-row-key="ep-${s.epId}"]`);
  await expect(person).toBeVisible();
  await expect(person).toContainText(NAME);
  // Die Person hängt unter dem Fahrzeug, nicht unter „Ohne Fahrzeug“.
  await expect(meldebild.locator('tr[data-row-key^="ofz-"]')).toHaveCount(0);
});
