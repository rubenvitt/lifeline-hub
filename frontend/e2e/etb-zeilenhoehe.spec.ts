import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Die Spaltenzeile der ETB-Zeitachse in `kompakt` als Layout-Gate (Change
 * `kwc2yszv-etb-neuentwurf`, Spec `etb-zeitachse-darstellung`, „Spaltenzeile in kompakter
 * Dichte“, Szenario „Einzeiliger Eintrag im Fükw“; vorher LFH-958 mit 56 px und 9 Einträgen).
 *
 * Ein einzeiliger Eintrag mit Von „Sanitätszug Musterstadt“, An „EL“ und Meldeweg Funk ist
 * höchstens 36 px hoch; Von → An steht in mindestens 13 px Textschrift, kein Text der Zeile ist
 * kleiner als 12 px. Der Verfasser samt Funktion („… · EL“) steht im Titel der Zeile, nicht in
 * ihr. Bei 1440 × 900 stehen zwischen Filter- und Erfassungsleiste mindestens 14 Einträge ganz im
 * Bild. Als Admin und als Beobachter (`e2e/AGENTS.md`, LFH-435): das Menü ⋮ hängt an der Rolle,
 * beim Beobachter fehlt die Erfassungsleiste.
 */

test.setTimeout(120_000);

const HOECHSTENS = 36;
const MINDESTENS_IM_BILD = 14;
const ANZAHL = 30;
/** Kleinste Schrift in einer Zeile, Von → An mindestens (Spec). */
const KLEINSTE_SCHRIFT = 12;
const VON_AN_SCHRIFT = 13;

const BREITEN = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

async function saeen(page: Page): Promise<string> {
  const neu = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Zeilenhöhe ${Date.now()}` },
  });
  expect(neu.ok(), `Einsatz: ${neu.status()}`).toBe(true);
  const einsatzId = String(((await neu.json()) as { id: number }).id);
  for (let n = 1; n <= ANZAHL; n += 1) {
    const a = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
      data: {
        typ: 'meldung',
        inhalt: `Pegel Messstelle ${n} unverändert`,
        von: 'Sanitätszug Musterstadt',
        an: 'EL',
        meldeweg: 'funk',
      },
    });
    expect(a.ok(), `Seeding: ${a.status()} ${await a.text()}`).toBe(true);
  }
  return einsatzId;
}

async function misst(page: Page, einsatzId: string, rolle: string) {
  await page.evaluate(() => localStorage.setItem('lifeline-hub.dichte', 'kompakt'));
  for (const breite of BREITEN) {
    const wo = `${rolle} ${breite.width}×${breite.height}`;
    await page.setViewportSize(breite);
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'kompakt');
    const zeilen = page.getByTestId('etb-ereigniszeile');
    await expect(zeilen).toHaveCount(ANZAHL);
    const erste = zeilen.first();
    // Vorbedingung: die Spaltenzeile steht, mit Verfasser samt Funktion im Titel und Meldeweg.
    await expect(erste).toHaveAttribute('data-lfh-form', 'spalten');
    await expect(erste).toHaveAttribute('title', /·\sEL$/);
    await expect(erste.locator('[data-lfh="etb-vonan"]')).toHaveText(
      'Sanitätszug Musterstadt → EL · Funk',
    );

    const hoehen = await zeilen.evaluateAll((alle) =>
      alle.slice(0, 10).map((z) => z.getBoundingClientRect().height),
    );
    for (const h of hoehen) {
      expect(h, `${wo}: Zeilenhöhe`).toBeLessThanOrEqual(HOECHSTENS);
    }
    const schrift = await erste.evaluate((zeile) => {
      const mitText = [...zeile.querySelectorAll<HTMLElement>('*')].filter((el) =>
        [...el.childNodes].some((k) => k.nodeType === 3 && k.textContent!.trim() !== ''),
      );
      const vonAn = zeile.querySelector<HTMLElement>('[data-lfh="etb-vonan"]')!;
      return {
        kleinste: Math.min(...mitText.map((el) => parseFloat(getComputedStyle(el).fontSize))),
        vonAn: parseFloat(getComputedStyle(vonAn).fontSize),
        vonAnFamilie: getComputedStyle(vonAn).fontFamily,
        // Textschrift ist die des Inhalts; Mono trägt die Zeit.
        textFamilie: getComputedStyle(zeile.querySelector('[data-lfh="etb-inhalt"]')!).fontFamily,
        monoFamilie: getComputedStyle(zeile.querySelector('[data-lfh="zeitachse-zeit"]')!)
          .fontFamily,
      };
    });
    expect(schrift.kleinste, `${wo}: kleinste Schrift`).toBeGreaterThanOrEqual(KLEINSTE_SCHRIFT);
    expect(schrift.vonAn, `${wo}: Von → An`).toBeGreaterThanOrEqual(VON_AN_SCHRIFT);
    expect(schrift.vonAnFamilie, `${wo}: Von → An in Textschrift`).toBe(schrift.textFamilie);
    expect(schrift.vonAnFamilie, `${wo}: Von → An nicht in Mono`).not.toBe(schrift.monoFamilie);

    if (breite.width !== 1440) continue;
    // Erst zählen, wenn die Erfassungsleiste steht: solange sie lädt, liegt ihre Oberkante
    // 137 px tiefer, und lokal zählte das Gate 11 statt 8 Einträge (LFH-954).
    if (rolle === 'admin') {
      await expect(page.getByRole('button', { name: 'Erfassen', exact: true })).toBeVisible();
    }
    const imBild = await page.evaluate(() => {
      const leiste = document.querySelector('#etb-filterleiste')!.getBoundingClientRect();
      const erfassung = document.querySelector('.etb-erfassung-sticky');
      const unten = erfassung ? erfassung.getBoundingClientRect().top : window.innerHeight;
      return [...document.querySelectorAll('[data-testid="etb-ereigniszeile"]')].filter((z) => {
        const r = z.getBoundingClientRect();
        return r.top >= leiste.bottom && r.bottom <= unten;
      }).length;
    });
    expect(imBild, `${wo}: Einträge zwischen den Leisten`).toBeGreaterThanOrEqual(
      MINDESTENS_IM_BILD,
    );
  }
}

test('Spaltenzeile: höchstens 36 px, mindestens 14 Einträge im Bild (Admin)', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await saeen(page);
  await misst(page, einsatzId, 'admin');
});

test('Spaltenzeile: höchstens 36 px, mindestens 14 Einträge im Bild (Beobachter)', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page, { startseite: false });
  const einsatzId = await saeen(page);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  // Vorbedingung des Rollenzweigs: ohne Schreibrecht keine Erfassung.
  await expect(page.getByTestId('etb-ereigniszeile')).toHaveCount(ANZAHL);
  await expect(page.getByRole('button', { name: 'Erfassen', exact: true })).toHaveCount(0);
  await misst(page, einsatzId, 'beobachter');
});

/**
 * Systemeinträge (LLH-1106): drei aufeinanderfolgende Systemeinträge stehen als EINE Bündelzeile,
 * die wie eine Zeile höchstens 36 px misst; aufgeklappt hält auch jede leise Zeile die Höhe.
 * Gesät über drei Gefahrengebiete (je ein Systemeintrag, wie `leisten-flaeche.spec.ts`). Die Seite
 * öffnet mit `system=an`: so stehen die Systemeinträge auch dort, wo sie in der Vorgabe
 * ausgeblendet sind (Spec, „Systemeinträge zeigen“).
 */
test('Systemeinträge: drei stehen als eine Bündelzeile, aufgeklappt hält jede die Zeilenhöhe', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await saeen(page);
  for (const [i, label] of ['Sektor A', 'Sektor B', 'Sektor C'].entries()) {
    const x = 10 + i / 20;
    const zone = await page.request.post(`/api/einsaetze/${einsatzId}/zonen`, {
      data: {
        typ: 'gefahrengebiet',
        geometrie_typ: 'Polygon',
        geometrie: JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [x, 50],
              [x + 0.01, 50],
              [x + 0.01, 50.01],
              [x, 50.01],
              [x, 50],
            ],
          ],
        }),
        label,
      },
    });
    expect(zone.ok(), await zone.text()).toBeTruthy();
  }
  await page.evaluate(() => localStorage.setItem('lifeline-hub.dichte', 'kompakt'));
  await page.setViewportSize(BREITEN[0]);
  await page.goto(`/einsaetze/${einsatzId}/etb?system=an`);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'kompakt');
  const zeitachse = page.getByRole('region', { name: 'Einsatztagebuch' });
  const buendel = zeitachse.getByTestId('etb-buendelzeile');
  await expect(buendel).toHaveCount(1);
  // Zu: die drei Systemeinträge sind nicht als Zeilen da, nur die Meldungen.
  await expect(zeitachse.getByTestId('etb-ereigniszeile')).toHaveCount(ANZAHL);
  expect((await buendel.boundingBox())!.height, 'Bündelzeile').toBeLessThanOrEqual(HOECHSTENS);

  const knopf = buendel.getByRole('button', { name: /^3 Systemeinträge / });
  await expect(knopf).toHaveAttribute('aria-expanded', 'false');
  await knopf.focus();
  await page.keyboard.press('Enter');
  await expect(knopf).toHaveAttribute('aria-expanded', 'true');
  const leise = zeitachse.locator('[data-testid="etb-ereigniszeile"][data-leise]');
  await expect(leise).toHaveCount(3);
  for (const h of await leise.evaluateAll((alle) =>
    alle.map((z) => z.getBoundingClientRect().height),
  )) {
    expect(h, 'leise Zeile').toBeLessThanOrEqual(HOECHSTENS);
  }
});
