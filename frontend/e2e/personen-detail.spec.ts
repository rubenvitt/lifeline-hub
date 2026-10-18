import { expect, test, type Page } from '@playwright/test';
import { waehleStehend } from './auswahl-kern';
import { einsatzAnlegen } from './einsatz-kern';
import { wechsleZuRolle } from './rollen-kern';

// Die Personen-Detailseite als Vollseiten-Route (LLH-1094/LLH-1129, Spec `personen-detail`):
// eine Spalte mit dem Patientenkopf zuerst, Nachsichten ohne Dialog, Bezüge als eine Liste.
// jsdom rechnet kein Layout; „ohne Bildlauf" misst nur der Browser.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Die Breiten, in denen der Kopf ganz im ersten Bild stehen muss (Spec, „Patientenkopf …"). */
const TABLET_QUER = { width: 1280, height: 800 };
const DESKTOP = { width: 1440, height: 900 };

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Seeding per `page.request` (Cookie-Jar geteilt). */
async function senden<T = { id: number }>(page: Page, pfad: string, data: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

/** Einsatz über die API — diese Specs prüfen nicht das Anlegen. */
async function einsatzPerApi(page: Page, name: string): Promise<number> {
  return (await senden(page, '/api/einsaetze', { bezeichnung: name })).id;
}

function patientenkopf(page: Page) {
  return page.getByRole('region', { name: 'Patientenkopf' });
}

test('Personen: Liste navigiert zur Detail-Vollseite, die mit dem Patientenkopf beginnt', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Personen ${Date.now()}`);

  await page.goto(`/einsaetze/${einsatzId}/personen`);
  // Der Seitentitel heißt „Betroffene"; die Route bleibt `personen`.
  await expect(page.getByRole('heading', { name: 'Betroffene', exact: true })).toBeVisible();

  // Person per Schnellerfassung anlegen (Modal: okText „Erfassen").
  await page.getByRole('button', { name: 'Betroffene erfassen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Name und Vorname liegen unter „Weitere Angaben" (Feldbudget: sichtbar sind Sichtung,
  // Geschlecht, Alter, Fundort). Teiltreffer, weil ältere antd-Fassungen das Pfeil-Icon im
  // Zugangsnamen trugen.
  await dialog.getByRole('button', { name: /Weitere Angaben/ }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Mustermann');
  await dialog.getByLabel('Vorname', { exact: true }).fill('Max');
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();

  // Erste Person bekommt Registriernummer R-001 und erscheint in der Liste.
  await expect(page.getByText('Mustermann, Max')).toBeVisible();

  // Klick auf die Zeile → Detail-Vollseite.
  await page.getByText('Mustermann, Max').click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen/\\d+`));
  await expect(page.getByRole('heading', { name: /Person R-001/ })).toBeVisible();

  // Eine Spalte: Kopf, Verlauf, Personendaten untereinander, nichts in Reitern. Die alte
  // Überschrift „Medizinischer Verlauf" der rechten Spalte gibt es nicht mehr.
  const kopf = patientenkopf(page);
  const verlauf = page.getByText('Verlauf', { exact: true });
  const personendaten = page.getByText('Personendaten', { exact: true });
  await expect(kopf).toBeVisible();
  await expect(verlauf).toBeVisible();
  await expect(personendaten).toBeVisible();
  await expect(page.locator('dl[aria-label="Stammdaten"]')).toContainText('Mustermann');
  await expect(page.getByText('Medizinischer Verlauf', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Verlauf|Personendaten/ })).toHaveCount(0);
  const y = async (l: typeof kopf) => (await l.boundingBox())!.y;
  const [kopfY, verlaufY, datenY] = [await y(kopf), await y(verlauf), await y(personendaten)];
  expect(kopfY, `Kopf (y ${kopfY}) über dem Verlauf (y ${verlaufY})`).toBeLessThan(verlaufY);
  expect(verlaufY, `Verlauf (y ${verlaufY}) über den Personendaten (y ${datenY})`).toBeLessThan(
    datenY,
  );

  // Zurück zur Liste über den Breadcrumb.
  await page.getByRole('link', { name: 'Betroffene', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Betroffene', exact: true })).toBeVisible();
});

/**
 * Spec-Szenario „Patient im Wartebereich am Tablet": SK II, Zustand / Verdacht, Wartebereich der
 * UHS „Turnhalle", dazu eine Verlaufsnotiz. Gemessen OHNE vorheriges Scrollen mit
 * `toBeInViewport({ ratio: 1 })` (`frontend/AGENTS.md`: Höhenketten nie mit `toBeVisible()`),
 * als Admin (Kopf mit Bedienung, also am höchsten) und als Beobachter (LFH-435).
 */
test('Patientenkopf bei 1280 × 800 und 1440 × 900 ohne Bildlauf ganz im Bild, als Admin und als Beobachter', async ({
  page,
}) => {
  test.slow();
  await anmelden(page);
  const e = await einsatzPerApi(page, `E2E Patientenkopf ${Date.now()}`);
  const uhs = await senden(page, `/api/einsaetze/${e}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'Turnhalle',
  });
  await senden(page, `/api/einsaetze/${e}/uhs/${uhs.id}/status`, { status: 'aktiv' });
  const person = await senden(page, `/api/einsaetze/${e}/personen`, {
    name: 'Kopftest',
    vorname: 'Karla',
    geschlecht: 'weiblich',
    alter_geschaetzt: 78,
    antreff_ort: 'Marktplatz',
    herkunft_adresse: 'Lindenweg 3, 30159 Hannover',
    melder_kontakt: 'Tochter, 0511 123456',
    sichtung: 'sk2',
    zustand: 'Verdacht auf Hüftfraktur',
    uhs_id: uhs.id,
  });
  await senden(page, `/api/einsaetze/${e}/personen/${person.id}/notizen`, {
    text: 'Schmerzmittel gegeben',
  });

  const pruefeKopf = async (rolle: string) => {
    for (const viewport of [TABLET_QUER, DESKTOP]) {
      await page.setViewportSize(viewport);
      await page.goto(`/einsaetze/${e}/personen/${person.id}`);
      const kopf = patientenkopf(page);
      // Anker vor jeder Messung: der Kopf trägt die Daten des Detail-GETs.
      await expect(kopf.locator('[data-lfh="aufenthalt"]')).toContainText(
        'Turnhalle · Wartebereich · seit',
      );
      const was = `${rolle}, ${viewport.width} × ${viewport.height}`;
      const teile = [
        ['Sichtung', kopf.locator('[data-lfh="sichtung"]'), /SK II · schwer/],
        [
          'Sichtungszeit',
          kopf.locator('[data-lfh="sichtung-zeit"]'),
          /gesichtet .+ · (gerade eben|vor )/,
        ],
        ['Zustand / Verdacht', kopf.getByText('Verdacht auf Hüftfraktur'), /Hüftfraktur/],
        ['Aufenthalt', kopf.locator('[data-lfh="aufenthalt"]'), /Turnhalle/],
        ['letzte Notiz', kopf.locator('[data-lfh="letzte-notiz"]'), /Schmerzmittel gegeben/],
      ] as const;
      for (const [name, ort, text] of teile) {
        await expect(ort, `${was}: ${name}`).toHaveText(text);
        await expect(ort, `${was}: ${name} ohne Bildlauf ganz im Bild`).toBeInViewport({
          ratio: 1,
        });
      }
      expect(await page.evaluate(() => window.scrollY), `${was}: nichts gescrollt`).toBe(0);
    }
  };

  await pruefeKopf('Admin');
  // Vorbedingung des Admin-Zweigs: der Kopf trägt Bedienung (Notizzeile).
  await expect(patientenkopf(page).getByRole('button', { name: 'Notiz anlegen' })).toBeVisible();

  await wechsleZuRolle(page, 'beobachter', String(e));
  await pruefeKopf('Beobachter');
  // Vorbedingung des Lesezweigs: keine Bedienung im Kopf.
  await expect(patientenkopf(page).getByRole('button', { name: 'Notiz anlegen' })).toHaveCount(0);
  await expect(patientenkopf(page).getByRole('button', { name: /^Nachsichten/ })).toHaveCount(0);
});

test('Nachsichten im Patientenkopf ohne Dialog', async ({ page }) => {
  await anmelden(page);
  const e = await einsatzPerApi(page, `E2E Nachsichten ${Date.now()}`);
  const person = await senden(page, `/api/einsaetze/${e}/personen`, {
    antreff_ort: 'Brücke',
    sichtung: 'sk2',
  });

  await page.goto(`/einsaetze/${e}/personen/${person.id}`);
  const kopf = patientenkopf(page);
  await kopf.getByRole('button', { name: 'Nachsichten, aktuell SK II · schwer' }).click();

  // Die Wahl klappt im Kopf auf — kein Dialog.
  const paneel = page.getByRole('region', { name: 'Sichtung erfassen' });
  await expect(paneel).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await paneel.getByRole('radio', { name: 'SK I, akut' }).click();
  await expect(paneel.getByRole('radio', { name: 'SK I, akut' })).toBeChecked();
  await paneel.getByRole('button', { name: 'Übernehmen' }).click();

  // Nach dem Speichern klappt das Paneel zu, der Kopf zeigt die neue Kategorie mit Zeit.
  await expect(paneel).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    kopf.getByRole('button', { name: 'Nachsichten, aktuell SK I · akut' }),
  ).toBeVisible();
  await expect(kopf.locator('[data-lfh="sichtung-zeit"]')).toContainText('gesichtet');

  // Der Server trägt die Sichtung (sonst zeigte der Kopf nur einen Zwischenstand).
  const detail = await page.request.get(`/api/einsaetze/${e}/personen/${person.id}`);
  expect(detail.ok()).toBeTruthy();
  expect(((await detail.json()) as { aktuelle_sichtung: string }).aktuelle_sichtung).toBe('sk1');
});

test('Bezug hinzufügen: ein Tier über die gemeinsame Suche, die Liste sagt „Halter von …"', async ({
  page,
}) => {
  await anmelden(page);
  const e = await einsatzPerApi(page, `E2E Bezüge ${Date.now()}`);
  const person = await senden(page, `/api/einsaetze/${e}/personen`, {
    name: 'Halterin',
    sichtung: 'sk3',
  });
  const tier = await senden<{ id: number; registrier_nr: number }>(
    page,
    `/api/einsaetze/${e}/tiere`,
    { spezies: 'hund', rufname: 'Bello' },
  );
  const kennung = `T-${String(tier.registrier_nr).padStart(3, '0')}`;

  await page.goto(`/einsaetze/${e}/personen/${person.id}`);
  await expect(patientenkopf(page)).toBeVisible();
  // Eingeklappt; lädt erst beim Aufklappen.
  await page.getByRole('button', { name: 'Bezüge', exact: true }).click();
  const bezuege = page.locator('[data-lfh="bezuege"]');
  await expect(bezuege).toContainText('Bezüge 0');

  await bezuege.getByRole('button', { name: 'Bezug hinzufügen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Bezug hinzufügen' });
  await expect(dialog).toBeVisible();
  const suche = dialog.getByRole('combobox', { name: 'Tier oder Schaden' });
  await suche.click();
  await suche.fill('Bello');
  await waehleStehend(page, `${kennung} · Hund · „Bello“`);
  await dialog.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(bezuege).toContainText('Bezüge 1');
  await expect(
    bezuege.getByRole('link', { name: `Halter von ${kennung} · Hund „Bello“` }),
  ).toBeVisible();
  await expect(bezuege.getByRole('button', { name: `Bezug zu ${kennung} lösen` })).toBeVisible();

  // Die Gegenrichtung: das Tier nennt die Person als Halter.
  const t = await page.request.get(`/api/einsaetze/${e}/tiere/${tier.id}`);
  expect(t.ok(), await t.text()).toBeTruthy();
  expect(((await t.json()) as { halter_person_id: number | null }).halter_person_id).toBe(
    person.id,
  );
});
