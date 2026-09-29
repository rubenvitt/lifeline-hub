import { expect, test, type Page, type Locator } from '@playwright/test';

/**
 * Der Datensatz-Finder der Kommandopalette im echten Browser. Die Unit-Ebene belegt, dass
 * `navigate` mit dem richtigen Pfad gerufen wird; hier wird am ZIEL gemessen (Überschrift der
 * Detailseite, hervorgehobene ETB-Zeile) — ein Deeplink, der auf der Liste landet, wäre ein
 * Treffer ohne Wirkung.
 *
 *  1. Person über die Registriernummer — die Kennung kommt aus der Quittung der eben
 *     erfassten Person, nicht aus einer Annahme über die Nummernvergabe.
 *  2. ETB über `#` plus laufender Nummer — der einzige Deeplink, der ÄLTERE SEITEN NACHLÄDT,
 *     bis der Zieleintrag gefunden ist. Der Eintrag liegt deshalb hinter der ersten Seite,
 *     und das wird vor der Messung am Server geprüft.
 *
 * Seeding per `page.request`; kein `networkidle` (SSE-Strom).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Seitengröße der ETB-Chronologie (`api/etb.ts:SEITENGROESSE`). */
const ETB_SEITE = 100;

/**
 * Kleinste laufende Nummer für den ETB-Fall: `DATENSATZ_MINDESTZEICHEN = 2` bemisst den REST
 * hinter dem Präfix, bei `#7` holte der Finder nichts.
 */
const ZWEISTELLIG = 10;

// Dateiweit: der Puffer deckt den Vite-Kaltstart und das Säen der zweiten ETB-Seite.
test.setTimeout(180_000);

/** Eindeutiges Palette-Signal: das Suchfeld (Placeholder ist projektweit einmalig). */
function paletteInput(page: Page): Locator {
  return page.getByPlaceholder(/Suchen: Module/);
}

/**
 * Eine Datensatz-Option über Label UND Modul-Kontext: die Modulherkunft steht als Kontext
 * rechts in der Zeile (`aria-describedby`), der Name der Option ist das Label allein.
 */
function datensatzOption(page: Page, kontext: string, name: RegExp): Locator {
  return page
    .getByRole('option', { name })
    .filter({ has: page.locator('[id$="-kontext"]', { hasText: kontext }) });
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

/** Hartes Navigieren zu einem Modul + warten, bis die App (Kopfzeile) steht — sonst kommt
 *  der Hotkey vor der Listener-Bindung des Providers. */
async function zumModul(page: Page, id: string, modul: string) {
  await page.goto(`/einsaetze/${id}/${modul}`);
  await expect(page.locator('header').first()).toBeVisible();
}

/** Palette öffnen und den Suchbegriff setzen. */
async function suche(page: Page, begriff: string) {
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible();
  await paletteInput(page).fill(begriff);
}

test('findet eine eben erfasste Person über ihre Registriernummer und öffnet ihre Detailseite', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Finder Person ${Date.now()}`);

  // Über die Schnellaktion `?neu=1`, den Weg der Palette selbst.
  await page.goto(`/einsaetze/${einsatzId}/personen?neu=1`);
  await expect(page.getByRole('dialog', { name: 'Schnellerfassung' })).toBeVisible();
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();

  // Die Kennung kommt aus der QUITTUNG — das, was auf Papier landet und abgetippt wird.
  const quittung = page.getByText(/Erfasst als R-\d+/);
  await expect(quittung).toBeVisible();
  const kennung = (await quittung.innerText()).match(/R-\d+/)![0];

  // Weg von der Personenliste: dort wäre nicht zu unterscheiden, ob der Deeplink trägt.
  await zumModul(page, einsatzId, 'etb');

  await suche(page, kennung);
  const treffer = datensatzOption(page, 'Personen', new RegExp(kennung));
  await expect(treffer).toBeVisible();

  /*
   * Gegenaussage: der Zahlenzweig vergleicht die Nummer EXAKT, eine benachbarte, nicht
   * vergebene Nummer liefert keine Personenzeile. Steht bewusst NACH der Positivaussage —
   * die Liste ist dann im Cache, ein leeres Ergebnis ist kein laufender Abruf.
   */
  const nachbar = `R-${String(Number(kennung.slice(2)) + 1).padStart(3, '0')}`;
  await paletteInput(page).fill(nachbar);
  await expect(datensatzOption(page, 'Personen', /R-/)).toHaveCount(0);

  await paletteInput(page).fill(kennung);
  await expect(treffer).toBeVisible();
  await treffer.click();

  // Das Ziel ist der Datensatz, nicht die Liste — und er trägt die gesuchte Kennung.
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen/\\d+$`));
  await expect(page.getByRole('heading', { name: `Person ${kennung}` })).toBeVisible();
  await expect(paletteInput(page)).toBeHidden();
});

/**
 * Ein ETB-Eintrag, sequentiell: `lfd_nr` wird über `MAX(lfd_nr)+1` unter
 * `UNIQUE(einsatz_id, lfd_nr)` vergeben, gleichzeitige Anlagen kollidierten.
 */
async function seedeEtb(
  page: Page,
  einsatzId: string,
  inhalt: string,
): Promise<{ id: number; lfd_nr: number }> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
    data: { typ: 'meldung', inhalt, von: 'ELW 1', an: 'Leitstelle' },
  });
  expect(antwort.ok(), `Seeding ETB: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return antwort.json();
}

test('findet einen ETB-Eintrag jenseits der ersten Seite über „#" und Nummer und hebt ihn dort hervor', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Finder ETB ${Date.now()}`);

  // Vorlauf, damit die Zielnummer zweistellig ist (siehe ZWEISTELLIG).
  for (let i = 1; i < ZWEISTELLIG; i += 1) {
    await seedeEtb(page, einsatzId, `Vorlauf ${i}`);
  }

  const ZIELTEXT = 'Zielmeldung Kellerbrand Musterweg';
  const ziel = await seedeEtb(page, einsatzId, ZIELTEXT);
  expect(ziel.lfd_nr, 'die Zielnummer trägt zwei Ziffern').toBeGreaterThanOrEqual(ZWEISTELLIG);

  /*
   * Ein NAMENSVETTER auf der anderen Zahlenachse: eine Person mit derselben Nummer wie der
   * Zieleintrag. Ohne sie wäre „'#' bindet auf den ETB" nicht widerlegbar — eine reine Zahl
   * träfe sonst ohnehin nichts in der Fremdgruppe. Die lückenlose Vergabe ab 1 wird geprüft.
   */
  let letztePerson = { registrier_nr: 0 };
  for (let i = 1; i <= ziel.lfd_nr; i += 1) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personen`, { data: {} });
    expect(
      antwort.ok(),
      `Seeding Person: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    letztePerson = await antwort.json();
  }
  const zahl = ziel.lfd_nr;
  expect(letztePerson.registrier_nr, 'die Person trägt dieselbe Zahl wie der ETB-Eintrag').toBe(
    zahl,
  );
  const personKennung = `R-${String(zahl).padStart(3, '0')}`;

  // Genau so viele jüngere Einträge, dass der Zieleintrag aus der ersten Seite fällt.
  for (let i = 1; i <= ETB_SEITE; i += 1) {
    await seedeEtb(page, einsatzId, `Nachlauf ${i}`);
  }

  /*
   * VORBEDINGUNG, gemessen: der Zieleintrag liegt NICHT auf der ersten Seite — sonst bliebe
   * der Test grün, ohne den Nachladeweg je zu betreten.
   */
  const ersteSeite = await page.request.get(`/api/einsaetze/${einsatzId}/etb?limit=${ETB_SEITE}`);
  expect(ersteSeite.ok(), await ersteSeite.text()).toBeTruthy();
  const ids = ((await ersteSeite.json()) as { id: number }[]).map((e) => e.id);
  expect(ids, 'der Zieleintrag liegt hinter der ersten Seite').not.toContain(ziel.id);

  // Von einem anderen Modul aus, sonst wäre nicht zu unterscheiden, ob der Deeplink trägt.
  await zumModul(page, einsatzId, 'personen');

  const etbTreffer = datensatzOption(page, 'ETB', new RegExp(`#${zahl} · ${ZIELTEXT}`));
  const personTreffer = datensatzOption(page, 'Personen', new RegExp(personKennung));

  /*
   * Erst OHNE Präfix: dieselbe Zahl findet im Vorgabemodus BEIDE Datensätze — sonst wäre die
   * Abwesenheit der Personenzeile unten nicht von „gibt es nicht" zu unterscheiden.
   */
  await suche(page, String(zahl));
  await expect(etbTreffer).toBeVisible();
  await expect(personTreffer).toBeVisible();

  // … dann MIT: '#' bindet die Quellen auf den ETB. Beides im selben Zustand gemessen.
  await paletteInput(page).fill(`#${zahl}`);
  await expect(etbTreffer).toBeVisible();
  await expect(personTreffer).toHaveCount(0);

  await etbTreffer.click();

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/etb`));

  /*
   * Die Zeile ist DA und markiert: `zeile-hervorgehoben` setzt `EtbPage` erst, nachdem der
   * Eintrag in einer nachgeladenen Seite gefunden wurde — zugleich der Beleg für den
   * Nachladeweg. Genau einmal, sonst hinge die Hervorhebung an etwas anderem.
   */
  const hervorgehoben = page.locator('.zeile-hervorgehoben');
  await expect(hervorgehoben).toHaveCount(1);
  await expect(hervorgehoben).toContainText(ZIELTEXT);

  // `?eintrag=` ist nach dem Sprung geräumt (apply-then-clean), sonst schickte jedes Neuladen
  // die Seite erneut hinein.
  await expect(page).not.toHaveURL(/eintrag=/);
});
