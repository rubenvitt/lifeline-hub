import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Das Seitenfenster der ETB-Zeitachse als Layout-Gate (LFH-947, Spec `etb-zeitachse-fenster`).
 *
 * Ein Deeplink auf einen Eintrag sechs Seiten tief lädt bis zum Ziel nach; das Fenster hält
 * höchstens fünf Seiten, der Kopf fällt also heraus. Gemessen wird: das Ziel steht im Bild und
 * ist hervorgehoben, und „Neuere laden“ über der Zeitachse ist erreichbar und führt zum Kopf
 * zurück. Als Admin und als Beobachter (`e2e/AGENTS.md`, LFH-435): beim Beobachter fehlt die
 * Erfassungsleiste, die Zeitachse reicht bis an den Fuß.
 */

test.setTimeout(240_000);

/** Sechs volle Seiten zu 100 und ein Rest: Nr. 5 liegt in der sechsten Seite. */
const ANZAHL = 520;
const ZIEL_NR = 5;

const BREITEN = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
  { width: 1440, height: 900 },
];

async function saeen(page: Page): Promise<{ einsatzId: string; zielId: number; kopfId: number }> {
  const neu = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Seitenfenster ${Date.now()}` },
  });
  expect(neu.ok(), `Einsatz: ${neu.status()}`).toBe(true);
  const einsatzId = String(((await neu.json()) as { id: number }).id);
  let zielId = 0;
  let kopfId = 0;
  // In Blöcken parallel: die laufende Nummer vergibt der Server in seiner Transaktion, der Text
  // folgt ihr deshalb nicht. Ziel und Kopf werden über die Kennung gefunden.
  for (let start = 1; start <= ANZAHL; start += 20) {
    const block = Array.from({ length: Math.min(20, ANZAHL - start + 1) }, (_, i) => start + i);
    const antworten = await Promise.all(
      block.map((n) =>
        page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
          data: { typ: 'meldung', inhalt: `Seitenfenster ${n}`, von: 'ELW 1', an: 'Leitstelle' },
        }),
      ),
    );
    for (const a of antworten) {
      expect(a.ok(), `Seeding: ${a.status()} ${await a.text()}`).toBe(true);
      const { id, lfd_nr } = (await a.json()) as { id: number; lfd_nr: number };
      if (lfd_nr === ZIEL_NR) zielId = id;
      if (lfd_nr === ANZAHL) kopfId = id;
    }
  }
  expect(zielId, 'Zieleintrag gesät').toBeGreaterThan(0);
  expect(kopfId, 'Kopf gesät').toBeGreaterThan(0);
  return { einsatzId, zielId, kopfId };
}

async function misst(
  page: Page,
  { einsatzId, zielId, kopfId }: { einsatzId: string; zielId: number; kopfId: number },
  rolle: string,
) {
  const kopf = page.locator(`[data-zeile="eintrag-${kopfId}"]`);
  for (const breite of BREITEN) {
    await page.setViewportSize(breite);
    await page.goto(`/einsaetze/${einsatzId}/etb?eintrag=${zielId}`);
    const ziel = page.locator(`[data-zeile="eintrag-${zielId}"]`);
    await expect(ziel, `${rolle} ${breite.width}: Ziel hervorgehoben`).toHaveClass(
      /zeile-hervorgehoben/,
      { timeout: 60_000 },
    );
    await expect(ziel).toContainText(`Nr. ${ZIEL_NR}`);
    // Im Bild, nicht nur im DOM: die Oberkante liegt im Fenster.
    await expect
      .poll(
        async () => {
          const box = await ziel.boundingBox();
          return box != null && box.y >= 0 && box.y < breite.height;
        },
        { message: `${rolle} ${breite.width}: Ziel im Bild` },
      )
      .toBe(true);
    // Der Kopf ist aus dem Fenster gefallen.
    await expect(kopf).toHaveCount(0);

    const neuere = page.getByRole('button', { name: 'Neuere laden', exact: true });
    await neuere.scrollIntoViewIfNeeded();
    // Klicken statt `toBeVisible` (LFH-355): eine Überdeckung fiele hier auf.
    await neuere.click();
    await expect(kopf).toHaveCount(1, { timeout: 30_000 });
  }
}

test('Deeplink tief ins Tagebuch: Ziel im Bild, „Neuere laden“ führt zum Kopf (Admin)', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const gesaet = await saeen(page);
  await misst(page, gesaet, 'admin');
});

test('Deeplink tief ins Tagebuch: Ziel im Bild, „Neuere laden“ führt zum Kopf (Beobachter)', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const gesaet = await saeen(page);
  await wechsleZuRolle(page, 'beobachter', gesaet.einsatzId);
  await page.goto(`/einsaetze/${gesaet.einsatzId}/etb`);
  await expect(page.locator(`[data-zeile="eintrag-${gesaet.kopfId}"]`)).toHaveCount(1);
  // Vorbedingung des Rollenzweigs: ohne Schreibrecht keine Erfassung.
  await expect(page.getByRole('button', { name: 'Erfassen', exact: true })).toHaveCount(0);
  await misst(page, gesaet, 'beobachter');
});
