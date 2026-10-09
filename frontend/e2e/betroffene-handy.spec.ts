import { expect, test, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';
import { einsatzAnlegen } from './einsatz-kern';

/**
 * Betroffene am Handschirm (LFH-963): Liste und Detail bei 390 × 844, das Detail auch bei 820
 * (Tablet hoch), je als Admin und als Beobachter. Gegenprobe bei 1180 (Tablet quer): dort stehen
 * die Nebenwege als Knöpfe, und die Detailspalten liegen nebeneinander.
 *
 * Gemessen wird „im ersten Bildschirm" mit `toBeInViewport({ ratio: 1 })` OHNE vorheriges
 * Scrollen: das ist die Aussage des Tickets, nicht „irgendwo auf der Seite".
 *
 * Kein `networkidle` (SSE-Strom), kein Device-Descriptor; `hasTouch` und die Dichte komfortabel,
 * weil das die Stufe am Handy ist.
 */
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const HANDSCHIRM = { width: 390, height: 844 };
const TABLET_HOCH = { width: 820, height: 1180 };
const TABLET_QUER = { width: 1180, height: 820 };

const NEBENWEGE = 'Weitere Aktionen zu den Betroffenen';
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

test.use({ hasTouch: true });

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Seeding per `page.request` (Cookie-Jar geteilt). Gibt die Id der Person zurück. */
async function seedePerson(page: Page, einsatzId: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personen`, { data });
  expect(antwort.ok(), `Seeding Person: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

/**
 * Zwei Personen: eine ohne Sichtung (Status „erfasst", steht im Vorgabe-Reiter der Liste) mit
 * vielen Stammdaten, damit die Detailspalte lang genug ist, um die Reihenfolge zu belegen; eine
 * mit SK I, damit die Sichtungszeile eine Zahl ungleich null trägt.
 */
async function seedeLage(page: Page, einsatzId: string): Promise<number> {
  const id = await seedePerson(page, einsatzId, {
    name: 'Handtest',
    vorname: 'Hanna',
    geschlecht: 'weiblich',
    alter_geschaetzt: 34,
    herkunft_adresse: 'Lindenweg 3, 30159 Hannover',
    antreff_ort: 'Sammelstelle Süd',
    melder_kontakt: 'Nachbar, 0511 123456',
    notiz: 'Brille fehlt',
  });
  await seedePerson(page, einsatzId, { antreff_ort: 'Brücke', sichtung: 'sk1' });
  return id;
}

/** Der Provider liest die gespeicherte Dichte beim Montieren, deshalb das Neuladen. */
async function stelleKomfortabel(page: Page) {
  await page.evaluate(([schluessel]) => window.localStorage.setItem(schluessel, 'komfortabel'), [
    DICHTE_SCHLUESSEL,
  ] as const);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'komfortabel');
}

function kopf(page: Page) {
  return page.locator('[data-lfh="seitenkopf-aktionen"]');
}

/** Liste bei 390: Zeile und Lagezahl im ersten Bildschirm, Nebenwege nur im Menü. */
async function pruefeListeAmHandy(page: Page, einsatzId: string, mitSchreibrecht: boolean) {
  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/personen`);
  await stelleKomfortabel(page);

  // Anker vor jeder Messung: beide gesäten Personen sind da (sonst mäße der Test den
  // Ladezustand). Die Liste steht jüngste zuerst, oben also R-002.
  const karten = page.locator('[data-lfh="datensicht-karte"]');
  await expect(karten).toHaveCount(2);
  const ersteZeile = karten.first();
  await expect(ersteZeile).toContainText('R-002');
  await expect(ersteZeile, 'erste Personenzeile ohne Scrollen ganz im Bild').toBeInViewport({
    ratio: 1,
  });

  const zeile = page.locator('[data-lfh="sichtungszeile"]');
  await expect(zeile.locator('[data-sichtung-zahl="sk1"]')).toHaveText(/1\s*SK I/);
  await expect(zeile.locator('[data-sichtung-summe]')).toHaveText(/2\s*gesamt/);
  await expect(zeile, 'Sichtungszeile ohne Scrollen ganz im Bild').toBeInViewport({ ratio: 1 });

  // Kopf: höchstens eine Primäraktion, Nebenwege nicht als Knopf.
  await expect(kopf(page).locator('.ant-btn-primary')).toHaveCount(mitSchreibrecht ? 1 : 0);
  if (mitSchreibrecht) {
    await expect(
      kopf(page).getByRole('button', { name: 'Betroffene erfassen', exact: true }),
    ).toHaveClass(/ant-btn-primary/);
    await expect(
      kopf(page).getByRole('button', { name: 'Vermisst melden', exact: true }),
    ).toBeVisible();
  }
  await expect(kopf(page).getByText('Drucken / als PDF')).toHaveCount(0);
  await expect(kopf(page).getByText('CSV exportieren')).toHaveCount(0);

  await kopf(page).getByRole('button', { name: NEBENWEGE }).click();
  const menue = page.getByRole('menu');
  await expect(menue.getByRole('menuitem', { name: 'CSV exportieren' })).toBeVisible();
  await menue.getByRole('menuitem', { name: 'Drucken / als PDF' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen/druck`));
}

/**
 * Detail: unter `lg` steht die medizinische Spalte über den Stammdaten. Gemessen an den zwei
 * Überschriften (Verlauf und „Stammdaten"); die Stammdaten stehen im Datenraster.
 */
async function pruefeDetail(page: Page, einsatzId: string, personId: number) {
  for (const viewport of [HANDSCHIRM, TABLET_HOCH]) {
    await page.setViewportSize(viewport);
    await page.goto(`/einsaetze/${einsatzId}/personen/${personId}`);
    await expect(page.getByRole('heading', { name: /Person R-\d{3}/ })).toBeVisible();
    const verlauf = page.getByText('Medizinischer Verlauf', { exact: true });
    const stammdaten = page.getByText('Stammdaten', { exact: true });
    await expect(verlauf).toBeVisible();
    await expect(stammdaten).toBeVisible();
    await expect(page.locator('dl[data-lfh="datenraster"]')).toContainText('Lindenweg 3');
    await expect(page.locator('.ant-descriptions')).toHaveCount(0);
    const oben = (await verlauf.boundingBox())!;
    const unten = (await stammdaten.boundingBox())!;
    expect(
      oben.y,
      `${viewport.width} px: medizinische Spalte (y ${oben.y}) über den Stammdaten (y ${unten.y})`,
    ).toBeLessThan(unten.y);
  }
}

test('Admin bei 390 px: Personenzeile und Sichtungszeile im ersten Bild, Nebenwege im Menü, Detail medizinisch zuerst', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Betroffene Handy ${Date.now()}`);
  const personId = await seedeLage(page, einsatzId);
  await pruefeListeAmHandy(page, einsatzId, true);
  await pruefeDetail(page, einsatzId, personId);
});

test('Beobachter bei 390 px: Personenzeile und Sichtungszeile im ersten Bild, Detail medizinisch zuerst', async ({
  page,
}) => {
  // Zusätzliche Anmeldung gegenüber dem Admin-Geschwister.
  test.slow();
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Betroffene Handy lesend ${Date.now()}`);
  const personId = await seedeLage(page, einsatzId);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  await pruefeListeAmHandy(page, einsatzId, false);
  await pruefeDetail(page, einsatzId, personId);
});

/**
 * Gegenprobe ab `md`: dieselbe Seite trägt Drucken und CSV als Knöpfe und keinen Auslöser — sonst
 * wären die Aussagen oben auch bei einer Seite grün, die die Nebenwege immer bündelt. Im Detail
 * liegen die Spalten ab `lg` nebeneinander, Stammdaten links.
 */
test('Gegenprobe bei 1180 px: Nebenwege als Knöpfe, Detailspalten nebeneinander', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Betroffene quer ${Date.now()}`);
  const personId = await seedeLage(page, einsatzId);

  await page.setViewportSize(TABLET_QUER);
  await page.goto(`/einsaetze/${einsatzId}/personen`);
  await expect(page.getByText('Handtest').first()).toBeVisible();
  await expect(kopf(page).getByRole('link', { name: 'Drucken / als PDF' })).toBeVisible();
  await expect(kopf(page).getByRole('button', { name: 'CSV exportieren' })).toBeVisible();
  await expect(kopf(page).getByRole('button', { name: NEBENWEGE })).toHaveCount(0);
  await expect(kopf(page).locator('.ant-btn-primary')).toHaveCount(1);

  await page.goto(`/einsaetze/${einsatzId}/personen/${personId}`);
  const verlauf = page.getByText('Medizinischer Verlauf', { exact: true });
  const stammdaten = page.getByText('Stammdaten', { exact: true });
  await expect(verlauf).toBeVisible();
  const links = (await stammdaten.boundingBox())!;
  const rechts = (await verlauf.boundingBox())!;
  expect(links.x, 'ab lg: Stammdaten links der medizinischen Spalte').toBeLessThan(rechts.x);
});
