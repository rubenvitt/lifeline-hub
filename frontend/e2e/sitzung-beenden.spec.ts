import { expect, test, type Browser, type Page } from '@playwright/test';
import { anmeldenAls, anmeldenAlsAdmin, benutzerAnlegen, mitgliedEintragen } from './rollen-kern';

/*
 * LFH-1092 — Sitzungen beenden ohne Deaktivieren.
 *
 * Ein verlorenes Gerät mit offener Einsatzseite und vorgehaltenem Lagebild: beendet jemand seine
 * Sitzung (die Person selbst im Profil oder ein Admin in der Benutzerverwaltung), schließt der
 * Server den Live-Strom, das Gerät fällt ohne jede Bedienung auf die Anmeldung und räumt sein
 * Lagebild. Geprüft wird die Oberfläche UND die IndexedDB selbst.
 *
 * Eigene Person statt `admin`: „alle anderen beenden“ träfe sonst die Sitzungen paralleler Specs.
 */

const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Version/18.0 Mobile/15E148 Safari/604.1';

/** Die ersten Elemente der Query-Keys im vorgehaltenen Lagebild (`null` = kein Datensatz). */
async function vorgehalteneKeys(page: Page): Promise<string[] | null> {
  return page.evaluate(
    () =>
      new Promise<string[] | null>((fertig) => {
        const anfrage = indexedDB.open('lifeline-lagebild');
        // Gibt es die Datenbank nicht (mehr), legte `open` sie leer an: Anlegen abbrechen.
        anfrage.onupgradeneeded = () => anfrage.transaction?.abort();
        anfrage.onerror = () => fertig(null);
        anfrage.onsuccess = () => {
          const db = anfrage.result;
          if (!db.objectStoreNames.contains('stand')) {
            db.close();
            fertig(null);
            return;
          }
          const lesen = db.transaction('stand').objectStore('stand').get('client');
          lesen.onsuccess = () => {
            const satz = lesen.result as
              { clientState: { queries: { queryKey: unknown[] }[] } } | undefined;
            db.close();
            fertig(satz ? satz.clientState.queries.map((q) => String(q.queryKey[0])) : null);
          };
          lesen.onerror = () => {
            db.close();
            fertig(null);
          };
        };
      }),
  );
}

/** Admin legt einen Einsatz und eine Person darin an. */
async function vorbereiten(page: Page) {
  await anmeldenAlsAdmin(page);
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Sitzung beenden ${Date.now()}` },
  });
  expect(antwort.ok(), `Einsatz anlegen: ${antwort.status()}`).toBe(true);
  const einsatzId = String(((await antwort.json()) as { id: number }).id);
  const person = await benutzerAnlegen(page, 'fuehrungspersonal', 'E2E Verlust');
  await mitgliedEintragen(page, einsatzId, person.id, 'fuehrungspersonal');
  return { einsatzId, person };
}

/** Das „verlorene“ Tablet: angemeldet, Einsatzseite offen, Lagebild auf der Platte. */
async function verlorenesGeraet(
  browser: Browser,
  einsatzId: string,
  person: { benutzername: string; passwort: string },
) {
  const kontext = await browser.newContext({ userAgent: IPAD });
  const geraet = await kontext.newPage();
  await anmeldenAls(geraet, person.benutzername, person.passwort);
  await geraet.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(geraet.getByPlaceholder('Inhalt …')).toBeVisible();
  // Vorbedingung: ohne vorgehaltenes Lagebild wäre „geräumt“ grün durch Konstruktion.
  await expect
    .poll(async () => (await vorgehalteneKeys(geraet))?.length ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(0);
  return { kontext, geraet };
}

/** Ohne Bedienung zurück auf der Anmeldung, das Lagebild von der Platte. */
async function geraeumt(geraet: Page) {
  await expect(geraet).toHaveURL(/\/login/, { timeout: 30_000 });
  await expect.poll(() => vorgehalteneKeys(geraet), { timeout: 10_000 }).toBeNull();
}

test('die Person beendet im Profil die Anmeldung des verlorenen Geräts', async ({
  page,
  browser,
}) => {
  const { einsatzId, person } = await vorbereiten(page);
  const { kontext, geraet } = await verlorenesGeraet(browser, einsatzId, person);

  await anmeldenAls(page, person.benutzername, person.passwort);
  await page.goto('/profil');
  const liste = page.locator('[data-lfh="sitzungsliste"]');
  await expect(liste.getByText('dieses Gerät')).toBeVisible();
  await liste.getByRole('button', { name: 'Anmeldung Safari · iPadOS beenden' }).click();
  await expect(liste.getByText('Safari · iPadOS')).toHaveCount(0);

  await geraeumt(geraet);
  // Das Konto bleibt: dieselbe Person meldet sich auf dem Gerät wieder an.
  await anmeldenAls(geraet, person.benutzername, person.passwort);
  await kontext.close();
});

test('ein Admin beendet die Anmeldung in der Benutzerverwaltung', async ({ page, browser }) => {
  const { einsatzId, person } = await vorbereiten(page);
  const { kontext, geraet } = await verlorenesGeraet(browser, einsatzId, person);

  await page.goto('/admin/benutzer');
  // Ab 50 Konten blättert die Tabelle; die Zeile steht erst nach der Suche sicher auf Seite 1.
  await page.getByPlaceholder('Name oder Benutzername').fill(person.benutzername);
  const zeile = page.getByRole('row').filter({ hasText: `@${person.benutzername}` });
  await zeile.getByRole('button', { name: 'Anmeldungen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Anmeldungen · E2E Verlust' });
  await dialog.getByRole('button', { name: 'Anmeldung Safari · iPadOS beenden' }).click();
  await expect(dialog.getByText('Keine Anmeldungen')).toBeVisible();

  await geraeumt(geraet);
  await kontext.close();
});
