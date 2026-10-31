import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Ausgabeansicht der Verpflegung am Stab (LLH-1032; Spec `kraefte-verpflegung`, „Ausgabe
 * zählen“): Desktop in `kompakt`. Gezählt wird in eine Sammlung, die als EINE Ausgabe gebucht
 * wird (nach Ruhe, über „Buchen“, ab 50 Portionen, beim Verlassen). Sonderkost zählt die Menge
 * mit, also nie 422. Ohne Netz steht das Bündel als „ausstehend“ und läuft danach genau einmal
 * ein.
 *
 * Seeding als Admin über die API. Kein `networkidle` (LFH-385).
 *
 * Mutationsproben: Sonderkost-Tipp ohne Mengenzuwachs (`ausgabeSammlung.ts`, `menge` zählt nur
 * Normalkost) → 422, der Test „Sonderkost“ wird rot; die Sammelzeile nur bei offenem Bündel
 * gerendert (`AusgabeAnsicht.tsx`) → die Lage der Zähltasten ändert sich beim ersten Tipp, der
 * Test „Lage“ wird rot.
 */

interface Zeitfenster {
  id: number;
  ausgegeben: { gesamt: number; sonderkost: Record<string, number> };
  ausgaben: { id: number; menge: number; zurueckgenommen_at?: string | null }[];
}

async function anlegen<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, data === undefined ? {} : { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

/** Ein Einsatz mit einem laufenden Zeitfenster „Mittag Deich“ (40 EP, davon 4 vegetarisch). */
async function saeen(
  page: Page,
  minutenVon = -10,
  minutenBis = 110,
  {
    sonderkost = { vegetarisch: 4 },
    kraefte = 30,
  }: { sonderkost?: Record<string, number>; kraefte?: number } = {},
) {
  await anmeldenAlsAdmin(page);
  const e = (await anlegen(page, '/api/einsaetze', { bezeichnung: `E2E Ausgabe ${Date.now()}` }))
    .id;
  const jetzt = Date.now();
  const zeit = (minuten: number) => new Date(jetzt + minuten * 60_000).toISOString();
  const zf = await anlegen(page, `/api/einsaetze/${e}/verpflegung/zeitfenster`, {
    bezeichnung: 'Mittag Deich',
    von_at: zeit(minutenVon),
    bis_at: zeit(minutenBis),
    bedarf_kraefte: kraefte,
    bedarf_betreute: 10,
    sonderkost,
  });
  return { e, zf: zf.id };
}

async function zeitfenster(page: Page, e: number): Promise<Zeitfenster> {
  const r = await page.request.get(`/api/einsaetze/${e}/verpflegung`);
  return ((await r.json()) as { zeitfenster: Zeitfenster[] }).zeitfenster[0];
}

/** Zählt die POSTs auf `…/zeitfenster/:id/ausgaben` samt Status. */
function ausgabenZaehler(page: Page) {
  const status: number[] = [];
  page.on('response', (r) => {
    if (
      r.request().method() === 'POST' &&
      /\/verpflegung\/zeitfenster\/\d+\/ausgaben$/.test(r.url())
    ) {
      status.push(r.status());
    }
  });
  return status;
}

async function oeffne(page: Page, e: number, zf: number) {
  await page.goto(`/einsaetze/${e}/verpflegung/${zf}/ausgabe`);
  await expect(page.getByRole('heading', { level: 1, name: 'Mittag Deich' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'kompakt');
}

const plus1 = (page: Page) =>
  page.locator('[data-lfh="zaehltasten"]').getByRole('button', { name: '+1', exact: true });

test('Sonderkost-Taste und „+1“: eine Ausgabe mit Sonderkost, keine 422; „−1“ erst nach dem Tipp frei; Rückgängig', async ({
  page,
}) => {
  const { e, zf } = await saeen(page);
  const status = ausgabenZaehler(page);
  await oeffne(page, e, zf);

  const minus = page.getByRole('button', { name: '−1', exact: true });
  await expect(minus).toBeDisabled();
  await expect(page.locator('[data-lfh="zaehltasten-grund"]')).toHaveText('keine Sammlung');

  await page.getByRole('button', { name: /^vegetarisch 0\/4/ }).click();
  await expect(minus).toBeEnabled();
  await plus1(page).click();
  await expect(page.locator('[data-lfh="sammlung-menge"]')).toHaveText('2');
  await page.getByRole('button', { name: 'Buchen', exact: true }).click();

  await expect(
    page.getByText('Gebucht: 2 EP zu ‚Mittag Deich‘ (davon 1 vegetarisch)'),
  ).toBeVisible();
  expect(status).toEqual([201]);
  const nachher = await zeitfenster(page, e);
  expect(nachher.ausgegeben.gesamt).toBe(2);
  expect(nachher.ausgegeben.sonderkost.vegetarisch).toBe(1);

  // Rückgängig nimmt genau diese Ausgabe zurück.
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect
    .poll(async () => (await zeitfenster(page, e)).ausgegeben.gesamt, { timeout: 10_000 })
    .toBe(0);
});

test('„Menge …“ 60 bucht sofort eine Ausgabe über 60 EP', async ({ page }) => {
  const { e, zf } = await saeen(page);
  await oeffne(page, e, zf);
  await page.getByRole('button', { name: 'Menge …', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Menge zählen' });
  await dialog.getByLabel('Menge (EP)').fill('60');
  await dialog.getByRole('button', { name: 'Zählen' }).click();
  // Sofort, nicht erst nach der Ruhe: die Höchstmenge 50 ist erreicht.
  await expect(page.getByText('Gebucht: 60 EP zu ‚Mittag Deich‘')).toBeVisible({ timeout: 2_000 });
  const z = await zeitfenster(page, e);
  expect(z.ausgaben.map((a) => a.menge)).toEqual([60]);
});

test('vergangenes Zeitfenster: Zähltasten gesperrt, „Ausgabe nachtragen“ trägt nach', async ({
  page,
}) => {
  const { e, zf } = await saeen(page, -180, -60);
  await oeffne(page, e, zf);
  await expect(plus1(page)).toBeDisabled();
  await expect(page.locator('[data-lfh="zaehltasten-grund"]')).toHaveText('Zeitfenster vorbei');
  await page.getByRole('button', { name: 'Ausgabe nachtragen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ausgabe nachtragen: Mittag Deich' });
  await dialog.getByLabel('Menge (EP)').fill('25');
  await dialog.getByRole('button', { name: 'Nachtragen' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-lfh="ausgabe-zeile"]')).toContainText('25 EP');
});

test('ohne Netz: gezählt steht „ausstehend“, nach der Rückkehr läuft genau eine Ausgabe ein', async ({
  page,
}) => {
  const { e, zf } = await saeen(page);
  await oeffne(page, e, zf);
  await page.context().setOffline(true);
  await expect(page.locator('[data-lfh="ausgabe-offline"]')).toHaveText('Offline vorgemerkt');
  for (let i = 0; i < 3; i++) await plus1(page).click();
  await page.getByRole('button', { name: 'Buchen', exact: true }).click();
  await expect(page.getByText('Offline vorgemerkt: 3 EP zu ‚Mittag Deich‘')).toBeVisible();
  await expect(page.locator('[data-lfh="ausgabe-ausstehend"]')).toHaveText('+ 3 ausstehend');
  // Nicht in der Deckung: „fehlt“ zeigt weiter die Zahl des Servers.
  await expect(
    page
      .locator('[data-lfh="kennzahl"]', { hasText: 'fehlt' })
      .locator('[data-lfh="kennzahl-wert"]'),
  ).toHaveText('40');

  await page.context().setOffline(false);
  await expect
    .poll(async () => (await zeitfenster(page, e)).ausgaben.map((a) => a.menge), {
      timeout: 30_000,
    })
    .toEqual([3]);
  await expect(page.locator('[data-lfh="ausgabe-ausstehend"]')).toHaveText('+ 0 ausstehend');
});

/*
 * Lage der Zähltasten (Spec „Ausgabeansicht eines Zeitfensters“: ein Tipp, eine Ablehnung oder ein
 * Wechsel der Verbindung verschiebt keine Zähltaste). Am Desktop und bei 390 px in allen drei
 * Stufen: dort ist der Kopf so schmal, dass ein wachsender Text („davon 1 vegetarisch“, eine
 * Stelle mehr in der Legende) die Zeile umbrechen und alles darunter schieben könnte.
 *
 * Mutationsproben: Sonderkost-Text der Sammlung wieder in die umbrechende Zeile vor „Buchen“
 * → 390 px rot; Legende wieder als ein umbrechender Text → 390 px `kompakt` rot; Grund einer
 * abgelehnten Rücknahme wieder im Seitenhinweis → rot.
 */
for (const { breite, hoehe, dichte } of [
  { breite: 1440, hoehe: 900, dichte: 'kompakt' },
  { breite: 390, hoehe: 844, dichte: 'kompakt' },
  { breite: 390, hoehe: 844, dichte: 'komfortabel' },
  { breite: 390, hoehe: 700, dichte: 'handschuh' },
]) {
  test(`Lage: Tipps und eine abgelehnte Rücknahme verschieben keine Zähltaste (${breite}×${hoehe}, ${dichte})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: breite, height: hoehe });
    // Bedarf 150: bei 390 px in `kompakt` passt die Legende mit „Sammlung 0 … Rest 150“ knapp
    // in eine Zeile, mit „Sammlung 11 … Rest 139“ nicht mehr.
    const { e, zf } = await saeen(page, -10, 110, {
      sonderkost: { vegetarisch: 4, vegan: 2 },
      kraefte: 140,
    });
    await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);
    await page.goto(`/einsaetze/${e}/verpflegung/${zf}/ausgabe`);
    await expect(page.getByRole('heading', { level: 1, name: 'Mittag Deich' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

    const vegetarisch = page.getByRole('button', { name: /^vegetarisch/ });
    const vegan = page.getByRole('button', { name: /^vegan/ });
    const tasten: [string, Locator][] = [
      ['−1', page.getByRole('button', { name: '−1', exact: true })],
      ['Menge …', page.getByRole('button', { name: 'Menge …', exact: true })],
      ['+5', page.getByRole('button', { name: '+5', exact: true })],
      ['+10', page.getByRole('button', { name: '+10', exact: true })],
      ['+1', plus1(page)],
      ['vegetarisch', vegetarisch],
      ['vegan', vegan],
      ['Buchen', page.getByRole('button', { name: 'Buchen', exact: true })],
    ];
    // Immer am Seitenanfang gemessen: ein Klick rollt die Taste ins Bild, das klebende Tastenfeld
    // steht aber relativ zum Fenster; so sind beide Arten vergleichbar.
    const lage = async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      return Promise.all(
        tasten.map(async ([name, t]) => {
          const box = (await t.boundingBox())!;
          return { name, x: box.x, y: box.y, w: box.width, h: box.height };
        }),
      );
    };
    const vorher = await lage();
    const gleich = async (wann: string) => {
      const nachher = await lage();
      for (const [i, v] of vorher.entries()) {
        expect(nachher[i], `${v.name} ${wann}`).toEqual(v);
      }
    };

    await vegetarisch.click();
    await expect(page.locator('[data-lfh="sammlung-menge"]')).toHaveText('1');
    await gleich('nach dem ersten Tipp (vegetarisch)');

    await vegan.click();
    for (let i = 0; i < 9; i++) await plus1(page).click();
    await expect(page.locator('[data-lfh="sammlung-menge"]')).toHaveText('11');
    await gleich('nach vegan und 9 × „+1“ (zweistellig)');

    await page.getByRole('button', { name: 'Buchen', exact: true }).click();
    await expect(page.getByText(/^Gebucht: 11 EP/)).toBeVisible();
    await gleich('nach dem Buchen');

    // Die Ausgabe ist schon anderswo zurückgenommen: „Rückgängig“ wird abgelehnt.
    const [ausgabe] = (await zeitfenster(page, e)).ausgaben;
    await anlegen(page, `/api/einsaetze/${e}/verpflegung/ausgaben/${ausgabe.id}/zuruecknehmen`, {});
    await page.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(page.locator('[data-lfh="ausgabe-ablehnung"]')).toContainText(
      'Nicht zurückgenommen',
    );
    await gleich('nach der abgelehnten Rücknahme');
  });
}

test('4 × „+1“, dann sofort zur Modulseite: genau eine Ausgabe über 4 EP, kein Rückgängig-Toast', async ({
  page,
}) => {
  const { e, zf } = await saeen(page);
  await oeffne(page, e, zf);
  for (let i = 0; i < 4; i++) await plus1(page).click();
  // Verlassen bucht: das Bündel geht ohne Hinweis in die Warteschlange und läuft von dort ein.
  await page.getByRole('link', { name: 'Verpflegung' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${e}/verpflegung$`));
  await expect
    .poll(async () => (await zeitfenster(page, e)).ausgaben.map((a) => a.menge), {
      timeout: 30_000,
    })
    .toEqual([4]);
  await expect(page.getByRole('button', { name: 'Rückgängig' })).toHaveCount(0);
  await expect(page.getByText(/^Gebucht:/)).toHaveCount(0);
});

/**
 * Höhe der Ansicht (LLH-1294): mit kurzer Liste rollt nichts, Kopf und Tastenfeld stehen ganz im
 * Bild, und das Tastenfeld schließt unten mit dem Scrollbereich ab (D9). Am Stab rollt das
 * Dokument, am Gerät das `main` zwischen Kopfzeile und Gerätenavigation. Bedarf 1840 EP: auch
 * vierstellig stehen Soll, ausgegeben und fehlt in einer Zeile, ohne seitlichen Überlauf.
 *
 * Am Stab bei 390 × 700 trägt der Rahmen mehr als am Gerät (Kopfleiste zweizeilig, Ortspfad); dort
 * rollt die Seite um wenige Pixel. Unter `md` rollt die Kopfleiste mit, geprüft wird deshalb, dass
 * Kopf und Tasten auch am Ende des Bildlaufs ganz im Bild stehen.
 *
 * Mutationsproben: `useRestHoehe` in `AusgabeAnsicht.tsx` durch `minHeight: '100dvh'` ersetzt →
 * der Scrollbereich rollt um Kopf und Navigation, die strengen Fälle werden rot; `spalten` am
 * Kennzahlenband entfernt → das Gerät bei 390 × 700 rollt um etwa 60 px.
 */
async function pruefeHoehe(
  page: Page,
  wo: string,
  scrollbereich: string | null,
  { rollen = false }: { rollen?: boolean } = {},
) {
  const kopf = page.locator('[data-lfh="ausgabe-kopf"]');
  const tasten = page.locator('[data-lfh="zaehltasten"]');
  const messen = () =>
    page.evaluate((sel) => {
      const b = sel ? document.querySelector<HTMLElement>(sel)! : document.documentElement;
      const sicht = sel ? b.clientHeight : window.innerHeight;
      // Die Kante, an der ein Fuß mit `bottom: 0` klebt: am Gerät über der Polsterung des
      // `main`, am Stab die Fensterkante.
      const kante = sel
        ? b.getBoundingClientRect().top +
          b.clientTop +
          b.clientHeight -
          parseFloat(getComputedStyle(b).paddingBottom)
        : sicht;
      const feld = document.querySelector('[data-lfh="zaehltasten"]')!.getBoundingClientRect();
      return {
        // Wie weit sich der Scrollbereich rollen lässt.
        rollt: b.scrollHeight - sicht,
        // Abstand des Tastenfelds zur Unterkante des Scrollbereichs (es schließt mit ihr ab, D9).
        // Bis 1 px ist Rundung: die Mindesthöhe wird abgerundet, damit nichts rollt.
        luecke: Math.abs(kante - feld.bottom) <= 1 ? 0 : Math.round(kante - feld.bottom),
        seitlich: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    }, scrollbereich);
  // Die Höhe wird nach einer Größenänderung im nächsten Bild nachgezogen: daher `poll`.
  if (rollen) {
    await expect
      .poll(
        async () => {
          const { luecke, seitlich } = await messen();
          return { luecke, seitlich };
        },
        { message: wo },
      )
      .toEqual({ luecke: 0, seitlich: 0 });
  } else {
    await expect.poll(messen, { message: wo }).toEqual({ rollt: 0, luecke: 0, seitlich: 0 });
  }
  await expect(kopf, wo).toBeInViewport({ ratio: 1 });
  await expect(tasten, wo).toBeInViewport({ ratio: 1 });
  if (rollen) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(kopf, `${wo}, am Ende des Bildlaufs`).toBeInViewport({ ratio: 1 });
    await expect(tasten, `${wo}, am Ende des Bildlaufs`).toBeInViewport({ ratio: 1 });
  }
}

for (const flaeche of [
  { width: 390, height: 700 },
  { width: 1280, height: 800 },
]) {
  const groesse = `${flaeche.width}×${flaeche.height}`;

  test(`Höhe am Stab: kurze Liste, Kopf und Tasten im Bild (${groesse})`, async ({ page }) => {
    await page.setViewportSize(flaeche);
    const { e, zf } = await saeen(page, -10, 110, { kraefte: 1830 });
    await oeffne(page, e, zf);
    await pruefeHoehe(page, 'Stab', null, { rollen: flaeche.width < 768 });
  });

  test(`Höhe am Gerät: kurze Liste rollt nicht, Kopf und Tasten im Bild (${groesse})`, async ({
    page,
    browser,
  }) => {
    const { e, zf } = await saeen(page, -10, 110, { kraefte: 1830 });
    const kopplung = await anlegen<{ code: { code: string } }>(
      page,
      `/api/einsaetze/${e}/geraete`,
      {
        ansicht: 'verpflegung',
        bezeichnung: 'Ausgabe Deich',
      },
    );
    const kontext = await browser.newContext({ viewport: flaeche });
    const geraet = await kontext.newPage();
    try {
      await geraet.goto(`/koppeln#${kopplung.code.code}`);
      await geraet.getByRole('button', { name: 'Gerät koppeln' }).click();
      await expect(geraet).toHaveURL(new RegExp(`/geraet/${e}/verpflegung$`));
      await geraet.goto(`/geraet/${e}/verpflegung/${zf}/ausgabe`);
      await expect(geraet.getByRole('heading', { level: 1, name: 'Mittag Deich' })).toBeVisible();
      await expect(geraet.getByRole('navigation', { name: 'Gerätenavigation' })).toBeInViewport({
        ratio: 1,
      });
      await pruefeHoehe(geraet, 'Gerät', '.geraet-huelle > main');
    } finally {
      await kontext.close();
    }
  });
}

test('Kennzahlen im Kopf laufen auch vierstellig nicht über (320 bis 390 px, kompakt und komfortabel)', async ({
  page,
}) => {
  const { e, zf } = await saeen(page, -10, 110, { kraefte: 1830 });
  for (const dichte of ['kompakt', 'komfortabel']) {
    await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);
    for (const breite of [390, 360, 320]) {
      await page.setViewportSize({ width: breite, height: 700 });
      await page.goto(`/einsaetze/${e}/verpflegung/${zf}/ausgabe`);
      await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
      await expect(page.getByRole('group', { name: 'Deckung Mittag Deich' })).toContainText('1840');
      const ueberlauf = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-lfh="kennzahlenband"] > *')].map(
          (z) => z.scrollWidth - z.clientWidth,
        ),
      );
      expect(ueberlauf, `${breite} px, ${dichte}`).toEqual([0, 0, 0]);
    }
  }
});
