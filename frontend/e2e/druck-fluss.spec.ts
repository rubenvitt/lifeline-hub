import { expect, test, type APIResponse, type Page } from '@playwright/test';

/**
 * Druck im normalen Fluss (LFH-71, design.md D1/D10 des Changes `lfh-22-druck-export`).
 *
 * WAS BEWIESEN WIRD: ein Druckstück (Lagebericht lesend und im Entwurf, Befehl) steht unter
 * `@media print` im NORMALEN Dokumentfluss — die Druckwurzel ist `position: static` und
 * beginnt oben auf der Seite, der App-Rahmen (Kopfleiste, Rail, Modulpanel) und schwebende
 * Ebenen (eine offene `message`) sind `display: none`, belegen also keinen Platz. Genau das
 * ist die Bedingung, unter der Firefox und Safari mehrseitig drucken: ein absolut
 * positionierter Druckbereich wird dort nach der ersten Seite abgeschnitten.
 *
 * WARUM DIESE AUSSAGEN DISKRIMINIEREN: das alte Muster (`body * { visibility: hidden }` plus
 * `position: absolute` am Druckbereich) liegt AUCH oben auf der Seite und trägt den Text
 * AUCH unterhalb einer A4-Höhe. Beides allein wäre also am alten Stand grün. Rot wird der
 * alte Stand an `position` der Wurzel und an `display` des Rahmens: `visibility: hidden`
 * lässt die Kopfleiste im Layout stehen.
 *
 * WAS NICHT BEWIESEN WIRD: Firefox und Safari selbst. Playwright fährt hier nur Chromium,
 * und `page.pdf()` gibt es nur dort. Die beiden Browser prüft die Prüfliste von Hand.
 * Die PDF-Seitenzahl unten ist eine PLAUSIBILITÄT (keine Leerseiten, kein Abschneiden in
 * Chromium), kein Nachweis für die anderen Browser. Den Text im PDF prüft der Spec nicht:
 * die Glyphen sind subsetted und komprimiert, das bräuchte einen PDF-Parser als neue
 * Abhängigkeit.
 *
 * MUTATIONSPROBE (Stand vor 1.1/1.2, also mit dem alten Muster in den drei `*Print.css`,
 * gemessen am 25.09.2026 gegen das Binary von Commit 3ce922d2): alle drei Druckstück-Tests
 * ROT, jeweils an der ersten diskriminierenden Aussage — „Druckwurzel steht im Fluss"
 * erwartet `static`, bekam `absolute`. Mit ausgeschalteter Positionsprüfung scheitert
 * derselbe Stand an „Kopfleiste im Druck ausgeblendet" (`flex` statt `none`). Der
 * Zähler-Selbsttest ist auf beiden Ständen grün (er prüft den Zähler, nicht den Code).
 *
 * SEEDING PER `page.request`: die Session ist Cookie-basiert, `page.request` teilt den
 * Cookie-Jar des Kontexts (Vorgehen aus `lagebericht-schmal.spec.ts`).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/**
 * A4 in CSS-Pixeln bei 96 px/in: 210 × 297 mm → 793,7 × 1122,5 px. [abgeleitet]
 *
 * Der Seitenrand kommt aus `@page { margin: 15mm }` in `src/druck/druck.css`: nutzbar
 * bleiben 180 × 267 mm → 680 × 1009 px. Das Sichtfeld wird auf die nutzbare Breite gestellt,
 * weil `emulateMedia` nur die Medienabfrage schaltet und die Layoutbreite beim Sichtfeld
 * lässt (Herleitung in `meldebild-tabelle.spec.ts`, `A4_DRUCKBREITE`).
 */
const A4_HOEHE = 1122;
const NUTZ_BREITE = 680;
const NUTZ_HOEHE = 1009;

/** Spielraum für „oben ≈ 0" — Subpixel, kein Layoutbefund. */
const SUBPIXEL = 1;

const ENDMARKE = 'ENDMARKE-LETZTER-ABSCHNITT';

// Login-/Anlege-Helfer wie in den Bestands-Specs — es gibt (noch) kein geteiltes Hilfsmodul.
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
 * Schreibende Anfrage mit bis zu drei Versuchen bei 503. Unter drei parallelen Workern
 * antwortete die Freigabe gemessen einmal mit „Dienst vorübergehend ausgelastet — bitte
 * erneut versuchen" (SQLite-Schreibkonflikt nach Busy-Retries, `error.rs`). Das Seeding ist
 * Vorbereitung, keine Aussage; der Server sagt selbst, dass ein zweiter Versuch richtig ist.
 * Jede andere Antwort geht unverändert durch.
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

async function befehlSaeen(page: Page, einsatzId: string): Promise<number> {
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
  const frei = await mitWiederholung(() =>
    page.request.post(`/api/einsaetze/${einsatzId}/befehle/${id}/freigeben`),
  );
  expect(frei.ok(), await frei.text()).toBe(true);
  return id;
}

/**
 * Lage der Druckwurzel, des Rahmens und der Endmarke im aktuellen Medium.
 *
 * Über `evaluate` und `getComputedStyle`, NICHT über `toBeVisible`: die Aussage ist
 * „belegt keinen Platz" (`display: none`), und `toBeVisible` trennt das nicht von
 * `visibility: hidden` — genau der Unterschied, um den es geht.
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
    // Die Endmarke als TEXTKNOTEN im gerenderten Markdown — nicht im Textfeld des Editors,
    // das im Druck ausgeblendet ist und den Wert nur als Eigenschaft trägt.
    const knoten = Array.from(wurzel.querySelectorAll('.markdown p')).find((p) =>
      p.textContent?.includes(endmarke),
    ) as HTMLElement | undefined;
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
    };
  }, ENDMARKE);
}

/** Seiten eines PDF: `/Type /Page`, nicht `/Type /Pages` (der Seitenbaum). */
function seitenImPdf(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

async function pruefeDruckImFluss(page: Page, fall: string) {
  // Vorbedingung am Bildschirm, im BREITEN Sichtfeld (Rail und Modulpanel gibt es erst ab
  // `lg`): der Rahmen steht wirklich da — sonst prüfte der Druck eine Seite, auf der es
  // nichts auszublenden gibt.
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

  // Die Marke erst NACH den Layoutaussagen: am alten Stand fehlt sie ohnehin, und die
  // Mutationsprobe soll an der Mechanik rot werden, nicht an der fehlenden Marke.
  expect(rahmen.wurzelAnzahl, `${fall}: genau eine Druckwurzel`).toBe(1);

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

test('Lagebericht (Entwurf) druckt im normalen Fluss, eine offene Meldung erscheint nicht', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Druckfluss LB-Entwurf ${Date.now()}`);
  const id = await lageberichtSaeen(page, einsatzId, false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/lageberichte/${id}`);
  // Split-Layout: die gerenderte Vorschau trägt den Text, die Eingabe weicht im Druck.
  await page.getByRole('checkbox', { name: 'Vorschau neben dem Text' }).check();
  await expect(page.locator('.markdown p', { hasText: ENDMARKE })).toBeAttached();
  // Eine echte schwebende Ebene: der Erfolgs-Toast nach dem Speichern.
  await page.getByRole('button', { name: 'Entwurf speichern' }).click();
  await expect(page.locator('.ant-message-notice')).toBeVisible();
  await pruefeDruckImFluss(page, 'Lagebericht Entwurf');
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
