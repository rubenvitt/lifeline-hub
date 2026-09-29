import { expect, test, type APIResponse, type Page } from '@playwright/test';

/**
 * Druck im normalen Fluss: ein Druckstück (Lagebericht lesend und im Entwurf, Befehl) steht
 * unter `@media print` im NORMALEN Dokumentfluss — die Druckwurzel ist `position: static` und
 * beginnt oben, App-Rahmen und schwebende Ebenen (eine offene `message`) sind `display: none`.
 * Nur so drucken Firefox und Safari mehrseitig; einen absolut positionierten Druckbereich
 * schneiden sie nach Seite 1 ab.
 *
 * DISKRIMINIEREND sind `position` der Wurzel und `display` des Rahmens: das alte Muster
 * (`visibility: hidden` plus `position: absolute`) lag auch oben und trug den Text auch
 * jenseits einer A4-Höhe.
 *
 * NICHT BEWIESEN: Firefox und Safari selbst (Playwright fährt nur Chromium, `page.pdf()` gibt
 * es nur dort) — die prüft die Prüfliste von Hand. Die PDF-Seitenzahl ist Plausibilität; den
 * PDF-Text prüft der Spec nicht (subsetted und komprimiert).
 *
 * Seeding per `page.request`.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/**
 * A4 in CSS-Pixeln bei 96 px/in: 210 × 297 mm → 793,7 × 1122,5 px. [abgeleitet] Nach dem
 * `@page`-Rand (15 mm) bleiben 680 × 1009 px. Das Sichtfeld wird auf die nutzbare Breite
 * gestellt, weil `emulateMedia` die Layoutbreite beim Sichtfeld lässt.
 */
const A4_HOEHE = 1122;
const NUTZ_BREITE = 680;
const NUTZ_HOEHE = 1009;

/** Spielraum für „oben ≈ 0" — Subpixel, kein Layoutbefund. */
const SUBPIXEL = 1;

const ENDMARKE = 'ENDMARKE-LETZTER-ABSCHNITT';

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

/**
 * Schreibende Anfrage mit bis zu drei Versuchen bei 503: unter parallelen Workern antwortet
 * SQLite gelegentlich „vorübergehend ausgelastet". Das Seeding ist Vorbereitung, keine
 * Aussage; jede andere Antwort geht unverändert durch.
 */
async function mitWiederholung(anfrage: () => Promise<APIResponse>): Promise<APIResponse> {
  let antwort = await anfrage();
  for (let versuch = 1; versuch < 3 && antwort.status() === 503; versuch++) {
    await new Promise((fertig) => setTimeout(fertig, 300 * versuch));
    antwort = await anfrage();
  }
  return antwort;
}

/** Ein langer Abschnittstext: `absaetze` Absätze à rund 480 Zeichen. */
function langerText(abschnitt: string, absaetze: number, ende = ''): string {
  const satz =
    'Die Lage im Einsatzabschnitt hat sich seit der letzten Meldung verändert, die Kräfte ' +
    'vor Ort melden eine Ausweitung des Schadensgebiets nach Nordosten, der Pegel steigt ' +
    'weiter und die Zufahrt über die Kreisstraße ist nur noch für geländegängige Fahrzeuge ' +
    'befahrbar. ';
  const absatzListe = Array.from(
    { length: absaetze },
    (_, i) => `${abschnitt} Absatz ${i + 1}: ${satz}${satz}`,
  );
  if (ende) absatzListe.push(ende);
  return absatzListe.join('\n\n');
}

const LAGEBERICHT_ABSCHNITTE = [
  'auftrag',
  'gefahren_schadenlage',
  'eigene_lage',
  'lageentwicklung',
  'fuehrungsprobleme',
  'antraege_vorschlaege',
  'zusammenfassung',
];

async function lageberichtSaeen(
  page: Page,
  einsatzId: string,
  freigeben: boolean,
): Promise<number> {
  const neu = await mitWiederholung(() =>
    page.request.post(`/api/einsaetze/${einsatzId}/lageberichte`, {
      data: { vorlage: 'lagebericht', titel: 'Lagebericht Druckprobe' },
    }),
  );
  expect(neu.ok(), await neu.text()).toBe(true);
  const id = (await neu.json()).id as number;
  const letzter = LAGEBERICHT_ABSCHNITTE.length - 1;
  const patch = await mitWiederholung(() =>
    page.request.patch(`/api/einsaetze/${einsatzId}/lageberichte/${id}`, {
      data: {
        abschnitte: LAGEBERICHT_ABSCHNITTE.map((schluessel, i) => ({
          schluessel,
          text: langerText(schluessel, 6, i === letzter ? ENDMARKE : ''),
        })),
      },
    }),
  );
  expect(patch.ok(), await patch.text()).toBe(true);
  if (freigeben) {
    const frei = await mitWiederholung(() =>
      page.request.post(`/api/einsaetze/${einsatzId}/lageberichte/${id}/freigeben`),
    );
    expect(frei.ok(), await frei.text()).toBe(true);
  }
  return id;
}

async function befehlSaeen(page: Page, einsatzId: string, freigeben = true): Promise<number> {
  const neu = await mitWiederholung(() =>
    page.request.post(`/api/einsaetze/${einsatzId}/befehle`, {
      data: { vorlage: 'befehl_lad', titel: 'Befehl Druckprobe' },
    }),
  );
  expect(neu.ok(), await neu.text()).toBe(true);
  const id = (await neu.json()).id as number;
  const abschnitte = ['lage', 'auftrag', 'durchfuehrung'];
  const patch = await mitWiederholung(() =>
    page.request.patch(`/api/einsaetze/${einsatzId}/befehle/${id}`, {
      data: {
        abschnitte: abschnitte.map((schluessel, i) => ({
          schluessel,
          text: langerText(schluessel, 12, i === abschnitte.length - 1 ? ENDMARKE : ''),
        })),
      },
    }),
  );
  expect(patch.ok(), await patch.text()).toBe(true);
  if (!freigeben) return id;
  const frei = await mitWiederholung(() =>
    page.request.post(`/api/einsaetze/${einsatzId}/befehle/${id}/freigeben`),
  );
  expect(frei.ok(), await frei.text()).toBe(true);
  return id;
}

/**
 * Lage der Druckwurzel, des Rahmens und der Endmarke im aktuellen Medium, über
 * `getComputedStyle` — `toBeVisible` trennt `display: none` nicht von `visibility: hidden`,
 * genau den Unterschied, um den es geht.
 */
async function druckLage(page: Page) {
  return page.evaluate((endmarke) => {
    const wurzeln = document.querySelectorAll('[data-lfh="druckwurzel"]');
    const wurzel = (wurzeln[0] ??
      document.querySelector('.lagebericht-print-root, .befehl-print-root')) as HTMLElement;
    const r = wurzel.getBoundingClientRect();
    const anzeige = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : 'fehlt';
    };
    // Die Endmarke als DARGESTELLTER Textknoten im gerenderten Markdown (`getClientRects`) —
    // nicht im Textfeld des Editors und nicht in einer verborgenen Fassung.
    const knoten = Array.from(wurzel.querySelectorAll('.markdown p')).find(
      (p) => p.textContent?.includes(endmarke) && p.getClientRects().length > 0,
    ) as HTMLElement | undefined;
    // Ein Textfeld im Druck ist Rohtext in Bildschirmhöhe, abgeschnitten, sobald der Text
    // länger ist. `getClientRects`, weil im Split-Layout die ganze Eingabespalte weicht.
    const textfelder = Array.from(wurzel.querySelectorAll('textarea')).filter(
      (t) => t.getClientRects().length > 0,
    ).length;
    // Abschnittstitel des Entwurfs: Akkordeonkopf (Lagebericht) bzw. Feldetikett (Befehl).
    const titel = wurzel.querySelector('.ant-collapse-header, .ant-form-item-label');
    return {
      wurzelAnzahl: wurzeln.length,
      wurzelPosition: getComputedStyle(wurzel).position,
      wurzelOben: r.top + window.scrollY,
      wurzelHoehe: wurzel.scrollHeight,
      kopfleiste: anzeige('.ant-layout-header'),
      rail: anzeige('nav[aria-label="Kategorien"]'),
      modulpanel: anzeige('[data-lfh="modul-panel"]'),
      meldung: anzeige('.ant-message'),
      endmarkeOben: knoten ? knoten.getBoundingClientRect().top + window.scrollY : -1,
      textfelder,
      titelUmbruch: titel ? getComputedStyle(titel).breakAfter : 'kein Entwurfstitel',
    };
  }, ENDMARKE);
}

/** Seiten eines PDF: `/Type /Page`, nicht `/Type /Pages` (der Seitenbaum). */
function seitenImPdf(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

async function pruefeDruckImFluss(page: Page, fall: string) {
  // Vorbedingung am Bildschirm, breit (Rail und Modulpanel gibt es erst ab `lg`): der Rahmen
  // steht — sonst gäbe es im Druck nichts auszublenden.
  await page.setViewportSize({ width: 1280, height: 900 });
  const schirm = await druckLage(page);
  expect(schirm.kopfleiste, `${fall}: Kopfleiste steht am Bildschirm`).not.toBe('none');
  expect(schirm.rail, `${fall}: Rail ist vorhanden`).not.toBe('fehlt');
  expect(schirm.rail, `${fall}: Rail steht am Bildschirm`).not.toBe('none');

  // (1) RAHMEN UND FLUSS — im selben breiten Sichtfeld, damit der Rahmen im Baum steht.
  await page.emulateMedia({ media: 'print' });
  const rahmen = await druckLage(page);
  expect(rahmen.wurzelPosition, `${fall}: Druckwurzel steht im Fluss`).toBe('static');
  expect(rahmen.wurzelOben, `${fall}: Druckwurzel beginnt oben auf der Seite`).toBeLessThanOrEqual(
    SUBPIXEL,
  );
  expect(rahmen.kopfleiste, `${fall}: Kopfleiste im Druck ausgeblendet`).toBe('none');
  expect(rahmen.rail, `${fall}: Rail im Druck ausgeblendet`).toBe('none');
  if (schirm.modulpanel !== 'fehlt') {
    expect(rahmen.modulpanel, `${fall}: Modulpanel im Druck ausgeblendet`).toBe('none');
  }
  if (schirm.meldung !== 'fehlt') {
    expect(rahmen.meldung, `${fall}: offene Meldung im Druck ausgeblendet`).toBe('none');
  }

  // Die Marke erst NACH den Layoutaussagen: der Test soll an der Mechanik rot werden.
  expect(rahmen.wurzelAnzahl, `${fall}: genau eine Druckwurzel`).toBe(1);
  expect(rahmen.textfelder, `${fall}: kein Eingabefeld für Abschnittstext auf Papier`).toBe(0);
  if (rahmen.titelUmbruch !== 'kein Entwurfstitel') {
    // Belegt die KASKADE (die Regel greift am Entwurfstitel), nicht den Umbruch selbst — den
    // zeigt nur das Blatt (Handprüfung).
    expect(rahmen.titelUmbruch, `${fall}: Abschnittstitel bleibt bei seinem Text`).toBe('avoid');
  }

  // (2) UMFANG — auf Papierbreite, weil die Zeilenzahl an der Breite hängt.
  await page.setViewportSize({ width: NUTZ_BREITE, height: 900 });
  const papier = await druckLage(page);
  expect(papier.endmarkeOben, `${fall}: Endmarke im Druckbereich gefunden`).toBeGreaterThan(0);
  expect(
    papier.endmarkeOben,
    `${fall}: der letzte Abschnitt liegt jenseits der ersten Seite (Endmarke bei ${papier.endmarkeOben}px)`,
  ).toBeGreaterThan(A4_HOEHE);

  // (3) PLAUSIBILITÄT: das PDF hat mindestens zwei Seiten und keine Leerseiten.
  const pdf = await page.pdf({ format: 'A4' });
  const seiten = seitenImPdf(pdf);
  const obergrenze = Math.ceil(papier.wurzelHoehe / NUTZ_HOEHE) + 1;
  expect(seiten, `${fall}: mehrseitiges PDF`).toBeGreaterThanOrEqual(2);
  expect(
    seiten,
    `${fall}: keine Leerseiten (${seiten} Seiten für ${papier.wurzelHoehe}px Inhalt)`,
  ).toBeLessThanOrEqual(obergrenze);

  test.info().annotations.push({
    type: 'messwert',
    description: `${fall}: Wurzel ${Math.round(papier.wurzelHoehe)}px, Endmarke bei ${Math.round(papier.endmarkeOben)}px, PDF ${seiten} Seiten (Obergrenze ${obergrenze})`,
  });
  await page.emulateMedia({ media: null });
}

// Kaltstart der Detailrouten unter Vite plus PDF-Erzeugung.
test.setTimeout(90_000);

test('Zähler-Selbsttest: ein einseitiges Dokument hat genau eine PDF-Seite', async ({ page }) => {
  await page.setContent('<p>eine Seite</p>');
  expect(seitenImPdf(await page.pdf({ format: 'A4' }))).toBe(1);
});

test('Lagebericht (freigegeben) druckt im normalen Fluss über mehrere Seiten', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Druckfluss LB ${Date.now()}`);
  const id = await lageberichtSaeen(page, einsatzId, true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/lageberichte/${id}`);
  await expect(page.locator('.markdown p', { hasText: ENDMARKE })).toBeAttached();
  await pruefeDruckImFluss(page, 'Lagebericht lesend');
});

/**
 * Die VORGABE der Entwurfsseite: „Vorschau neben dem Text" aus, Toggle-Layout mit
 * geschlossener Vorschau — der Zustand, in dem die `<textarea>` am ehesten mitgedruckt wird.
 * Diskriminierend: die Endmarke des LETZTEN (zugeklappten) Abschnitts steht als dargestellter
 * Markdown-Absatz jenseits der ersten Seite, und kein Textfeld ist im Druck sichtbar.
 */
test('Lagebericht (Entwurf, Vorgabe ohne Vorschau) druckt jeden Abschnitt vollständig als Markdown', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Druckfluss LB-Entwurf ${Date.now()}`);
  const id = await lageberichtSaeen(page, einsatzId, false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/lageberichte/${id}`);
  // Vorbedingung: die Vorgabe steht — kein Haken, keine Eingabespalte.
  await expect(page.getByRole('checkbox', { name: 'Vorschau neben dem Text' })).not.toBeChecked();
  await expect(page.locator('.markdown-editor--split')).toHaveCount(0);
  await expect(page.locator('.markdown-editor--toggle').first()).toBeAttached();
  // Eine echte schwebende Ebene: der Erfolgs-Toast nach dem Speichern.
  await page.getByRole('button', { name: 'Entwurf speichern' }).click();
  await expect(page.locator('.ant-message-notice')).toBeVisible();
  await pruefeDruckImFluss(page, 'Lagebericht Entwurf (Vorgabe)');
});

test('Lagebericht (Entwurf, Vorschau neben dem Text) druckt im normalen Fluss', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Druckfluss LB-Split ${Date.now()}`);
  const id = await lageberichtSaeen(page, einsatzId, false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/lageberichte/${id}`);
  // Split-Layout: die gerenderte Vorschau trägt den Text, die Eingabe weicht im Druck.
  await page.getByRole('checkbox', { name: 'Vorschau neben dem Text' }).check();
  await expect(page.locator('.markdown p', { hasText: ENDMARKE })).toBeAttached();
  await pruefeDruckImFluss(page, 'Lagebericht Entwurf (Split)');
});

test('Befehl (Entwurf) druckt im normalen Fluss, Abschnittstitel bleibt beim Text', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Druckfluss Befehl-Entwurf ${Date.now()}`);
  const id = await befehlSaeen(page, einsatzId, false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/auftraege/befehle/${id}`);
  await expect(page.locator('.markdown p', { hasText: ENDMARKE })).toBeAttached();
  await expect(page.locator('.ant-form-item-label').first()).toBeAttached();
  await pruefeDruckImFluss(page, 'Befehl Entwurf');
});

test('Befehl (freigegeben) druckt im normalen Fluss über mehrere Seiten', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Druckfluss Befehl ${Date.now()}`);
  const id = await befehlSaeen(page, einsatzId);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/auftraege/befehle/${id}`);
  await expect(page.locator('.markdown p', { hasText: ENDMARKE })).toBeAttached();
  await pruefeDruckImFluss(page, 'Befehl lesend');
});
