import { expect, test, type Page } from '@playwright/test';
import { waehleIn } from './auswahl-kern';
import { pdfAuszug } from './pdf-kern';
import { ADMIN, ADMIN_PW, anmeldenAls } from './rollen-kern';

/**
 * Druck des Schichtplans (LLH-1557, Change `jwqanxja-schichtplan-ausgeben` D3/D7): Aushang je
 * Posten und Zettel je Person. Chromium, Firefox und WebKit prüfen die Mechanik unter Druckmedium
 * (`DRUCK_SPECS`): jedes weitere Blatt beginnt auf neuer Seite, eine Zeile bricht nicht, der
 * Tabellenkopf ist Kopfgruppe, nichts ragt über die Druckwurzel. Das PDF (Seiten, keine verlorene
 * Zeile, Blatt allein auf seiner Seite) gibt es nur in Chromium.
 *
 * Gesät wird ein Einsatz mit der UHS „UHS Marktplatz“ (30 Schichten zu 30 Minuten, also über eine
 * Seite), der Einheit „Fußstreife 1“, einer Pause, einer Ad-hoc-Kraft und einem Helfer des Plans.
 *
 * Die Planung ohne Einsatz (LLH-1593) druckt dieselben Blätter von ihrer Seite aus; ihr Test sät
 * eine Planung mit zwei Posten und einem Helfer über die API.
 *
 * Mutationsprobe: jedes Blatt in ein eigenes `div` gelegt (die Kapitel sind keine Geschwister
 * mehr, die Regel in `druck/druck.css` greift nicht) → `break-before` ist `auto`, rot.
 */

const A4_DRUCKBREITE = 680;
const SUBPIXEL = 1;
const UHS_SCHICHTEN = 30;

async function seede(page: Page): Promise<number> {
  const neu = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Schichtplan Druck ${Date.now()}` },
  });
  expect(neu.ok(), `Einsatz: ${neu.status()}`).toBeTruthy();
  const einsatzId = ((await neu.json()) as { id: number }).id;
  const basis = `/api/einsaetze/${einsatzId}`;
  const sende = async (pfad: string, data: unknown) => {
    const a = await page.request.post(`${basis}/${pfad}`, { data });
    expect(a.ok(), `${pfad}: ${a.status()} ${await a.text()}`).toBeTruthy();
    return (await a.json()) as { id: number };
  };
  const streife = await sende('einheiten', { name: 'Fußstreife 1' });
  const uhs = await sende('uhs', { typ: 'patientenablage', bezeichnung: 'UHS Marktplatz' });
  const kraft = await sende('personal', { adhoc: { name: 'Anna Aushang' } });
  const helfer = await sende('abloesungen/schichtplan/helfer', {
    name: 'Cora Clausen',
    telefon: '0151 2345678',
    organisation: 'Sanitätszug West',
  });
  const personen = [
    { art: 'einsatz', einsatz_personal_id: kraft.id },
    { art: 'helfer', helfer_id: helfer.id },
  ];
  const beginn = Date.UTC(2026, 11, 5, 8, 0);
  const wire = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  const halbe = 30 * 60_000;
  for (let i = 0; i < UHS_SCHICHTEN; i++) {
    await sende('abloesungen/schichtplan/bloecke', {
      posten: { art: 'uhs', uhs_id: uhs.id },
      von: wire(beginn + i * halbe),
      bis: wire(beginn + (i + 1) * halbe),
      soll_anzahl: 3,
      personen: i % 2 === 0 ? personen : [personen[1]],
    });
  }
  await sende('abloesungen/schichtplan/bloecke', {
    posten: { art: 'einheit', einheit_id: streife.id },
    von: wire(beginn),
    bis: wire(beginn + 4 * halbe),
    soll_anzahl: 2,
    personen: [personen[0]],
  });
  await sende('abloesungen/schichtplan/bloecke', {
    posten: { art: 'pause' },
    von: wire(beginn + 4 * halbe),
    bis: wire(beginn + 5 * halbe),
    personen: [personen[0]],
  });
  return einsatzId;
}

/** Druck wie die Person: der Knopf löst `beforeprint` aus (`emulateMedia` feuert es nicht). */
async function drucke(page: Page) {
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.getByRole('button', { name: /Drucken/ }).click();
  await page.emulateMedia({ media: 'print' });
}

test('Aushang je Posten: Blatt je Posten auf neuer Seite, Zeilen ganz, nichts ragt heraus', async ({
  page,
  browserName,
}) => {
  test.setTimeout(180_000);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await seede(page);
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 900 });

  // Einstieg aus der Ansicht Schichtplan.
  await page.goto(`/einsaetze/${einsatzId}/abloesung?ansicht=plan`);
  await page.getByRole('link', { name: 'Drucken' }).click();
  await expect(page).toHaveURL(/\/abloesung\/schichtplan\/druck$/);

  const blaetter = page.locator('[data-lfh="druckwurzel"] [data-lfh="druck-kapitel"]');
  await expect(blaetter).toHaveCount(2);
  await expect(blaetter.nth(0).getByRole('heading')).toHaveText('Aushang – Fußstreife 1');
  await expect(blaetter.nth(1).getByRole('heading')).toHaveText('Aushang – UHS Marktplatz');
  await expect(blaetter.nth(1).locator('tbody tr')).toHaveCount(UHS_SCHICHTEN);
  await expect(blaetter.nth(1).getByText('Cora Clausen (Sanitätszug West)').first()).toBeVisible();

  await drucke(page);
  const lage = await page.evaluate(() => {
    const wurzel = document.querySelector('[data-lfh="druckwurzel"]')!.getBoundingClientRect();
    const kapitel = Array.from(document.querySelectorAll('[data-lfh="druck-kapitel"]'));
    const zellen = Array.from(document.querySelectorAll('[data-lfh="druckwurzel"] :is(td, th)'));
    const zeile = document.querySelector('[data-lfh="schichtplan-aushang"] tbody tr')!;
    return {
      wurzelRechts: wurzel.right,
      zellenRechts: Math.max(...zellen.map((z) => z.getBoundingClientRect().right)),
      ersterBruch: getComputedStyle(kapitel[0]).breakBefore,
      zweiterBruch: getComputedStyle(kapitel[1]).breakBefore,
      zeileBricht: getComputedStyle(zeile).breakInside,
      kopf: getComputedStyle(document.querySelector('[data-lfh="schichtplan-aushang"] thead')!)
        .display,
      bedienung: document.querySelector('[aria-label="Blätter"]')!.getClientRects().length,
    };
  });
  expect(lage.ersterBruch, 'das erste Blatt beginnt ohne Leerseite').not.toBe('page');
  expect(lage.zweiterBruch, 'jedes weitere Blatt beginnt auf neuer Seite').toBe('page');
  expect(lage.zeileBricht, 'eine Schicht bricht nicht über die Seite').toBe('avoid');
  expect(lage.kopf, 'Tabellenkopf als Kopfgruppe').toBe('table-header-group');
  expect(lage.bedienung, 'Wahl der Blätter nicht auf Papier').toBe(0);
  expect(
    lage.zellenRechts,
    `keine Zelle über der Druckwurzel (Zelle ${lage.zellenRechts}px, Wurzel ${lage.wurzelRechts}px)`,
  ).toBeLessThanOrEqual(lage.wurzelRechts + SUBPIXEL);

  if (browserName !== 'chromium') {
    test.info().annotations.push({ type: 'nur-chromium', description: 'Seiten im PDF' });
    await page.emulateMedia({ media: null });
    return;
  }
  const seiten = await pdfAuszug(await page.pdf({ format: 'A4', preferCSSPageSize: true }));
  test.info().annotations.push({
    type: 'messwert',
    description: `${seiten.length} Seiten`,
  });
  const streife = seiten.findIndex((s) => s.text.includes('Aushang – Fußstreife 1'));
  const uhs = seiten.findIndex((s) => s.text.includes('Aushang – UHS Marktplatz'));
  expect(streife, 'Streife auf Seite 1').toBe(0);
  expect(uhs, 'UHS auf eigener Seite').toBe(1);
  expect(seiten.length, 'die UHS läuft über mehr als eine Seite').toBeGreaterThanOrEqual(3);
  expect(seiten[0].text, 'auf der Seite der Streife keine UHS-Schicht').not.toContain(
    'Sanitätszug West',
  );
  // Keine Zeile verloren: alle 30 Schichten der UHS stehen im PDF (je Zeile genau ein Helfer).
  const helferZeilen = seiten
    .slice(uhs)
    .reduce((n, s) => n + (s.text.match(/Cora Clausen \(Sanitätszug West\)/g) ?? []).length, 0);
  expect(helferZeilen, 'alle Schichten der UHS gedruckt').toBe(UHS_SCHICHTEN);
  await page.emulateMedia({ media: null });
});

test('Zettel je Person: Pause als Zeile, Stunden ohne Pause, Telefon beim Helfer', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await seede(page);
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/abloesung/schichtplan/druck?sicht=person`);

  const blaetter = page.locator('[data-lfh="druckwurzel"] [data-lfh="druck-kapitel"]');
  await expect(blaetter).toHaveCount(2);
  const anna = blaetter.nth(0);
  await expect(anna.getByRole('heading')).toHaveText('Schichtzettel – Anna Aushang');
  // 15 UHS-Schichten zu 30 min + 2 h Streife; die halbe Stunde Pause zählt nicht.
  await expect(anna.getByText('16 Schichten, 9:30 h')).toBeVisible();
  await expect(anna.getByRole('cell', { name: 'Pause', exact: true })).toBeVisible();
  const cora = blaetter.nth(1);
  await expect(cora.getByText('0151 2345678')).toBeVisible();

  // Ein Blatt wählen: nur dieses steht da, und die Adresse trägt die Wahl.
  await waehleIn(page.getByRole('combobox', { name: 'Blatt' }), 'Cora Clausen');
  await expect(blaetter).toHaveCount(1);
  await expect(page).toHaveURL(/sicht=person&auswahl=helfer%3A\d+/);

  await drucke(page);
  const bruch = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector('[data-lfh="schichtplan-zettel"] tbody tr')!)
        .breakInside,
  );
  expect(bruch).toBe('avoid');
  await page.emulateMedia({ media: null });
});

/** Eine Planung eine Woche voraus mit „RTW 1“ (20 Schichten) und „Fußtrupp“, ein Helfer. */
async function seedePlanung(page: Page): Promise<number> {
  const beginn = Math.ceil((Date.now() + 7 * 24 * 3_600_000) / 3_600_000) * 3_600_000;
  const wire = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  const halbe = 30 * 60_000;
  const neu = await page.request.post('/api/planungen', {
    data: {
      bezeichnung: `E2E Planung Druck ${Date.now()}`,
      von: wire(beginn),
      bis: wire(beginn + 12 * 3_600_000),
    },
  });
  expect(neu.ok(), `Planung: ${neu.status()} ${await neu.text()}`).toBeTruthy();
  const planungId = ((await neu.json()) as { kopf: { id: number } }).kopf.id;
  const sende = async (pfad: string, data: unknown) => {
    const a = await page.request.post(`/api/planungen/${planungId}/${pfad}`, { data });
    expect(a.ok(), `${pfad}: ${a.status()} ${await a.text()}`).toBeTruthy();
    return (await a.json()) as { id: number; posten: { id: number; bezeichnung: string }[] };
  };
  await sende('posten', { bezeichnung: 'RTW 1', art: 'einheit' });
  const mitFuss = await sende('posten', { bezeichnung: 'Fußtrupp', art: 'einheit' });
  const rtw = mitFuss.posten.find((p) => p.bezeichnung === 'RTW 1')!.id;
  const fuss = mitFuss.posten.find((p) => p.bezeichnung === 'Fußtrupp')!.id;
  const helfer = await sende('helfer', {
    name: 'Paul Planer',
    telefon: '0170 1112233',
    organisation: 'Bereitschaft Nord',
  });
  const personen = [{ art: 'helfer', helfer_id: helfer.id }];
  for (let i = 0; i < 20; i++) {
    await sende('bloecke', {
      posten_id: rtw,
      von: wire(beginn + i * halbe),
      bis: wire(beginn + (i + 1) * halbe),
      soll_anzahl: 2,
      personen,
    });
  }
  await sende('bloecke', {
    posten_id: fuss,
    von: wire(beginn + 20 * halbe),
    bis: wire(beginn + 24 * halbe),
    personen,
  });
  return planungId;
}

test('Planung: Aushang von der Planungsseite, der Kopf nennt die Planung', async ({ page }) => {
  test.setTimeout(180_000);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const planungId = await seedePlanung(page);
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 900 });

  await page.goto(`/planungen/${planungId}`);
  await page.getByRole('link', { name: 'Drucken' }).click();
  await expect(page).toHaveURL(new RegExp(`/planungen/${planungId}/druck$`));

  const blaetter = page.locator('[data-lfh="druckwurzel"] [data-lfh="druck-kapitel"]');
  await expect(blaetter).toHaveCount(2);
  await expect(blaetter.nth(0).getByRole('heading')).toHaveText('Aushang – RTW 1');
  await expect(blaetter.nth(1).getByRole('heading')).toHaveText('Aushang – Fußtrupp');
  await expect(blaetter.nth(0).locator('tbody tr')).toHaveCount(20);
  await expect(blaetter.nth(0).getByText('Planung', { exact: true })).toBeVisible();

  await drucke(page);
  const lage = await page.evaluate(() => {
    const wurzel = document.querySelector('[data-lfh="druckwurzel"]')!.getBoundingClientRect();
    const kapitel = Array.from(document.querySelectorAll('[data-lfh="druck-kapitel"]'));
    const zellen = Array.from(document.querySelectorAll('[data-lfh="druckwurzel"] :is(td, th)'));
    return {
      wurzelRechts: wurzel.right,
      zellenRechts: Math.max(...zellen.map((z) => z.getBoundingClientRect().right)),
      zweiterBruch: getComputedStyle(kapitel[1]).breakBefore,
      zeileBricht: getComputedStyle(
        document.querySelector('[data-lfh="schichtplan-aushang"] tbody tr')!,
      ).breakInside,
    };
  });
  expect(lage.zweiterBruch, 'jedes weitere Blatt beginnt auf neuer Seite').toBe('page');
  expect(lage.zeileBricht, 'eine Schicht bricht nicht über die Seite').toBe('avoid');
  expect(lage.zellenRechts, 'keine Zelle über der Druckwurzel').toBeLessThanOrEqual(
    lage.wurzelRechts + SUBPIXEL,
  );
  await page.emulateMedia({ media: null });
});
