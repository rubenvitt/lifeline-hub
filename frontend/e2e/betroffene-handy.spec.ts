import { expect, test, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';
import { einsatzAnlegen } from './einsatz-kern';

/**
 * Betroffene am Handschirm (LFH-963): Liste und Detail bei 390 × 844, das Detail auch bei 820
 * (Tablet hoch), je als Admin und als Beobachter. Gegenprobe bei 1180 (Tablet quer): dort stehen
 * die Nebenwege als Knöpfe. Das Detail beginnt in jeder Breite mit dem Patientenkopf (LLH-1094,
 * Spec `einsatztauglichkeit-layout`, „Das Personen-Detail beginnt mit dem Patientenkopf“); die
 * früheren Detailspalten nebeneinander gibt es nicht mehr, deshalb prüft auch die Gegenprobe den
 * Kopf über den Personendaten.
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
const ZUSTAND = 'Verdacht auf Unterkühlung';
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
 * vielen Stammdaten und einem Zustand / Verdacht, damit Kopf und Personendaten Inhalt tragen und
 * die Reihenfolge belegt ist; eine mit SK I, damit die Sichtungszeile eine Zahl ungleich null
 * trägt.
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
    zustand: ZUSTAND,
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

  // Zeilenaktionen (LLH-1130): mit Schreibrecht trägt die Karte den Sichtungsauslöser und im Fuß
  // das Zeilenmenü; ohne steht „Nur Ansicht“ mit Grund über der Liste, und beides fehlt.
  if (mitSchreibrecht) {
    await expect(
      ersteZeile.getByRole('button', { name: 'Sichtung R-002 ändern, aktuell SK I' }),
    ).toBeVisible();
    await expect(ersteZeile.getByRole('button', { name: 'Aktionen zu R-002' })).toBeVisible();
  } else {
    await expect(page.locator('[data-lfh="rechte-hinweis"]')).toContainText(
      'nur Einsatzleitung und Führungspersonal',
    );
    await expect(page.getByRole('button', { name: /^Aktionen zu R-/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Sichtung R-|sichten$/ })).toHaveCount(0);
  }

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

function patientenkopf(page: Page) {
  return page.getByRole('region', { name: 'Patientenkopf' });
}

/**
 * Oberkante des Patientenkopfs über der Oberkante der Personendaten (Spec
 * `einsatztauglichkeit-layout`). Die Personendaten stehen im Datenraster „Stammdaten".
 */
async function pruefeKopfUeberPersonendaten(page: Page, breite: number) {
  const pk = patientenkopf(page);
  const personendaten = page.getByText('Personendaten', { exact: true });
  await expect(pk.locator('[data-lfh="aufenthalt"]')).toBeVisible();
  await expect(personendaten).toBeVisible();
  await expect(page.locator('dl[aria-label="Stammdaten"]')).toContainText('Lindenweg 3');
  await expect(page.locator('.ant-descriptions')).toHaveCount(0);
  const oben = (await pk.boundingBox())!;
  const unten = (await personendaten.boundingBox())!;
  expect(
    oben.y,
    `${breite} px: Patientenkopf (y ${oben.y}) über den Personendaten (y ${unten.y})`,
  ).toBeLessThan(unten.y);
}

/**
 * Detail bei 390 und 820: der Kopf steht über den Personendaten. Bei 390 × 844 liegen Sichtung,
 * Zustand / Verdacht und Aufenthalt OHNE Scrollen ganz im ersten Bild (Spec `personen-detail`).
 */
async function pruefeDetail(page: Page, einsatzId: string, personId: number) {
  for (const viewport of [HANDSCHIRM, TABLET_HOCH]) {
    await page.setViewportSize(viewport);
    await page.goto(`/einsaetze/${einsatzId}/personen/${personId}`);
    await expect(page.getByRole('heading', { name: /Person R-\d{3}/ })).toBeVisible();
    const pk = patientenkopf(page);
    // Anker: der Kopf trägt die Daten des Detail-GETs.
    await expect(pk).toContainText(ZUSTAND);
    if (viewport === HANDSCHIRM) {
      const teile = [
        ['Sichtung', pk.locator('[data-lfh="sichtung"]')],
        ['Zustand / Verdacht', pk.getByText(ZUSTAND)],
        ['Aufenthalt', pk.locator('[data-lfh="aufenthalt"]')],
      ] as const;
      for (const [name, ort] of teile) {
        await expect(ort, `390 px: ${name} ohne Scrollen ganz im ersten Bild`).toBeInViewport({
          ratio: 1,
        });
      }
    }
    await pruefeKopfUeberPersonendaten(page, viewport.width);
  }
}

test('Admin bei 390 px: Personenzeile und Sichtungszeile im ersten Bild, Nebenwege im Menü, Detail beginnt mit dem Patientenkopf', async ({
  page,
}) => {
  // Liste, Druckroute und das Detail in zwei Breiten: allein lief er bei 28 s, unter zwei
  // Workern über die 30 s (kalter Vite-Bundle der Detailseite).
  test.slow();
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Betroffene Handy ${Date.now()}`);
  const personId = await seedeLage(page, einsatzId);
  await pruefeListeAmHandy(page, einsatzId, true);
  await pruefeDetail(page, einsatzId, personId);
});

test('Beobachter bei 390 px: Personenzeile und Sichtungszeile im ersten Bild, Detail beginnt mit dem Patientenkopf', async ({
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
 * Kartenform unter `md` (LLH-1130, Spec `betroffene-lagedaten`): die Nachsichtung geht auch in
 * der Karte in drei Tipps (Sichtungsfeld, Fläche, „Übernehmen“), das Zeilenmenü steht in der
 * Karte (rechts neben dem Inhalt, damit die erste Karte im ersten Bild bleibt) und führt den
 * Verortungsauftrag mit Rückweg auf die Lagekarte.
 */
test('Admin bei 390 px: Nachsichtung in der Karte, Zeilenmenü in der Karte', async ({ page }) => {
  test.slow();
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Betroffene Karte ${Date.now()}`);
  await seedeLage(page, einsatzId);
  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/personen`);
  await stelleKomfortabel(page);

  const karten = page.locator('[data-lfh="datensicht-karte"]');
  await expect(karten).toHaveCount(2);
  const karte = karten.filter({ hasText: 'R-002' });

  await karte.getByRole('button', { name: 'Sichtung R-002 ändern, aktuell SK I' }).tap();
  const flaeche = page.getByRole('region', { name: 'Sichtung R-002' });
  await flaeche.getByRole('radio', { name: /^SK II,/ }).tap();
  await flaeche.getByRole('button', { name: 'Übernehmen' }).tap();
  await expect(
    karte.getByRole('button', { name: 'Sichtung R-002 ändern, aktuell SK II' }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen$`));

  // Das Menü steht in der Karte, ganz im Bild (klicken statt nur sehen, LFH-355).
  const ausloeser = karte.getByRole('button', { name: 'Aktionen zu R-002' });
  await expect(ausloeser).toBeInViewport({ ratio: 1 });
  await ausloeser.tap();
  const menue = page.getByRole('menu');
  await expect(menue.getByRole('menuitem')).toHaveText([
    'Sichten',
    'Verbleib erfassen',
    'Auf Lagekarte verorten',
  ]);
  await menue.getByRole('menuitem', { name: 'Auf Lagekarte verorten' }).tap();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lagekarte\\?platzieren=person`));
});

/**
 * Gegenprobe ab `md`: dieselbe Seite trägt Drucken und CSV als Knöpfe und keinen Auslöser — sonst
 * wären die Aussagen oben auch bei einer Seite grün, die die Nebenwege immer bündelt. Die frühere
 * Gegenprobe „Detailspalten nebeneinander" entfällt: das Detail hat eine Spalte und beginnt auch
 * quer mit dem Patientenkopf (Spec `einsatztauglichkeit-layout`).
 */
test('Gegenprobe bei 1180 px: Nebenwege als Knöpfe, Patientenkopf über den Personendaten', async ({
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
  await expect(patientenkopf(page)).toContainText(ZUSTAND);
  await pruefeKopfUeberPersonendaten(page, TABLET_QUER.width);
});
