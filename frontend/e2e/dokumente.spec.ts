import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Dokumentenablage im Browser (LFH-632).
 *
 * ── WAS NUR HIER MESSBAR IST ────────────────────────────────────────────────────────────
 *
 * Drei Aussagen dieses Moduls kann jsdom nicht tragen, und genau sie stehen hier:
 *
 * 1. **Der Fokus beim Öffnen des Ablegen-Dialogs.** Die Erfassungs-Hülle fokussiert das erste
 *    `<input>` — hier ist das rc-uploads `<input type="file">` mit `display: none`, im Browser
 *    also NICHT fokussierbar. jsdom fokussiert es klaglos und belegt damit das Gegenteil dessen,
 *    was im Betrieb passiert. Geprüft wird deshalb hier, dass „Datei wählen" den Fokus trägt
 *    und der verborgene Datei-Input ihn NICHT hat (Nacharbeit aus dem Review zu Task 4).
 * 2. **Der Download.** Der Titel ist ein echter `<a href download>` auf `/api/…/datei`; ob
 *    daraus ein Download-Ereignis mit dem erwarteten Dateinamen wird, entscheidet der Browser
 *    zusammen mit dem `Content-Disposition` des Backends (`anhang::content_disposition` liefert
 *    ASCII-Rückfall UND `filename*`), nicht die Komponente.
 * 3. **Die Formweiche und der Querlauf.** jsdom rechnet kein Layout (Memory
 *    `layout-regression-nur-e2e`); Tabelle gegen Karte und `scrollWidth` sind Browserwerte.
 *
 * Dazu die Dichte-Staffel am **Download-Anker**: ein Inline-`<a>` erbt keine Steuerhöhe
 * (gemessen 17 px, LFH-396), `DownloadAnker` trägt `minHeight: token.controlHeight` deshalb
 * selbst. Die Sollwerte stehen als Literale (48 / 72) — aus dem Token zurückgelesen prüfte der
 * Test den Token gegen sich selbst.
 *
 * ── REIHENFOLGE IST HIER EINE ZUSICHERUNG, KEIN ZUFALL ──────────────────────────────────
 *
 * Der Download läuft VOR dem Kategorie-Filter. Andersherum verdeckte der Filter „Foto" genau
 * die Zeile, deren Anker gezogen werden soll — der Test wartete dann auf einen Treffer, den es
 * nach Konstruktion nicht geben kann.
 *
 * ── WAS HIER BEWUSST NICHT GEMESSEN WIRD ────────────────────────────────────────────────
 *
 * Kein `waitForLoadState('networkidle')`: auf Einsatzrouten bleibt ein SSE-Strom offen, die
 * Bedingung tritt nie sauber ein (LFH-385; gleichlautend in mehreren Bestands-Specs).
 * Kein Modulzähler bei 390 px — unterhalb `lg` liegt der Navigationsrahmen im Drawer
 * (LFH-329 · B1), die Zählermessung gehört an den Fükw-Durchgang.
 * Der Fixture-Name trägt KEINEN Modulnamen (Memory `e2e-fixture-namen-ohne-modulnamen`): die
 * Kommandopalette sucht Module und Einsätze gemeinsam, ein Einsatz „E2E Dokumente …" machte
 * jede Modulsuche mehrdeutig.
 */
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const FUEKW = { width: 1280, height: 900 };
const HANDSCHIRM = { width: 390, height: 844 };

/** Subpixel-Spielraum: Chromium rechnet unter Last anders als im Einzellauf. */
const SUBPIXEL = 0.5;

const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const STAFFEL = [
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

const PDF = Buffer.from('%PDF-1.4 e2e');
const JPG = Buffer.from('\xff\xd8\xff\xe0 e2e', 'binary');

// Login-/Anlege-Helfer kopiert — es gibt (noch) kein geteiltes e2e-Hilfsmodul
// (gleichlautend in sechs Bestands-Specs vermerkt).
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

/** Seeding per `page.request` (Cookie-Jar geteilt) — für die Layout-Läufe, die den Dialog
 *  nicht prüfen. Der Ablegen-Weg über die Oberfläche steht im ersten Test. */
async function seedeDokument(
  page: Page,
  einsatzId: string,
  titel: string,
  kategorie: string,
  dateiname: string,
  inhalt: Buffer,
) {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/dokumente`, {
    multipart: {
      datei: { name: dateiname, mimeType: 'application/octet-stream', buffer: inhalt },
      titel,
      kategorie,
    },
  });
  expect(
    antwort.ok(),
    `Seeding ${titel}: ${antwort.status()} ${await antwort.text()}`,
  ).toBeTruthy();
}

/** Der offene Dialog. antd lässt die Portale geschlossener Modale im Baum stehen; die
 *  Rollenabfrage übergeht sie, weil sie nicht im Zugänglichkeitsbaum liegen. */
function ablegenDialog(page: Page): Locator {
  return page.getByRole('dialog');
}

/** Option eines antd-`Select` im Portal — nur aus der GEÖFFNETEN Liste. */
async function waehleOption(page: Page, label: string) {
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .getByTitle(label, { exact: true })
    .click();
}

/** Waagerechter Überlauf des Dokuments. */
async function keinQuerlauf(page: Page, pfad: string) {
  await expect
    .poll(
      async () =>
        page
          .evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
          }))
          .then((m) => m.scroll - m.client),
      { message: `${pfad} läuft waagerecht über` },
    )
    .toBeLessThanOrEqual(SUBPIXEL);
}

/** Der Provider liest die gespeicherte Wahl beim Montieren, deshalb das Neuladen. */
async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
    DICHTE_SCHLUESSEL,
    dichte,
  ] as const);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

/**
 * Legt ein Dokument über die Oberfläche ab: Dialog öffnen, Datei wählen, Kategorie, Ablegen.
 * Gibt den Dialog-Locator NICHT zurück — nach dem Erfolg ist er weg.
 */
async function legeAb(
  page: Page,
  dateiname: string,
  inhalt: Buffer,
  mime: string,
  kategorie: string,
  titelSoll: string,
) {
  await page.getByRole('button', { name: 'Dokument ablegen' }).click();
  const dialog = ablegenDialog(page);
  await expect(dialog).toBeVisible();

  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: dateiname, mimeType: mime, buffer: inhalt });

  // Der Titel kommt aus dem Dateinamen ohne Endung — die Vorbelegung ist Teil des AK.
  await expect(dialog.getByLabel('Titel')).toHaveValue(titelSoll);

  await dialog.getByRole('combobox', { name: 'Kategorie' }).click();
  await waehleOption(page, kategorie);
  await dialog.getByRole('button', { name: 'Ablegen' }).click();
  await expect(dialog).toBeHidden();
}

test('legt ab, zählt, lädt herunter, filtert und entfernt — der ganze Weg im Browser', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Ablage ${Date.now()}`);
  await page.setViewportSize(FUEKW);
  await page.goto(`/einsaetze/${einsatzId}/dokumente`);

  // Der Navigationsrahmen steht ab `lg` inline; sein Zähler ist der zweite Beleg dafür, dass
  // die Ablage wirklich im Bestand landet (Query-Key `einsatz-dokumente`, gemeinsam genutzt).
  const modulKnopf = page.getByRole('button', { name: /^Dokumente/ });
  const zaehler = modulKnopf.locator('[data-lfh="modul-zaehler"]');
  await expect(modulKnopf, 'Modulzeile „Dokumente" steht im Rahmen').toBeVisible();
  await expect(zaehler, 'ohne Dokumente KEIN Zähler (nicht „0")').toHaveCount(0);
  await expect(page.getByText('Noch keine Dokumente abgelegt.')).toBeVisible();

  // ── 1 · Ablegen über den Dialog, samt Fokus-Nachweis ──────────────────────────────────
  await page.getByRole('button', { name: 'Dokument ablegen' }).click();
  const dialog = ablegenDialog(page);
  await expect(dialog).toBeVisible();
  // DIE Aussage, die jsdom nicht tragen kann: der verborgene `input[type=file]` ist im
  // Browser nicht fokussierbar, der Knopf holt den Fokus per `requestAnimationFrame`.
  await expect(
    dialog.getByRole('button', { name: /Datei wählen/ }),
    'Fokus liegt beim Öffnen auf „Datei wählen"',
  ).toBeFocused();
  await expect(
    dialog.locator('input[type="file"]'),
    'der verborgene Datei-Input trägt den Fokus NICHT',
  ).not.toBeFocused();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toBeHidden();

  await legeAb(
    page,
    'Lageplan Nord.pdf',
    PDF,
    'application/pdf',
    'Lagekarte/Plan',
    'Lageplan Nord',
  );

  const lageplan = page.getByRole('link', { name: 'Lageplan Nord' });
  await expect(lageplan).toBeVisible();
  await expect(lageplan, 'die frische Zeile steht im sichtbaren Bereich').toBeInViewport();
  await expect(zaehler, 'Zähler steht nach der ersten Ablage auf 1').toHaveText('1');

  // ── 2 · Zweites Dokument ──────────────────────────────────────────────────────────────
  await legeAb(page, 'Foto Zufahrt.jpg', JPG, 'image/jpeg', 'Foto', 'Foto Zufahrt');
  const foto = page.getByRole('link', { name: 'Foto Zufahrt' });
  await expect(foto).toBeVisible();
  await expect(zaehler).toHaveText('2');

  // ── 3 · Download VOR dem Filter (siehe Dateikopf) ─────────────────────────────────────
  const [download] = await Promise.all([page.waitForEvent('download'), lageplan.click()]);
  expect(download.suggestedFilename()).toBe('Lageplan Nord.pdf');

  // ── 4 · Kategorie-Filter ──────────────────────────────────────────────────────────────
  const werkzeuge = page.locator('[data-lfh="datensicht-werkzeuge"]');
  await werkzeuge.getByRole('combobox', { name: 'Kategorie' }).click();
  await waehleOption(page, 'Foto');
  await expect(lageplan, 'gefiltert: die Lagekarte ist weg').toHaveCount(0);
  await expect(foto, 'gefiltert: das Foto bleibt').toBeVisible();

  // ── 5 · Entfernen mit Rückfrage ───────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Dokument Foto Zufahrt entfernen' }).click();
  await page
    .locator('.ant-popconfirm:not(.ant-popover-hidden)')
    .getByRole('button', { name: 'Entfernen' })
    .click();
  await expect(foto, 'nach dem Entfernen ist die Zeile weg').toHaveCount(0);
  await expect(zaehler, 'der Zähler geht mit zurück').toHaveText('1');
});

test('Formweiche und Querlauf: Tabelle bei 1280 px, Karte bei 390 px', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Ablage Breite ${Date.now()}`);
  await seedeDokument(page, einsatzId, 'Lageplan Nord', 'lagekarte_plan', 'Lageplan Nord.pdf', PDF);
  const pfad = `/einsaetze/${einsatzId}/dokumente`;

  await page.setViewportSize(FUEKW);
  await page.goto(pfad);
  // Der Anker steht VOR jeder Messung — sonst prüft der Test den Ladezustand, und ohne
  // Zeilen gibt es keinen Überlauf (Lehre aus `kraefte-schmal.spec.ts`).
  await expect(page.getByRole('link', { name: 'Lageplan Nord' })).toBeVisible();
  await expect(page.locator('.ant-table').first(), 'Tabellenzweig bei 1280 px').toBeVisible();
  await expect(
    page.locator('[data-lfh="datensicht-karte"]'),
    'keine Karten bei 1280 px',
  ).toHaveCount(0);
  await keinQuerlauf(page, `${pfad} @1280`);

  await page.setViewportSize(HANDSCHIRM);
  await page.goto(pfad);
  await expect(page.getByRole('link', { name: 'Lageplan Nord' })).toBeVisible();
  await expect(
    page.locator('[data-lfh="datensicht-karte"]').first(),
    'Kartenzweig bei 390 px',
  ).toBeVisible();
  await expect(page.locator('.ant-table'), 'keine Tabelle bei 390 px').toHaveCount(0);
  await keinQuerlauf(page, `${pfad} @390`);
});

test.describe('Dichte-Staffel am Download-Anker', () => {
  for (const { dichte, soll } of STAFFEL) {
    test(`${dichte}: der Titel-Anker hält die Stufe ${soll} px`, async ({ page }, testInfo) => {
      await anmelden(page);
      const einsatzId = await einsatzAnlegen(page, `E2E Ablage ${dichte} ${Date.now()}`);
      await seedeDokument(
        page,
        einsatzId,
        'Lageplan Nord',
        'lagekarte_plan',
        'Lageplan Nord.pdf',
        PDF,
      );
      await page.setViewportSize(FUEKW);
      await page.goto(`/einsaetze/${einsatzId}/dokumente`);
      await stelleDichte(page, dichte);

      const anker = page.getByRole('link', { name: 'Lageplan Nord' });
      await expect(anker, 'genau ein Anker je Zeile').toHaveCount(1);
      await expect(anker).toBeVisible();
      // Vor der Messung: „Stufe nicht angekommen" muss von „Ziel zu klein" unterscheidbar sein.
      await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
      const kasten = await anker.boundingBox();
      expect(kasten, 'kein Kasten messbar').not.toBeNull();
      expect(
        kasten!.height,
        `Download-Anker (${dichte}): gemessen ${kasten!.height} px, Soll ≥ ${soll} px`,
      ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
      await testInfo.attach('Trefffläche Download-Anker', {
        body: `${dichte}: ${kasten!.height} px (Soll ≥ ${soll} px)`,
        contentType: 'text/plain',
      });
    });
  }
});
