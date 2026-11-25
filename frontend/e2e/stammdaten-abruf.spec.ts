import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { dialogSteht } from './dialog-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Stammdaten-Abruf (LLH-1194): ein offener Schnappschuss steht als Hinweis über dem Personal;
 * „Prüfen“ öffnet den Dialog des Stammdaten-Eingangs gleich mit der Vorschau, „Übernehmen“ legt
 * die Personen an, danach ist der Hinweis weg. Ablauf über zwei Seiten (Personal, Adapter).
 *
 * DIREKTER DATENBANKGRIFF: einen Schnappschuss legt nur der Lauf eines Adapters ab, und der ruft
 * nur über https und nie über Loopback ab (Zielschutz, `src/adapter/ziel.rs`). Den Adapter legt
 * der Test über die API an und hält ihn an; den Schnappschuss setzt er per `node:sqlite` in die
 * Lauf-Datenbank (`LIFELINE_E2E_LAUF`), wie `e2e/aufbewahrung.spec.ts`. Vorschau und Übernehmen
 * laufen über die echten Routen.
 */

function datenbank(): string {
  const lauf = process.env.LIFELINE_E2E_LAUF;
  if (!lauf) throw new Error('LIFELINE_E2E_LAUF fehlt — läuft der Test außerhalb der Suite?');
  return (JSON.parse(lauf) as { datenbank: string }).datenbank;
}

/** Offener Schnappschuss des Adapters mit `personal` im Vertrag „Stammdaten-Abruf“. */
function schnappschussAblegen(adapterId: string, personal: { kennung: string; name: string }[]) {
  const db = new DatabaseSync(datenbank());
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const inhalt = JSON.stringify({ personal, fahrzeuge: [], qualifikationen: [] });
    const anzahl = JSON.stringify({ fahrzeuge: 0, personal: personal.length, qualifikationen: 0 });
    const jetzt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.prepare(
      `INSERT INTO stammdaten_schnappschuss
         (id, org_id, adapter_id, status, fingerabdruck, inhalt, anzahl, abgerufen_at)
       SELECT ?, org_id, id, 'offen', ?, ?, ?, ? FROM adapter WHERE id = ?`,
    ).run(randomUUID(), `e2e-${randomUUID()}`, inhalt, anzahl, jetzt, adapterId);
  } finally {
    db.close();
  }
}

test('Hinweis, Prüfen, Übernehmen: abgerufene Personen kommen ins Personal', async ({ page }) => {
  await anmeldenAlsAdmin(page, { startseite: false });
  const lauf = Date.now();
  const herkunft = `Helferverwaltung ${lauf}`;
  const angelegt = await page.request.post('/api/admin/adapter', {
    data: {
      art: 'stammdaten_abruf',
      name: `Personal-Abruf ${lauf}`,
      einstellungen: { adresse: 'https://helfer.example/api/stammdaten', herkunft },
    },
  });
  expect(angelegt.ok(), `Adapter: ${angelegt.status()} ${await angelegt.text()}`).toBe(true);
  const adapterId = ((await angelegt.json()) as { id: string }).id;
  // Angehalten ruft der Lauf im Hintergrund nicht ab; der Schnappschuss bleibt der gesetzte.
  const angehalten = await page.request.post(`/api/admin/adapter/${adapterId}/pause`);
  expect(angehalten.ok()).toBe(true);

  const personen = [
    { kennung: `e2e-${lauf}-1`, name: `Abruf ${lauf}, Jana` },
    { kennung: `e2e-${lauf}-2`, name: `Abruf ${lauf}, Tom` },
  ];
  schnappschussAblegen(adapterId, personen);

  // Derselbe Hinweis steht in der Ansicht des Adapters, dort mit „Erneut vorlegen“.
  await page.goto(`/admin/einstellungen/anbindungen/adapter/${adapterId}`);
  const amAdapter = page.locator('[data-lfh="schnappschuss-hinweis"]', { hasText: herkunft });
  await expect(amAdapter).toContainText(`Neue Personaldaten aus ${herkunft} vom`);
  await expect(page.getByRole('button', { name: 'Erneut vorlegen' })).toBeEnabled();

  await page.goto('/admin/stammdaten/personal');
  const hinweis = page.locator('[data-lfh="schnappschuss-hinweis"]', { hasText: herkunft });
  await expect(hinweis).toContainText('zum Prüfen');
  await hinweis.getByRole('button', { name: 'Prüfen' }).click();

  const dialog = await dialogSteht(page, 'Abgerufene Stammdaten prüfen');
  await expect(dialog.getByText(personen[0].name)).toBeVisible();
  await expect(dialog.locator('input[type="file"]')).toHaveCount(0);
  const uebernehmen = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      /\/api\/master-data\/import\/snapshots\/[^/]+$/.test(r.url()),
  );
  await dialog.getByRole('button', { name: 'Übernehmen' }).click();
  expect((await uebernehmen).status()).toBe(200);
  await expect(dialog.locator('[data-lfh="einlesen-ergebnis"]')).toContainText('2 Personen neu');

  // Der Hinweis ist weg, schon bevor der Dialog schließt; die Personen stehen in der Liste.
  await expect(hinweis).toHaveCount(0);
  // Der Knopf im Fuß, nicht das Kreuz oben (beide heißen „Schließen“).
  await dialog.locator('button', { hasText: 'Schließen' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: personen[1].name })).toBeVisible();

  // Nach dem Neuladen bleibt er weg: der Schnappschuss ist übernommen.
  await page.reload();
  await expect(page.getByRole('link', { name: personen[0].name })).toBeVisible();
  await expect(hinweis).toHaveCount(0);
});
