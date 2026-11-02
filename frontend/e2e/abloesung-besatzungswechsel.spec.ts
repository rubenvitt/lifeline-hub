import { expect, test, type Page } from '@playwright/test';
import { waehleIn } from './auswahl-kern';

/**
 * Ablösung, LLH-1319: Besatzungswechsel vorab planen, beim Vollzug verteilen, Folgeschicht
 * kennzeichnen — gegen den echten Server.
 *
 * Gesät werden „Florian 1“ (mit laufender Schicht, darin „Anna Alt“) mit der Untereinheit
 * „Gruppe 1“ und deren Fahrzeug „Florian 1-44“, dazu „Cora Neu“ und „Dirk Neu“ ohne Einheit.
 * Geplant wird über „Ablösung planen“: „Cora Neu“ nach „Gruppe 1“ auf „Florian 1-44“, „Dirk Neu“
 * ohne Angabe. Der Vollzug-Dialog ist damit vorbelegt; die Verteilung liegt eingeklappt
 * (Feldbudget mit Gegenprobe). Nach dem Vollzug steht „Cora Neu“ in „Gruppe 1“ auf dem Fahrzeug,
 * die Folgeschicht nennt die neue Besatzung; die Rücknahme legt sie zurück und die Planung gilt
 * wieder.
 *
 * Geprüft wird, was jsdom nicht sieht: die Listen des Servers in den Feldern, die Prüfung der
 * Ziele beim Planen und Vollziehen und die Rücknahme über die Karte.
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

interface Person {
  id: number;
  einheit_id?: number | null;
  fahrzeug_id?: number | null;
}

test('Ablösung: Besatzungswechsel planen, verteilt vollziehen und zurücknehmen', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmelden(page);

  const neu = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Besatzungswechsel ${Date.now()}` },
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
    // Die Zuordnungen (PUT) antworten ohne Körper.
    const text = await antwort.text();
    return (text ? JSON.parse(text) : {}) as { id: number };
  };
  await sende('put', 'abloesungen/schichtmodell', { schichtmodell: null }, 'keine Vorgabe');
  const f1 = await sende('post', 'einheiten', { name: 'Florian 1' }, 'Florian 1');
  const g1 = await sende(
    'post',
    'einheiten',
    { name: 'Gruppe 1', ueber_einheit_id: f1.id },
    'Gruppe 1',
  );
  await sende(
    'post',
    `einheiten/${f1.id}/zeitachse`,
    { art: 'eintreffen', zeitpunkt_at: draht(120) },
    'Eintreffen',
  );
  const fz = await sende('post', 'fahrzeuge', { adhoc: { funkrufname: 'Florian 1-44' } }, 'Fz');
  await sende('put', `einheiten/${g1.id}/fahrzeug/${fz.id}`, {}, 'Fahrzeug an Gruppe 1');
  const anna = await sende('post', 'personal', { adhoc: { name: 'Anna Alt' } }, 'Anna');
  await sende('put', `einheiten/${f1.id}/personal/${anna.id}`, {}, 'Anna an Florian 1');
  const cora = await sende('post', 'personal', { adhoc: { name: 'Cora Neu' } }, 'Cora');
  await sende('post', 'personal', { adhoc: { name: 'Dirk Neu' } }, 'Dirk');
  await sende('post', 'abloesungen', { einheit_id: f1.id, rhythmus_minuten: 360 }, 'Schicht');
  const person = async (id: number) => {
    const antwort = await page.request.get(`${basis}/personal`);
    return ((await antwort.json()) as Person[]).find((p) => p.id === id);
  };

  await page.goto(`/einsaetze/${einsatzId}/abloesung`);
  const karte = page.getByRole('article', { name: 'Schicht Florian 1' });

  // ── Planen ─────────────────────────────────────────────────────────────────────────────
  await karte.getByRole('button', { name: 'Aktionen zu Florian 1' }).click();
  await page.getByRole('menuitem', { name: 'Ablösung planen' }).click();
  const planen = page.getByRole('dialog', { name: 'Ablösung Florian 1 planen' });
  await planen.getByText('Besatzungswechsel', { exact: true }).click();
  await expect(planen.locator('[data-lfh="vollzug-bisherige-besatzung"]')).toHaveText(
    'Bisherige Besatzung: Anna Alt',
  );
  await waehleIn(planen.getByRole('combobox', { name: 'Neue Besatzung' }), 'Cora Neu');
  await waehleIn(planen.getByRole('combobox', { name: 'Neue Besatzung' }), 'Dirk Neu');
  await planen.getByText('Ablösung Florian 1 planen').click();
  const kopf = planen.locator('[data-lfh="besatzung-verteilen"] .ant-collapse-header');
  await expect(kopf).toHaveText('Verteilen · alle in Florian 1');
  await kopf.click();
  await waehleIn(planen.getByRole('combobox', { name: 'Einheit für Cora Neu' }), 'Gruppe 1');
  await waehleIn(planen.getByRole('combobox', { name: 'Fahrzeug für Cora Neu' }), 'Florian 1-44');
  await expect(kopf).toHaveText('Verteilen · 1 verteilt');
  await planen.getByRole('button', { name: 'Speichern' }).click();
  await expect(planen).toBeHidden();
  const planZeile = karte.locator('[data-lfh="abloesung-besatzung-plan"]');
  await expect(planZeile).toHaveText('Besatzungswechsel geplant · neu: Cora Neu, Dirk Neu');
  await expect(planZeile).toHaveAttribute(
    'title',
    'Besatzungswechsel geplant · neu: Cora Neu (Gruppe 1, Florian 1-44), Dirk Neu',
  );

  // ── Vollziehen: vorbelegt, Verteilung eingeklappt ──────────────────────────────────────
  await karte.getByRole('button', { name: 'Ablösung vollziehen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ablösung Florian 1 vollziehen' });
  await expect(dialog.getByRole('radio', { name: 'Besatzungswechsel' })).toBeChecked();
  const vollzugKopf = dialog.locator('[data-lfh="besatzung-verteilen"] .ant-collapse-header');
  await expect(vollzugKopf).toHaveText('Verteilen · 1 verteilt');
  // Feldbudget: Art, Neue Besatzung, Zeitpunkt; aufgeklappt kommen die Zeilen dazu.
  const felder = dialog.locator('.ant-form-item-label label:visible');
  await expect(felder).toHaveText(['Art', 'Neue Besatzung', 'Zeitpunkt']);
  await vollzugKopf.click();
  await expect(felder).toHaveText(['Art', 'Neue Besatzung', 'Cora Neu', 'Dirk Neu', 'Zeitpunkt']);
  await dialog.getByRole('button', { name: 'Vollziehen' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await person(cora.id))?.einheit_id).toBe(g1.id);
  expect((await person(cora.id))?.fahrzeug_id).toBe(fz.id);
  await expect(
    page
      .getByRole('article', { name: 'Schicht Florian 1' })
      .locator('[data-lfh="abloesung-nach-besatzungswechsel"]'),
  ).toHaveText('nach Besatzungswechsel · Besatzung: Cora Neu, Dirk Neu');

  // ── Rücknahme: zurückgelegt, die Planung gilt wieder ───────────────────────────────────
  await page.getByRole('radio', { name: 'Vergangen', exact: true }).click();
  const abgeloest = page.getByRole('article', { name: 'Schicht Florian 1' });
  await abgeloest.getByRole('button', { name: 'Vollzug zurücknehmen' }).click();
  await expect.poll(async () => (await person(cora.id))?.einheit_id ?? null).toBeNull();
  expect((await person(cora.id))?.fahrzeug_id ?? null).toBeNull();
  await page.getByRole('radio', { name: /^Laufend/ }).click();
  await expect(
    page
      .getByRole('article', { name: 'Schicht Florian 1' })
      .locator('[data-lfh="abloesung-besatzung-plan"]'),
  ).toHaveText('Besatzungswechsel geplant · neu: Cora Neu, Dirk Neu');
});
