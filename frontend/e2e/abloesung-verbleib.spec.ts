import { expect, test, type Page } from '@playwright/test';
import { waehleIn } from './auswahl-kern';

/**
 * Ablösung, LLH-1308: „Danach“ im Vollzug-Dialog gegen den echten Server.
 *
 * Gesät werden „Florian 1“ (mit laufender Schicht) und „Florian 2“, beide per Nachtrag
 * eingetroffen, und der aktive Bereitstellungsraum „Schule“. Vollzogen wird über den Dialog mit
 * „Danach: Bereitstellungsraum «Schule»“; danach steht „Florian 1“ im Raum und die Karte unter
 * „Vergangen“ nennt den Verbleib. Die Rücknahme legt den Eintritt zurück.
 *
 * Geprüft wird, was jsdom nicht sieht: die Raumliste des Servers im Feld, der eine Vollzug mit
 * Belegung in einer Transaktion und die Rücknahme über die Karte.
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

/** Drahtformat des Servers: UTC ohne Zonenkennung. */
function draht(minutenVorher: number): string {
  return new Date(Date.now() - minutenVorher * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

test('Ablösung: Vollzug mit Verbleib im Bereitstellungsraum und Rücknahme', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmelden(page);

  const neu = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Verbleib ${Date.now()}` },
  });
  expect(neu.ok(), `Seeding Einsatz: ${neu.status()}`).toBeTruthy();
  const einsatzId = ((await neu.json()) as { id: number }).id;
  const basis = `/api/einsaetze/${einsatzId}`;
  const sende = async (methode: 'post' | 'put', pfad: string, data: unknown, was: string) => {
    const antwort = await page.request[methode](`${basis}/${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return (await antwort.json()) as { id: number };
  };
  await sende('put', 'abloesungen/schichtmodell', { schichtmodell: null }, 'keine Vorgabe');
  const f1 = await sende('post', 'einheiten', { name: 'Florian 1' }, 'Florian 1');
  const f2 = await sende('post', 'einheiten', { name: 'Florian 2' }, 'Florian 2');
  for (const e of [f1, f2]) {
    await sende(
      'post',
      `einheiten/${e.id}/zeitachse`,
      { art: 'eintreffen', zeitpunkt_at: draht(120) },
      'Eintreffen',
    );
  }
  await sende('post', 'abloesungen', { einheit_id: f1.id, rhythmus_minuten: 360 }, 'Schicht');
  const raum = await sende('post', 'bereitstellungsraeume', { bezeichnung: 'Schule' }, 'Raum');
  await sende('post', `bereitstellungsraeume/${raum.id}/status`, { status: 'aktiv' }, 'Raum aktiv');
  const raumVon = async (id: number) => {
    const antwort = await page.request.get(`${basis}/einheiten`);
    const liste = (await antwort.json()) as { id: number; aktueller_br_id?: number | null }[];
    return liste.find((e) => e.id === id)?.aktueller_br_id ?? null;
  };

  await page.goto(`/einsaetze/${einsatzId}/abloesung`);
  const karte = page.getByRole('article', { name: 'Schicht Florian 1' });
  await karte.getByRole('button', { name: 'Ablösung vollziehen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ablösung Florian 1 vollziehen' });
  // Die Planung ist leer: „Florian 2“ wählen, die Liste über den Titel schließen.
  await waehleIn(dialog.getByRole('combobox', { name: 'Ablösende Einheiten' }), 'Florian 2');
  await dialog.getByText('Ablösung Florian 1 vollziehen').click();
  await expect(dialog.getByTitle('In Ruhe')).toBeVisible();
  await waehleIn(dialog.getByRole('combobox', { name: 'Danach' }), 'Bereitstellungsraum «Schule»');
  await dialog.getByRole('button', { name: 'Vollziehen' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => raumVon(f1.id)).toBe(raum.id);

  await page.getByRole('radio', { name: 'Vergangen', exact: true }).click();
  const abgeloest = page.getByRole('article', { name: 'Schicht Florian 1' });
  await expect(abgeloest.locator('[data-lfh="abloesung-verbleib"]')).toHaveText(
    'danach Bereitstellungsraum Schule',
  );

  await abgeloest.getByRole('button', { name: 'Vollzug zurücknehmen' }).click();
  await expect.poll(() => raumVon(f1.id)).toBeNull();
  await page.getByRole('radio', { name: /^Laufend/ }).click();
  await expect(page.getByRole('article', { name: 'Schicht Florian 1' })).toBeVisible();
});
