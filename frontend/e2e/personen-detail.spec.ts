import { expect, test, type Page } from '@playwright/test';
import { waehleIn, waehleStehend } from './auswahl-kern';
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

/** PATCH per `page.request` (PAT-Nummer und Kontamination gehen über den PATCH der Person). */
async function aendern(page: Page, pfad: string, data: unknown) {
  const antwort = await page.request.patch(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
}

/**
 * Spec-Szenario „Voller PAT-Kern bei 1280 × 800“ (Change `y18v58dt-pat-kern`, design.md D14):
 * Transport „dringlich · liegend · Unfallchirurgie“, PAT-Nummer, Kontamination, drei Maßnahmen
 * und vier Verletzungen, dazu Sichtung, Zustand, Aufenthalt und Notiz. Alles steht ohne Bildlauf
 * im ersten Bild, die vierte Verletzung als „+ 1 weitere“, ab `md` mit der kleinen Figur. Wie oben
 * als Admin (Kopf mit Bedienung, am höchsten) und als Beobachter (LFH-435).
 *
 * Mutationsprobe: in `Patientenkopf.tsx` `zweiSpalten` immer falsch (Raster gestapelt) → bei
 * 1280 × 800 steht die letzte Notiz als Admin unter dem Rand (rot, gemessen).
 */
test('Voller PAT-Kern bei 1280 × 800 und 1440 × 900 ohne Bildlauf, als Admin und als Beobachter', async ({
  page,
}) => {
  test.slow();
  await anmelden(page);
  const e = await einsatzPerApi(page, `E2E PAT-Kern ${Date.now()}`);
  const uhs = await senden(page, `/api/einsaetze/${e}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'Turnhalle',
  });
  await senden(page, `/api/einsaetze/${e}/uhs/${uhs.id}/status`, { status: 'aktiv' });
  const person = await senden(page, `/api/einsaetze/${e}/personen`, {
    name: 'Kerntest',
    vorname: 'Kai',
    geschlecht: 'maennlich',
    alter_geschaetzt: 41,
    antreff_ort: 'Bahnsteig 2',
    sichtung: 'sk2',
    zustand: 'Verdacht auf Unterarmfraktur links',
    uhs_id: uhs.id,
  });
  const pfad = `/api/einsaetze/${e}/personen/${person.id}`;
  await aendern(page, pfad, { pat_nummer: 'A-4711', kontamination: true });
  await senden(page, `${pfad}/transport`, {
    prioritaet: 'dringlich',
    art: 'liegend',
    fachrichtung: 'unfallchirurgie',
  });
  for (const art of ['zugang', 'sauerstoff', 'immobilisation']) {
    await senden(page, `${pfad}/massnahmen`, { art });
  }
  for (const verletzung of [
    { ansicht: 'vorn', region: 'kopf', art: 'wunde_blutung' },
    { ansicht: 'vorn', region: 'unterarm_l', art: 'fraktur_verdacht', schwere: 'schwer' },
    { ansicht: 'vorn', region: 'thorax', art: 'prellung_schwellung' },
    { ansicht: 'hinten', region: 'ruecken', art: 'schmerz' },
  ]) {
    await senden(page, `${pfad}/verletzungen`, verletzung);
  }
  await senden(page, `${pfad}/notizen`, { text: 'Arm geschient' });

  const pruefeKopf = async (rolle: string) => {
    for (const viewport of [TABLET_QUER, DESKTOP]) {
      await page.setViewportSize(viewport);
      await page.goto(`/einsaetze/${e}/personen/${person.id}`);
      const kopf = patientenkopf(page);
      // Anker vor jeder Messung: der Kopf trägt die Daten des Detail-GETs.
      await expect(kopf.locator('[data-lfh="transport"]')).toContainText(
        'dringlich · liegend · Unfallchirurgie',
      );
      const was = `${rolle}, ${viewport.width} × ${viewport.height}`;
      const teile = [
        ['Sichtung', kopf.locator('[data-lfh="sichtung"]'), /SK II · schwer/],
        ['Zustand / Verdacht', kopf.getByText('Verdacht auf Unterarmfraktur links'), /Unterarm/],
        ['Aufenthalt', kopf.locator('[data-lfh="aufenthalt"]'), /Turnhalle · Wartebereich/],
        [
          'Transport',
          kopf.locator('[data-lfh="transport"]'),
          /dringlich · liegend · Unfallchirurgie/,
        ],
        ['PAT-Nummer', kopf.getByText('PAT A-4711', { exact: true }), /PAT A-4711/],
        ['Kontamination', kopf.getByText('kontaminiert', { exact: true }), /kontaminiert/],
        ['Maßnahmen', kopf.locator('[data-lfh="massnahmen"]'), /Zugang/],
        ['Verletzungen', kopf.locator('[data-lfh="verletzungen"]'), /\+ 1 weitere/],
        ['kleine Figur', kopf.locator('[data-lfh="koerperfigur"]').first(), /.*/],
        ['letzte Notiz', kopf.locator('[data-lfh="letzte-notiz"]'), /Arm geschient/],
      ] as const;
      for (const [name, ort, text] of teile) {
        await expect(ort, `${was}: ${name}`).toHaveText(text);
        await expect(ort, `${was}: ${name} ohne Bildlauf ganz im Bild`).toBeInViewport({
          ratio: 1,
        });
      }
      const massnahmen = kopf.locator('[data-lfh="massnahmen"]');
      for (const m of ['Zugang', 'Sauerstoff', 'Immobilisation']) {
        await expect(massnahmen, `${was}: Maßnahme ${m}`).toContainText(m);
      }
      expect(await page.evaluate(() => window.scrollY), `${was}: nichts gescrollt`).toBe(0);
    }
  };

  await pruefeKopf('Admin');
  // Vorbedingung des Admin-Zweigs: der Kopf trägt die Bedienung der neuen Paneele.
  for (const knopf of ['Transport festlegen', 'Maßnahme erfassen', 'Verletzung markieren']) {
    await expect(patientenkopf(page).getByRole('button', { name: knopf })).toBeVisible();
  }

  await wechsleZuRolle(page, 'beobachter', String(e));
  await pruefeKopf('Beobachter');
  // Vorbedingung des Lesezweigs: keine Bedienung im Kopf.
  for (const knopf of ['Transport festlegen', 'Maßnahme erfassen', 'Verletzung markieren']) {
    await expect(patientenkopf(page).getByRole('button', { name: knopf })).toHaveCount(0);
  }
  await expect(patientenkopf(page).getByRole('button', { name: /PAT-Nummer/ })).toHaveCount(0);
});

/**
 * Die drei neuen Paneele im Browser (Spec `personen-detail`, „Sichten, Verbleib und Notiz ohne
 * Dialog“; Specs `personen-transport`, `personen-massnahmen`, `koerperschema`): Transport
 * festlegen, Maßnahme erfassen, eine Verletzung mit zwei Tipps markieren und am Sternchen
 * aufheben. Jeder Schritt ohne Dialog, der Server trägt den Stand, das ETB nennt nur die
 * Priorität.
 *
 * Mutationsprobe: in `Koerperschema.tsx` `onRegion` ins Leere geleitet → der Tipp auf „Unterarm
 * links, vorn“ öffnet keine Wahl der Art (rot, gemessen).
 */
test('Transport festlegen, Maßnahme erfassen, Verletzung markieren und aufheben', async ({
  page,
}) => {
  await anmelden(page);
  const e = await einsatzPerApi(page, `E2E PAT-Paneele ${Date.now()}`);
  const person = await senden<{ id: number; registrier_nr: number }>(
    page,
    `/api/einsaetze/${e}/personen`,
    { name: 'Paneeltest', geschlecht: 'weiblich', sichtung: 'sk2' },
  );
  const pfad = `/api/einsaetze/${e}/personen/${person.id}`;
  await page.setViewportSize(TABLET_QUER);
  await page.goto(`/einsaetze/${e}/personen/${person.id}`);
  const kopf = patientenkopf(page);
  await expect(kopf.locator('[data-lfh="transport"]')).toHaveText('kein Transport');

  // ── Transport festlegen.
  await kopf.getByRole('button', { name: 'Transport festlegen' }).click();
  const transport = page.getByRole('region', { name: 'Transport festlegen' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await transport
    .getByRole('radiogroup', { name: 'Priorität' })
    .getByRole('radio', { name: 'dringlich' })
    .click();
  await transport
    .getByRole('radiogroup', { name: 'Art' })
    .getByRole('radio', { name: 'liegend' })
    .click();
  await waehleIn(transport.getByRole('combobox', { name: 'Fachrichtung' }), 'Unfallchirurgie');
  await transport.getByRole('button', { name: 'Transport festlegen' }).click();
  await expect(transport).toHaveCount(0);
  await expect(kopf.locator('[data-lfh="transport"]')).toContainText(
    'dringlich · liegend · Unfallchirurgie',
  );

  // ── Maßnahme erfassen.
  await kopf.getByRole('button', { name: 'Maßnahme erfassen' }).click();
  const massnahme = page.getByRole('region', { name: 'Maßnahme erfassen' });
  await massnahme.getByRole('radio', { name: 'Zugang' }).click();
  await massnahme.getByRole('button', { name: 'Maßnahme erfassen' }).click();
  await expect(massnahme).toHaveCount(0);
  await expect(kopf.locator('[data-lfh="massnahmen"]')).toContainText('Zugang');

  // ── Verletzung markieren: erster Tipp auf die Region, zweiter auf die Art.
  await kopf.getByRole('button', { name: 'Verletzung markieren' }).click();
  const verletzung = page.getByRole('region', { name: 'Verletzung markieren' });
  await verletzung.getByRole('button', { name: 'Unterarm links, vorn' }).click();
  await verletzung
    .getByRole('group', { name: 'Verletzung an Unterarm links, vorn' })
    .getByRole('radio', { name: 'Fraktur-Verdacht' })
    .click();
  const stern = verletzung.getByRole('button', {
    name: 'Verletzung 1, Unterarm links, vorn · Fraktur-Verdacht',
  });
  await expect(stern).toBeVisible();
  await expect(verletzung.getByRole('list', { name: 'Verletzungen' })).toContainText(
    'Unterarm links, vorn · Fraktur-Verdacht',
  );
  await expect(kopf.locator('[data-lfh="verletzungen"]')).toContainText('Unterarm links, vorn');

  // ── Aufheben am Sternchen: Tipp auf das Sternchen, dann „Aufheben“.
  await stern.click();
  await verletzung
    .getByRole('group', { name: 'Verletzung 1' })
    .getByRole('button', { name: 'Aufheben' })
    .click();
  await expect(stern).toHaveCount(0);
  await expect(verletzung.getByText('keine Verletzungen')).toBeVisible();
  await verletzung.getByRole('button', { name: 'Schließen' }).click();
  await expect(verletzung).toHaveCount(0);

  // Der Server trägt den Stand: Transport im Cache, die Maßnahme gilt, die Verletzung ist
  // aufgehoben und bleibt im Verlauf.
  const detail = (await (await page.request.get(pfad)).json()) as {
    transport_prioritaet: string | null;
    transport_art: string | null;
    transport_fachrichtung: string | null;
    // `aufgehoben_at` fehlt, solange ein Eintrag gilt.
    massnahmen: { art: string; aufgehoben_at?: string }[];
    verletzungen: { region: string; art: string; aufgehoben_at?: string }[];
  };
  expect([
    detail.transport_prioritaet,
    detail.transport_art,
    detail.transport_fachrichtung,
  ]).toEqual(['dringlich', 'liegend', 'unfallchirurgie']);
  expect(detail.massnahmen.map((m) => [m.art, m.aufgehoben_at])).toEqual([['zugang', undefined]]);
  expect(detail.verletzungen).toHaveLength(1);
  expect(detail.verletzungen[0]).toMatchObject({ region: 'unterarm_l', art: 'fraktur_verdacht' });
  expect(detail.verletzungen[0].aufgehoben_at).toEqual(expect.any(String));

  // Das ETB nennt nur die Priorität, pseudonym (Spec `personen-transport`).
  const etb = (await (await page.request.get(`/api/einsaetze/${e}/etb`)).json()) as {
    inhalt: string;
  }[];
  const kennung = `R-${String(person.registrier_nr).padStart(3, '0')}`;
  expect(etb.map((x) => x.inhalt)).toContain(`Person ${kennung}: Transportpriorität dringlich`);
  expect(etb.some((x) => /liegend|Unfallchirurgie|Zugang|Fraktur|Unterarm/.test(x.inhalt))).toBe(
    false,
  );
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
