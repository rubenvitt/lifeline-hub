import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, anmeldenAls, benutzerAnlegen, mitgliedEintragen } from './rollen-kern';

/*
 * LFH-767 — Gerätedaten beim Abmelden (Spec `geraetedaten-raeumung`).
 *
 * Ein ETB-Entwurf ist ungesendete Arbeit, die nur auf diesem Gerät liegt. Er gehört der Person,
 * die ihn schreibt: Abmelden und die Anmeldung eines anderen löschen ihn, ein Sitzungsablauf
 * nicht (design.md D3). Geprüft wird die Oberfläche UND die IndexedDB selbst.
 */

/** Steht ein Entwurf mit genau diesem Inhalt auf der Platte, gleich wessen? */
async function entwurfAufPlatte(page: Page, inhalt: string): Promise<boolean> {
  return page.evaluate(
    (gesucht) =>
      new Promise<boolean>((fertig) => {
        const anfrage = indexedDB.open('lifeline-etb-entwuerfe');
        // Gibt es die Datenbank noch nicht, legte `open` sie leer an: Anlegen abbrechen.
        anfrage.onupgradeneeded = () => anfrage.transaction?.abort();
        anfrage.onerror = () => fertig(false);
        anfrage.onsuccess = () => {
          const db = anfrage.result;
          const lesen = db.transaction('entwuerfe').objectStore('entwuerfe').getAll();
          lesen.onsuccess = () => {
            db.close();
            fertig((lesen.result as { inhalt: string }[]).some((e) => e.inhalt === gesucht));
          };
          lesen.onerror = () => {
            db.close();
            fertig(false);
          };
        };
      }),
    inhalt,
  );
}

/** Admin legt einen Einsatz und eine zweite Person (Führungspersonal) darin an. */
async function vorbereiten(page: Page) {
  await anmeldenAlsAdmin(page);
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Geräteräumung ${Date.now()}` },
  });
  expect(antwort.ok(), `Einsatz anlegen: ${antwort.status()}`).toBe(true);
  const einsatzId = String(((await antwort.json()) as { id: number }).id);
  const zweite = await benutzerAnlegen(page, 'fuehrungspersonal', 'E2E Zweite');
  await mitgliedEintragen(page, einsatzId, zweite.id, 'fuehrungspersonal');
  return { einsatzId, zweite };
}

/** Tippt einen Entwurf ins ETB und wartet, bis er auf der Platte liegt. */
async function entwurfSchreiben(page: Page, einsatzId: string, inhalt: string) {
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  const feld = page.getByPlaceholder('Inhalt …');
  await expect(feld).toBeVisible();
  await feld.fill(inhalt);
  await expect.poll(() => entwurfAufPlatte(page, inhalt), { timeout: 10_000 }).toBe(true);
}

async function etbFeld(page: Page, einsatzId: string) {
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  const feld = page.getByPlaceholder('Inhalt …');
  await expect(feld).toBeVisible();
  return feld;
}

test('Abmelden löscht den Entwurf; die nächste Person sieht ihn nicht', async ({ page }) => {
  const { einsatzId, zweite } = await vorbereiten(page);
  const inhalt = `Entwurf vor dem Abmelden ${Date.now()}`;
  await entwurfSchreiben(page, einsatzId, inhalt);

  await page.getByRole('button', { name: 'Benutzermenü' }).click();
  await page.getByRole('menuitem', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect.poll(() => entwurfAufPlatte(page, inhalt), { timeout: 10_000 }).toBe(false);

  await anmeldenAls(page, zweite.benutzername, zweite.passwort);
  await expect(await etbFeld(page, einsatzId)).toHaveValue('');
  await expect(page.getByText(inhalt)).toHaveCount(0);
});

test('Sitzungsablauf: dieselbe Person findet ihren Entwurf wieder', async ({ page, context }) => {
  const { einsatzId } = await vorbereiten(page);
  const inhalt = `Entwurf vor dem Ablauf ${Date.now()}`;
  await entwurfSchreiben(page, einsatzId, inhalt);

  // Die Sitzung endet an der App vorbei; das Neuladen trifft auf 401.
  await context.clearCookies();
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
  expect(await entwurfAufPlatte(page, inhalt)).toBe(true);

  await anmeldenAlsAdmin(page);
  await expect(await etbFeld(page, einsatzId)).toHaveValue(inhalt);
});

test('Sitzungsablauf, dann eine andere Person: sie sieht den Entwurf nicht, er ist von der Platte', async ({
  page,
  context,
}) => {
  const { einsatzId, zweite } = await vorbereiten(page);
  const inhalt = `Entwurf einer anderen Person ${Date.now()}`;
  await entwurfSchreiben(page, einsatzId, inhalt);

  await context.clearCookies();
  await page.reload();
  await expect(page).toHaveURL(/\/login/);

  await anmeldenAls(page, zweite.benutzername, zweite.passwort);
  await expect(await etbFeld(page, einsatzId)).toHaveValue('');
  await expect(page.getByText(inhalt)).toHaveCount(0);
  await expect.poll(() => entwurfAufPlatte(page, inhalt), { timeout: 10_000 }).toBe(false);
});
