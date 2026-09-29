import { expect, test, type Page } from '@playwright/test';

/**
 * Ein vorgehaltener Stand darf online keine Entscheidung treffen (LFH-723, design.md D2).
 *
 * GEMESSEN in der CI (PR #175): nach einem Neuladen legte die Wiederherstellung den älteren
 * ETB-Stand in den Speicher. Die Deeplink-Logik (`?eintrag=`) las „Daten da, `isLoading` false"
 * als „geladen", fand den neuen Eintrag nicht und räumte den Parameter, bevor die frische Liste
 * eintraf — keine Hervorhebung. Lokal blieb das grün, weil das Backend schneller antwortete als
 * die IndexedDB. Hier wird der Fall erzwungen: der Eintrag entsteht AM vorgehaltenen Stand vorbei
 * (per API, nach dessen Speicherung), und die Antwort der ETB-Liste kommt 1,5 s verspätet.
 *
 * Seit D2 hydriert eine serverbestätigte Sitzung nichts: die Seite wartet wie vor LFH-723 auf den
 * Server. Mutationsprobe: mit dem Hydrieren im `ok`-Pfad wird dieser Test rot.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

/** Die `lfd_nr`-freien Inhalte der ETB-Liste im vorgehaltenen Stand (leer = keiner). */
async function vorgehalteneEtbInhalte(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((fertig) => {
        const anfrage = indexedDB.open('lifeline-lagebild');
        anfrage.onerror = () => fertig([]);
        anfrage.onsuccess = () => {
          const db = anfrage.result;
          if (!db.objectStoreNames.contains('stand')) {
            db.close();
            fertig([]);
            return;
          }
          const lesen = db.transaction('stand').objectStore('stand').get('aktuell');
          lesen.onsuccess = () => {
            db.close();
            const satz = lesen.result as
              | {
                  client: {
                    clientState: {
                      queries: {
                        queryKey: unknown[];
                        state: { data?: { pages?: { inhalt: string }[][] } };
                      }[];
                    };
                  };
                }
              | undefined;
            const liste = satz?.client.clientState.queries.find(
              (q) => q.queryKey[0] === 'etb' && typeof q.queryKey[2] === 'object',
            );
            fertig((liste?.state.data?.pages ?? []).flat().map((e) => e.inhalt));
          };
          lesen.onerror = () => {
            db.close();
            fertig([]);
          };
        };
      }),
  );
}

test('ETB-Deeplink nach dem Neuladen: der vorgehaltene Stand entscheidet nichts', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await anmelden(page);
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Vorhalt Deeplink ${Date.now()}`,
  });
  await post(page, `/api/einsaetze/${einsatzId}/etb`, {
    typ: 'meldung',
    inhalt: 'Vorhalt alter Eintrag',
    von: 'ELW 1',
    an: 'Leitstelle',
  });
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByText('Vorhalt alter Eintrag')).toBeVisible();
  // Vorbedingung: der Stand OHNE den neuen Eintrag liegt auf der Platte.
  await expect
    .poll(() => vorgehalteneEtbInhalte(page), { timeout: 20_000 })
    .toContain('Vorhalt alter Eintrag');

  // Am vorgehaltenen Stand vorbei: der neue Eintrag entsteht per API.
  const neu = await post(page, `/api/einsaetze/${einsatzId}/etb`, {
    typ: 'meldung',
    inhalt: 'Vorhalt neuer Eintrag',
    von: 'ELW 1',
    an: 'Leitstelle',
  });
  expect(await vorgehalteneEtbInhalte(page)).not.toContain('Vorhalt neuer Eintrag');

  await page.route(/\/api\/einsaetze\/\d+\/etb(\?|$)/, async (anfrage) => {
    await new Promise((fertig) => setTimeout(fertig, 1500));
    await anfrage.continue().catch(() => {});
  });
  await page.goto(`/einsaetze/${einsatzId}/etb?eintrag=${neu}`);
  const ziel = page.locator(`[data-testid="etb-ereigniszeile"][data-zeile="eintrag-${neu}"]`);
  await expect(ziel).toHaveClass(/zeile-hervorgehoben/, { timeout: 20_000 });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
