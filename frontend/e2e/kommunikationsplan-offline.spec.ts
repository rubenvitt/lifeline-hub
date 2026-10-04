import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Kommunikationsplan ohne Netz (LFH-848, design.md D9): der Weg des Feldes — Plan mit Netz
// öffnen, Netz weg, NEU LADEN. Wie `lagebild-offline.spec.ts` gegen den Prod-Bundle, den das
// e2e-Backend ausliefert (die Shell kommt offline nur aus dem Precache).
//
// DIE VORBEDINGUNGEN SIND TEIL DER AUSSAGE:
//  - Der Plan liegt in der IndexedDB, BEVOR das Netz weggeht (gelesen, nicht erwartet).
//  - `/api/health` scheitert offline; sonst zeigte die Seite schlicht frisch geladene Daten.
// Danach: die Nummer steht, die Besetzung sagt „nicht geladen“ (der Rest des Stabs bleibt von
// der Platte fern), und „Stelle hinzufügen“ ist gesperrt, nicht versteckt.
//
// Mutationsprobe (Prüfliste): ohne den Unter-Key in `LAGEBILD_OFFLINE.einsatzUnterKeys` wird
// die Vorbedingung rot.

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const NUMMER = '0421 112 77';

const distPfad = fileURLToPath(new URL('../dist', import.meta.url));
const bundleFehlt = !existsSync(`${distPfad}/sw.js`);
const lauf = process.env.LIFELINE_E2E_LAUF;
const backendUrl = lauf
  ? `http://127.0.0.1:${(JSON.parse(lauf) as { backendPort: number }).backendPort}`
  : '';

test.use({ baseURL: backendUrl || undefined });

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Service Worker aktiv UND zuständig — Muster und Begründung: `lagebild-offline.spec.ts`. */
async function serviceWorkerZustaendig(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          if (!reg) return 'keine Registrierung';
          if (reg.active?.state !== 'activated') return `Zustand ${reg.active?.state ?? 'ohne'}`;
          return navigator.serviceWorker.controller ? 'aktiv und zuständig' : 'nicht zuständig';
        }),
      { timeout: 30_000, message: 'Service Worker wird nie aktiv/zuständig' },
    )
    .toBe('aktiv und zuständig');
}

/** Die Query-Keys im vorgehaltenen Stand, als `/`-verbundene Zeichenketten. */
async function vorgehalteneKeys(page: Page): Promise<string[]> {
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
            const satz = lesen.result as
              { client: { clientState: { queries: { queryKey: unknown[] }[] } } } | undefined;
            db.close();
            fertig(satz ? satz.client.clientState.queries.map((q) => q.queryKey.join('/')) : []);
          };
          lesen.onerror = () => {
            db.close();
            fertig([]);
          };
        };
      }),
  );
}

test.describe('Kommunikationsplan ohne Netz (LFH-848)', () => {
  test.skip(bundleFehlt, 'Prod-Bundle fehlt (frontend/dist/sw.js) — vorher `pnpm build`');
  test.skip(!lauf, 'LIFELINE_E2E_LAUF fehlt — Backend-Port unbekannt');

  test('nach dem Neuladen ohne Netz steht der Plan, die Bedienung ist gesperrt', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await anmelden(page);
    await serviceWorkerZustaendig(page);
    const einsatz = await page.request.post('/api/einsaetze', {
      data: { bezeichnung: `E2E Kommunikationsplan offline ${Date.now()}` },
    });
    expect(einsatz.ok(), await einsatz.text()).toBeTruthy();
    const einsatzId = ((await einsatz.json()) as { id: number }).id;
    const basis = `/api/einsaetze/${einsatzId}/stab/kommunikationsplan`;
    await page.request.post(`${basis}/stellen`, {
      data: { stellenart: 'funktion', funktion: 's2' },
    });
    const plan = await page.request.post(`${basis}/stellen`, {
      data: { stellenart: 'leitstelle', bezeichnung: 'ILS Nord' },
    });
    expect(plan.ok(), await plan.text()).toBeTruthy();
    const ils = ((await plan.json()) as { id: number; bezeichnung?: string }[]).find(
      (s) => s.bezeichnung === 'ILS Nord',
    )!;
    const v = await page.request.post(`${basis}/stellen/${ils.id}/verbindungen`, {
      data: { mittel: 'festnetz', wert: NUMMER },
    });
    expect(v.ok(), await v.text()).toBeTruthy();

    const pfad = `/einsaetze/${einsatzId}/stab/kommunikationsplan`;
    await page.goto(pfad);
    const tabelle = page.getByRole('region', { name: 'Kommunikationsplan' });
    await expect(tabelle.getByRole('link', { name: NUMMER })).toBeVisible();

    // (1) Vorbedingung: der Plan liegt auf der Platte, der übrige Stab nicht.
    const planKey = `einsatz-stab/${einsatzId}/kommunikationsplan`;
    await expect.poll(() => vorgehalteneKeys(page), { timeout: 20_000 }).toContain(planKey);
    expect((await vorgehalteneKeys(page)).filter((k) => k.startsWith('einsatz-stab/'))).toEqual([
      planKey,
    ]);

    // (2) Netz weg — und nachweislich weg.
    await page.context().setOffline(true);
    expect(
      await page.evaluate(() =>
        fetch('/api/health', { cache: 'no-store' }).then(
          (a) => `beantwortet ${a.status}`,
          () => 'scheitert',
        ),
      ),
    ).toBe('scheitert');

    // (3) Neu laden: Plan da, Besetzung „nicht geladen“, Bedienung gesperrt.
    await page.goto(pfad);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(tabelle.getByRole('link', { name: NUMMER })).toBeVisible();
    await expect(tabelle.getByText('Besetzung nicht geladen')).toBeVisible();
    await expect(page.getByText(/^Stand \d\d:\d\d · offline$/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stelle hinzufügen' })).toBeDisabled();
    await expect(
      tabelle.getByRole('button', { name: 'Verbindung zu ILS Nord hinzufügen' }),
    ).toBeDisabled();
    await page.context().setOffline(false);
  });
});
