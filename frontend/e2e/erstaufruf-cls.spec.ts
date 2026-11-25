import { expect, test, type Page } from '@playwright/test';
import { beobachteShifts, bericht, ruheShifts } from './cls-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Layoutsprung beim kalten Erstaufruf (LLH-1830, Regel: `frontend/AGENTS.md`, „Modulwechsel zeigt
 * sofort Kopf und Gerippe“, Erstaufruf). `rahmen-cls-dichte.spec.ts` misst dieselben Seiten mit
 * sofort antwortendem Server: dort steht der Seitenkopf, bevor der Browser das erste Bild
 * zeichnet. Im Einsatz antwortet der Server langsamer; dann stand bis LLH-1830 erst ein kurzes
 * Gerippe ohne Kopf da, und der Kopf schob beim Eintreffen des Einsatzes alles nach unten
 * (gemeldet: Meldebild 0,17, ETB 0,12, Betroffene 0,10).
 *
 * Nachgestellt wird das mit verzögerten Antworten: der Einsatz nach {@link EINSATZ_VERZUG} ms,
 * alle Daten darunter nach {@link DATEN_VERZUG} ms. Gemessen ohne anstehenden Alarm.
 */

const CLS_GUT = 0.1;
const FUEKW = { width: 1366, height: 768 };
const SCHMAL = { width: 1024, height: 768 };
const EINSATZ_VERZUG = 800;
const DATEN_VERZUG = 1200;

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return ((await r.json()) as { id: number }).id;
}

/** Ein Einsatz mit Inhalt, damit Tabelle, Zeitachse und Liste ihre echte Höhe haben. */
async function createEinsatzMitDaten(page: Page): Promise<number> {
  const id = await post(page, '/api/incidents', { bezeichnung: `E2E Erstaufruf ${Date.now()}` });
  for (const inhalt of ['Pegel steigt', 'Deich sichern', 'Sandsäcke angefordert']) {
    await post(page, `/api/incidents/${id}/etb`, {
      typ: 'meldung',
      inhalt,
      von: 'ELW 1',
      an: 'Leitstelle',
    });
  }
  await post(page, `/api/incidents/${id}/persons`, { name: 'Erstaufruf Eins' });
  await post(page, `/api/incidents/${id}/persons`, { name: 'Erstaufruf Zwei' });
  await post(page, `/api/incidents/${id}/personnel`, { adhoc: { name: 'Kraft Erstaufruf' } });
  return id;
}

/** Verzögert jede Antwort zum Einsatz; der Einsatz selbst kommt vor seinen Daten. */
async function verzoegere(page: Page, einsatzId: number) {
  await page.route(new RegExp(`/api/incidents/${einsatzId}(/.*)?(\\?.*)?$`), async (route) => {
    const nurEinsatz = new RegExp(`/api/incidents/${einsatzId}(\\?.*)?$`).test(
      route.request().url(),
    );
    await new Promise((r) => setTimeout(r, nurEinsatz ? EINSATZ_VERZUG : DATEN_VERZUG));
    await route.continue();
  });
}

async function measure(page: Page, pfad: string) {
  await page.goto(pfad);
  await expect(page.locator('[data-lfh="seitenkopf"]')).toBeVisible();
  await expect(page.locator('[data-testid="modul-gerippe"]')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('[data-lfh="seiten-inhalt"] [aria-busy="true"]')).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.locator('.ant-skeleton')).toHaveCount(0, { timeout: 15_000 });
  return ruheShifts(page);
}

test(`Erstaufruf mit langsamem Server, ${FUEKW.width}×${FUEKW.height}: CLS < ${CLS_GUT}`, async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmeldenAlsAdmin(page);
  const einsatzId = await createEinsatzMitDaten(page);
  await beobachteShifts(page);
  await verzoegere(page, einsatzId);

  const werte: string[] = [];
  for (const seite of ['kraefteuebersicht', 'etb', 'personen'] as const) {
    const m = await measure(page, `/einsaetze/${einsatzId}/${seite}`);
    werte.push(`${seite}: ${bericht(m)}`);
    expect.soft(m.summe, `${seite}: ${bericht(m)}`).toBeLessThan(CLS_GUT);
  }
  test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
});

/**
 * Die meistgenutzten weiteren Module (LLH-2005): sie gaben bis dahin im Frühausstieg ein nacktes
 * Gerippe zurück, und der Kopf kam erst mit dem Einsatz.
 */
const WEITERE_MODULE = [
  'einsatzdaten',
  'auftraege',
  'einheiten',
  'personal',
  'fahrzeuge',
  'lageberichte',
] as const;

for (const groesse of [FUEKW, SCHMAL]) {
  test(`Weitere Module beim Erstaufruf, ${groesse.width}×${groesse.height}: CLS < ${CLS_GUT}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(groesse);
    await anmeldenAlsAdmin(page);
    const einsatzId = await createEinsatzMitDaten(page);
    await beobachteShifts(page);
    await verzoegere(page, einsatzId);

    const werte: string[] = [];
    for (const seite of WEITERE_MODULE) {
      const m = await measure(page, `/einsaetze/${einsatzId}/${seite}`);
      werte.push(`${seite}: ${bericht(m)}`);
      expect.soft(m.summe, `${seite}: ${bericht(m)}`).toBeLessThan(CLS_GUT);
    }
    test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
  });
}

test(`Betroffene beim Erstaufruf, schmal ${SCHMAL.width}×${SCHMAL.height}: CLS < ${CLS_GUT}`, async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize(SCHMAL);
  await anmeldenAlsAdmin(page);
  const einsatzId = await createEinsatzMitDaten(page);
  await beobachteShifts(page);
  await verzoegere(page, einsatzId);

  const m = await measure(page, `/einsaetze/${einsatzId}/personen`);
  test.info().annotations.push({ type: 'messwert', description: bericht(m) });
  expect(m.summe, bericht(m)).toBeLessThan(CLS_GUT);
});
