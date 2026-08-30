import { expect, test, type Page, type Locator } from '@playwright/test';

/**
 * Der Datensatz-Finder der Kommandopalette im ECHTEN Browser (LFH-391 · C4).
 *
 * WARUM NICHT IN VITEST: die Unit-Ebene kann belegen, dass `navigate` mit dem richtigen
 * Pfad gerufen wird — `useDatensaetze.test.tsx` und `datensaetze.test.ts` tun genau das.
 * Sie kann NICHT belegen, dass die Zielseite den Datensatz danach auch zeigt, und daran
 * hängt der Nutzen des ganzen Tickets: ein Deeplink, der auf der Liste landet statt am
 * Datensatz, ist ein Treffer ohne Wirkung. Gemessen wird deshalb beide Male am ZIEL —
 * die Überschrift der Personen-Detailseite bzw. die hervorgehobene ETB-Zeile —, nicht an
 * der URL allein.
 *
 * DIE ZWEI FÄLLE SIND NICHT DERSELBE FALL ZWEIMAL:
 *
 *  1. **Person über die Registriernummer.** Sie prüft den Zahlenzweig gegen einen
 *     Datensatz, den dieselbe Sitzung eben über die Oberfläche erfasst hat — die Kennung
 *     kommt aus der Quittung, nicht aus einer Annahme über die Nummernvergabe.
 *  2. **ETB über `#` plus laufender Nummer.** Der ETB ist der einzige Deeplink, der
 *     ÄLTERE SEITEN NACHLÄDT, bis der Zieleintrag gefunden ist (`EtbPage.tsx`, Effekt zu
 *     `?eintrag=`). Das ist im Browser eine andere Aussage als in jsdom: dort hängt sie an
 *     einer Kette aus `useInfiniteQuery`, Effekt-Wiedereintritt und `hasNextPage`. Der
 *     Fall ist deshalb bewusst SO gesät, dass der Zieleintrag hinter der ersten Seite
 *     liegt — und dass er das tut, wird vor der Messung am Server geprüft statt geglaubt.
 *
 * SEEDING PER `page.request`: die Session ist Cookie-basiert, `page.request` teilt den
 * Cookie-Jar des Kontexts (Vorgehen aus `etb-chronologie.spec.ts`).
 *
 * KEIN `waitForLoadState('networkidle')`: auf Einsatzrouten bleibt ein SSE-Strom offen,
 * die Bedingung tritt nie sauber ein (LFH-385). Die Zusicherungen warten inhaltlich.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Seitengröße der ETB-Chronologie (`api/etb.ts:SEITENGROESSE`). */
const ETB_SEITE = 100;

/**
 * Kleinste laufende Nummer, mit der der ETB-Fall überhaupt gefahren werden kann.
 *
 * `DATENSATZ_MINDESTZEICHEN = 2` bemisst den REST hinter dem Präfix: bei `#7` bleibt ein
 * Zeichen, der Finder holt nichts und die Palette sagt das auch so. Der Zieleintrag
 * bekommt deshalb einen Vorlauf, damit seine Nummer zweistellig ist.
 */
const ZWEISTELLIG = 10;

/*
 * Gilt für BEIDE Fälle der Datei, nicht nur für den ETB-Fall darunter: `test.setTimeout`
 * auf Modulebene ist dateiweit. Gemessen brauchen die zwei Fälle 8 bzw. 9,5 s (das Säen
 * der zweiten ETB-Seite kostet gut hundert Anlagen und liegt darin) — die Vorgabe von 30 s
 * reicht also. Der Puffer deckt den Vite-Kaltstart der Detail- und Listenrouten, der beim
 * ersten Lauf je Datei mitbezahlt wird. Bauform aus `lagebericht-schmal.spec.ts`.
 */
test.setTimeout(180_000);

/** Eindeutiges Palette-Signal: das Suchfeld (Placeholder ist projektweit einmalig). */
function paletteInput(page: Page): Locator {
  return page.getByPlaceholder(/Suchen: Module/);
}

// Login-/Anlege-Helfer aus `command-palette.spec.ts` kopiert — es gibt (noch) kein
// geteiltes e2e-Hilfsmodul (gleichlautend in sechs Bestands-Specs vermerkt).
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

  // Über die Schnellaktion, nicht über den Knopf: `?neu=1` ist der Weg, den die Palette
  // selbst nimmt, und der Datensatz soll aus derselben Oberfläche stammen, die ihn nachher
  // wiederfinden muss.
  await page.goto(`/einsaetze/${einsatzId}/personen?neu=1`);
  await expect(page.getByRole('dialog', { name: 'Schnellerfassung' })).toBeVisible();
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();

  // Die Kennung kommt aus der QUITTUNG, nicht aus einer Annahme über die Nummernvergabe:
  // sie ist das, was auf dem Papier landet und abgetippt wird.
  const quittung = page.getByText(/Erfasst als R-\d+/);
  await expect(quittung).toBeVisible();
  const kennung = (await quittung.innerText()).match(/R-\d+/)![0];

  // Weg von der Personenliste: von dort aus wäre nicht zu unterscheiden, ob der Deeplink
  // trägt oder die Seite ohnehin schon die richtige war.
  await zumModul(page, einsatzId, 'etb');

  await suche(page, kennung);
  const treffer = page.getByRole('option', { name: new RegExp(`Personen · ${kennung}`) });
  await expect(treffer).toBeVisible();

  /*
   * Die Gegenaussage, und sie ist mehr als eine Formalie: der Zahlenzweig vergleicht die
   * Nummer EXAKT (`datensaetze.ts`, `kand.nummer !== zahl.nummer`), er sucht keine
   * Teilzeichenkette und lässt Fuse nicht an eine Kennung. Eine benachbarte, nicht
   * vergebene Nummer darf deshalb keine Personenzeile liefern — sonst wäre „R-042 findet
   * die Person 42" von „R-042 findet irgendetwas mit 42" nicht zu unterscheiden.
   *
   * Die Abwesenheit steht bewusst NACH der Positivaussage: die Personenliste ist damit
   * geladen und im Cache, ein leeres Ergebnis kann also nicht bloß ein noch laufender
   * Abruf sein.
   */
  const nachbar = `R-${String(Number(kennung.slice(2)) + 1).padStart(3, '0')}`;
  await paletteInput(page).fill(nachbar);
  await expect(page.getByRole('option', { name: /Personen · R-/ })).toHaveCount(0);

  await paletteInput(page).fill(kennung);
  await expect(treffer).toBeVisible();
  await treffer.click();

  // Das eigentliche Ziel dieses Falls: nicht die Liste, sondern der Datensatz — und er
  // trägt die Kennung, die gesucht wurde.
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen/\\d+$`));
  await expect(page.getByRole('heading', { name: `Person ${kennung}` })).toBeVisible();
  await expect(paletteInput(page)).toBeHidden();
});

/**
 * Ein ETB-Eintrag, sequentiell. Parallel geht nicht: `lfd_nr` wird über
 * `COALESCE(MAX(lfd_nr)+1)` vergeben und liegt unter `UNIQUE(einsatz_id, lfd_nr)`
 * (`migrations/0090`) — gleichzeitige Anlagen kollidierten.
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
   * Ein NAMENSVETTER auf der anderen Zahlenachse: eine Person, deren Registriernummer
   * dieselbe Zahl trägt wie der Zieleintrag seine laufende. Ohne sie wäre die Aussage
   * „'#' bindet auf den ETB" nicht widerlegbar — bei einer reinen Zahl im Suchfeld matcht
   * kein Modul- und kein Aktionsbefehl, ein leeres Ergebnis in der Fremdgruppe entstünde
   * also auch ganz ohne Riegel (gemessen: die Mutationsprobe auf `PALETTE_MODI.etb.gruppen`
   * blieb grün, solange keine Person mit dieser Nummer existierte).
   *
   * Dass die Nummernvergabe bei 1 beginnt und lückenlos zählt, wird dabei geprüft und
   * nicht angenommen.
   */
  let letztePerson = { registrier_nr: 0 };
  for (let i = 1; i <= ziel.lfd_nr; i += 1) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personen`, { data: {} });
    expect(antwort.ok(), `Seeding Person: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
    letztePerson = await antwort.json();
  }
  const zahl = ziel.lfd_nr;
  expect(letztePerson.registrier_nr, 'die Person trägt dieselbe Zahl wie der ETB-Eintrag').toBe(zahl);
  const personKennung = `R-${String(zahl).padStart(3, '0')}`;

  // Genau so viele jüngere Einträge, dass der Zieleintrag aus der ersten Seite fällt.
  for (let i = 1; i <= ETB_SEITE; i += 1) {
    await seedeEtb(page, einsatzId, `Nachlauf ${i}`);
  }

  /*
   * DIE VORBEDINGUNG WIRD GEMESSEN, NICHT GEGLAUBT. Ohne sie prüfte der Fall nur „der
   * Deeplink hebt eine sichtbare Zeile hervor" — die eigentliche Aussage ist aber, dass
   * `EtbPage` ältere Seiten NACHLÄDT, bis der Eintrag da ist. Wäre der Zieleintrag schon
   * auf der ersten Seite, bliebe der Test grün, ohne den Nachladeweg je zu betreten.
   */
  const ersteSeite = await page.request.get(
    `/api/einsaetze/${einsatzId}/etb?limit=${ETB_SEITE}`,
  );
  expect(ersteSeite.ok(), await ersteSeite.text()).toBeTruthy();
  const ids = ((await ersteSeite.json()) as { id: number }[]).map((e) => e.id);
  expect(ids, 'der Zieleintrag liegt hinter der ersten Seite').not.toContain(ziel.id);

  // Von einem anderen Modul aus: auf der ETB-Seite selbst wäre nicht zu unterscheiden, ob
  // der Deeplink trägt oder die Chronologie ohnehin schon stand.
  await zumModul(page, einsatzId, 'personen');

  const etbTreffer = page.getByRole('option', {
    name: new RegExp(`ETB · #${zahl} · ${ZIELTEXT}`),
  });
  const personTreffer = page.getByRole('option', { name: new RegExp(`Personen · ${personKennung}`) });

  /*
   * ERST OHNE PRÄFIX — die Hälfte, die die Bindung überhaupt prüfbar macht: dieselbe Zahl
   * findet im Vorgabemodus BEIDE Datensätze. Ohne diese Positivaussage wäre die Abwesenheit
   * der Personenzeile unten von „die Person gibt es gar nicht" nicht zu unterscheiden.
   */
  await suche(page, String(zahl));
  await expect(etbTreffer).toBeVisible();
  await expect(personTreffer).toBeVisible();

  // … DANN MIT: '#' bindet die Quellen auf den ETB (`PALETTE_MODI.etb.quellen`). Der
  // ETB-Treffer steht weiter, die Person ist weg — beides im selben Zustand gemessen, die
  // Abwesenheit kann also kein noch laufender Abruf sein.
  await paletteInput(page).fill(`#${zahl}`);
  await expect(etbTreffer).toBeVisible();
  await expect(personTreffer).toHaveCount(0);

  await etbTreffer.click();

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/etb`));

  /*
   * Das Ziel: die Zeile ist wirklich DA und markiert. `zeile-hervorgehoben` (Konstante
   * `HERVORGEHOBEN` in `components/Datensicht.tsx`) setzt `EtbPage` erst, NACHDEM der
   * Eintrag in einer nachgeladenen Seite gefunden wurde — die Marke ist damit zugleich der
   * Beleg für den Nachladeweg. Sie steht genau einmal; mehrere Marken hiessen, dass die
   * Hervorhebung an etwas anderem hängt als am Zieleintrag.
   */
  const hervorgehoben = page.locator('.zeile-hervorgehoben');
  await expect(hervorgehoben).toHaveCount(1);
  await expect(hervorgehoben).toContainText(ZIELTEXT);

  // Und der Auftrag ist verbraucht: `EtbPage` räumt `?eintrag=` nach dem Sprung, sonst
  // schickte jedes Neuladen die Seite erneut hinein (apply-then-clean, LFH-340 · C5).
  await expect(page).not.toHaveURL(/eintrag=/);
});
