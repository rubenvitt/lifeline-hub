import { expect, test, type Page } from '@playwright/test';

/**
 * LFH-705: Eine offline vorgemerkte Standmeldung von einem Gerät, dessen Uhr 5 min vorgeht,
 * wird nach kurzem Ausfall angenommen. Vorher trug sie den Erfassungszeitpunkt der Geräteuhr,
 * und der Server lehnte ihn als mehr als 60 s in der Zukunft mit 400 ab: Die Meldung lag im
 * Wiederherstellungs-Drawer statt im Bezirk. Jetzt rechnet das Frontend die Geräteuhr über den
 * `Date`-Header der echten API-Antworten auf die Serveruhr um
 * (`openspec/changes/archive/2026-10-01-lfh-705-serveruhr-versatz-offline/design.md`).
 *
 * Der Test braucht den echten Server, denn er belegt auch, dass dessen Antworten `Date` tragen.
 */

const VORLAUF_MS = 5 * 60_000;
const BEZIRK = 'Deichweg 1–9';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function senden<T = { id: number }>(page: Page, pfad: string, data: unknown): Promise<T> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `POST ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

interface Uebersicht {
  bezirke: { bezeichnung: string; stand: { evakuiert: number; zeitpunkt_at: string } | null }[];
}

test('vorgemerkte Standmeldung eines vorgehenden Geräts wird nach kurzem Ausfall angenommen', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Die Geräteuhr geht 5 min vor und läuft von da an normal weiter. Vor der ersten Navigation
  // installiert, damit jede Zeitnahme der Seite sie sieht.
  await page.clock.install({ time: new Date(Date.now() + VORLAUF_MS) });
  await anmelden(page);

  const { id: einsatzId } = await senden(page, '/api/einsaetze', {
    bezeichnung: `E2E Uhrversatz ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}/betreuung`;
  await senden(page, `${basis}/bezirke`, {
    bezeichnung: BEZIRK,
    plan_personen: 640,
    plan_erhebung: 'geschaetzt',
  });

  // Vorbedingung: Die Geräteuhr geht wirklich vor.
  const geraetVorlauf = (await page.evaluate(() => Date.now())) - Date.now();
  expect(geraetVorlauf).toBeGreaterThan(VORLAUF_MS - 30_000);

  // Die Seite lädt online und misst dabei die Serveruhr an den echten Antworten.
  await page.goto(`/einsaetze/${einsatzId}/betreuung`);
  const melden = page.getByRole('button', { name: `Stand melden für Bezirk ${BEZIRK}` });
  await expect(melden).toBeVisible();

  await page.context().setOffline(true);
  await melden.click();
  const dialog = page.getByRole('dialog', { name: `Stand melden: ${BEZIRK}` });
  await dialog.getByLabel('Evakuiert (Personen)').fill('200');
  await dialog.getByRole('button', { name: 'Melden' }).click();
  await expect(page.getByText(`Offline vorgemerkt — Standmeldung ${BEZIRK}`)).toBeVisible();
  const erfasstMs = Date.now();

  // Ein kurzer Ausfall: kürzer als der Vorlauf, sonst ließe auch die Geräteuhr den Zeitpunkt
  // in die Vergangenheit rutschen, und der Test belegte nichts.
  await page.waitForTimeout(3_000);
  await page.context().setOffline(false);

  // Angenommen: Der Stand steht am Bezirk. Eine abgelehnte Meldung käme nie hier an.
  await expect
    .poll(
      async () => {
        const r = await page.request.get(basis);
        const u = (await r.json()) as Uebersicht;
        return u.bezirke.find((b) => b.bezeichnung === BEZIRK)?.stand?.evakuiert ?? null;
      },
      { timeout: 30_000 },
    )
    .toBe(200);

  // Nichts liegt als abgelehnt im Wiederherstellungs-Drawer.
  const abgelehnt = await page.evaluate(
    () =>
      new Promise<number>((fertig, fehler) => {
        const r = indexedDB.open('lifeline-offline');
        r.onerror = () => fehler(r.error);
        r.onsuccess = () => {
          const zaehlen = r.result
            .transaction('schreibaktionenAbgelehnt')
            .objectStore('schreibaktionenAbgelehnt')
            .count();
          zaehlen.onsuccess = () => fertig(zaehlen.result);
          zaehlen.onerror = () => fehler(zaehlen.error);
        };
      }),
  );
  expect(abgelehnt).toBe(0);

  // Und mit dem Erfassungszeitpunkt nach der Serveruhr, nicht nach der Geräteuhr.
  const u = (await (await page.request.get(basis)).json()) as Uebersicht;
  const zeitpunkt = Date.parse(
    `${u.bezirke.find((b) => b.bezeichnung === BEZIRK)!.stand!.zeitpunkt_at.replace(' ', 'T')}Z`,
  );
  expect(Math.abs(zeitpunkt - erfasstMs)).toBeLessThan(60_000);
});
