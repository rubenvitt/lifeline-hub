import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Der Titel im Kräfte-Seitenkopf steht auf Personal, Fahrzeuge und Material gleich hoch
 * (LLH-1278, Prüfliste LLH-1225 Teil I). Fahrzeuge und Material tragen eine Segmentleiste im
 * Kopf; sie ist um zwei Zielabstände und ihren Rahmen höher als ein Knopf. Mittete die Leiste
 * Titel und Aktionen gegeneinander, rutschte der Titel dort um die halbe Differenz nach unten,
 * und beim Wechsel zwischen den Kräfte-Seiten sprang er. Der Titelblock hängt jetzt oben
 * (`titelblockStil` in `components/EinsatzSeite.tsx`).
 *
 * Gemessen in jeder Dichtestufe, als Admin (Knöpfe neben der Segmentleiste) und als Beobachter
 * (LFH-435: Personal hat dann gar keine Aktion, Fahrzeuge und Material behalten die Leiste).
 * Breite 1920 px, damit Titel und Aktionen in EINER Zeile stehen; darunter stapelt der Kopf
 * ohnehin (`EinsatzSeite.css`, unter `md`), und der Titel hinge an keiner Aktion.
 */

const BREIT = { width: 1920, height: 1080 };

/** Subpixel-Spielraum: `boundingBox()` liefert Fließkomma. */
const SUBPIXEL = 0.5;

/** Schlüssel aus `theme/ThemeModeProvider.tsx`. Bewusst literal — der Wert ist Vertrag. */
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

/** Treffhöhe der Stufe als Literal; in `kompakt` ist die Leiste kaum höher als ein Knopf. */
const STAFFEL = [
  { dichte: 'kompakt', soll: 30 },
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

const FUNKRUFNAME = 'Florian Musterstadt 44/2';
const KRAFT = 'Seitenkopf, Sabine';
const MATERIAL = 'Feldbett';

async function seede(page: Page, einsatzId: string, pfad: string, data: unknown) {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
}

async function einsatzMitKraeften(page: Page, dichte: string): Promise<string> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Kräftekopf ${dichte} ${Date.now()}` },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const einsatzId = String(((await r.json()) as { id: number }).id);
  await seede(page, einsatzId, 'fahrzeuge', {
    adhoc: { funkrufname: FUNKRUFNAME, fahrzeugtyp: 'LF 20' },
  });
  await seede(page, einsatzId, 'personal', { adhoc: { name: KRAFT, funktion: 'Helfer' } });
  await seede(page, einsatzId, 'material', { adhoc: { bezeichnung: MATERIAL }, menge: 4 });
  return einsatzId;
}

async function kasten(ziel: Locator) {
  const k = await ziel.boundingBox();
  expect(k, 'kein Kasten messbar').not.toBeNull();
  return k!;
}

interface Messung {
  titelOben: number;
  kopfHoehe: number;
  aktionenHoehe: number | null;
}

/**
 * Lädt die Seite, wartet auf den Datenanker und die Vorbedingung des Rollenzweigs, misst dann
 * die Oberkante des h1 und die Höhe von Kopf und Aktionen-Slot.
 */
async function miss(
  page: Page,
  pfad: string,
  anker: string,
  vorbedingung: () => Promise<void>,
): Promise<Messung> {
  await page.goto(pfad);
  await expect(
    page.getByText(anker).first(),
    `${pfad}: der Inhalt muss vor der Messung stehen`,
  ).toBeVisible();
  await vorbedingung();
  const kopf = page.locator('[data-lfh="seitenkopf"]');
  const titel = kopf.getByRole('heading', { level: 1 });
  await expect(titel).toBeVisible();
  const aktionen = kopf.locator('[data-lfh="seitenkopf-aktionen"]');
  const titelKasten = await kasten(titel);
  const kopfKasten = await kasten(kopf);
  let aktionenHoehe: number | null = null;
  if ((await aktionen.count()) > 0) {
    const a = await kasten(aktionen);
    // Vorbedingung: Titel und Aktionen teilen sich die Zeile — sonst mäße der Test nichts.
    expect(a.y, `${pfad}: Aktionen stehen in der Titelzeile`).toBeLessThan(
      titelKasten.y + titelKasten.height,
    );
    aktionenHoehe = a.height;
  }
  return { titelOben: titelKasten.y, kopfHoehe: kopfKasten.height, aktionenHoehe };
}

const segmentleiste = (page: Page, name: string) =>
  page.locator('[data-lfh="seitenkopf"]').getByRole('radiogroup', { name });

for (const { dichte, soll } of STAFFEL) {
  for (const rolle of ['admin', 'beobachter'] as const) {
    test(`Titel steht auf Personal, Fahrzeuge und Material gleich hoch (${dichte}, ${rolle})`, async ({
      page,
    }) => {
      test.slow();
      await anmeldenAlsAdmin(page);
      const einsatzId = await einsatzMitKraeften(page, dichte);
      if (rolle === 'beobachter') await wechsleZuRolle(page, 'beobachter', einsatzId);

      await page.setViewportSize(BREIT);
      await page.goto(`/einsaetze/${einsatzId}/personal`);
      await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
        DICHTE_SCHLUESSEL,
        dichte,
      ] as const);
      await page.reload();
      // Wache: trennt „Titel springt" von „Stufe gar nicht angekommen".
      await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

      const disponieren = (was: string) =>
        page.getByRole('button', { name: `${was} disponieren`, exact: true });
      const rollenzweig = async (was: string) => {
        if (rolle === 'admin') await expect(disponieren(was)).toBeVisible();
        else await expect(disponieren(was)).toHaveCount(0);
      };

      const personal = await miss(page, `/einsaetze/${einsatzId}/personal`, KRAFT, () =>
        rollenzweig('Personal'),
      );
      const fahrzeuge = await miss(
        page,
        `/einsaetze/${einsatzId}/fahrzeuge`,
        FUNKRUFNAME,
        async () => {
          await expect(segmentleiste(page, 'Ansicht')).toBeVisible();
          await rollenzweig('Fahrzeuge');
        },
      );
      const material = await miss(page, `/einsaetze/${einsatzId}/material`, MATERIAL, async () => {
        await expect(segmentleiste(page, 'Material gruppieren')).toBeVisible();
        await rollenzweig('Material');
      });

      // Vorbedingung ab `komfortabel`: die Segmentleiste ist höher als die Treffhöhe der Stufe
      // (und als Personals Knöpfe) — genau der Fall, in dem der Titel vorher rutschte.
      if (soll >= 48) {
        for (const [seite, m] of [
          ['Fahrzeuge', fahrzeuge],
          ['Material', material],
        ] as const) {
          expect(m.aktionenHoehe, `${seite}: Aktionen-Slot`).not.toBeNull();
          expect(m.aktionenHoehe!, `${seite}: Segmentleiste höher als ${soll} px`).toBeGreaterThan(
            soll + SUBPIXEL,
          );
        }
      }

      for (const [seite, m] of [
        ['Fahrzeuge', fahrzeuge],
        ['Material', material],
      ] as const) {
        expect(
          Math.abs(m.titelOben - personal.titelOben),
          `${seite}: Titel ${m.titelOben.toFixed(1)} px, Personal ${personal.titelOben.toFixed(1)} px ` +
            `(Kopf ${m.kopfHoehe.toFixed(1)} gegen ${personal.kopfHoehe.toFixed(1)} px)`,
        ).toBeLessThanOrEqual(SUBPIXEL);
      }
    });
  }
}
