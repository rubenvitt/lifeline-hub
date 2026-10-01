import { expect, test, type FileChooser, type Locator, type Page } from '@playwright/test';
import { pruefeFokusVerdeckung } from './fokus-kern';
import { kontrast, pruefe } from './kontrast-kern';

/**
 * Dokumentenablage im Browser — was jsdom nicht tragen kann:
 *
 * 1. Der Fokus beim Öffnen des Ablegen-Dialogs: die Erfassungs-Hülle fokussiert das erste
 *    `<input>`, hier rc-uploads `<input type="file">` mit `display: none` — im Browser NICHT
 *    fokussierbar, jsdom fokussiert es klaglos. Geprüft wird, dass „Datei wählen" den Fokus
 *    trägt und der verborgene Input nicht.
 * 2. Der Download: ob aus `<a href download>` ein Download mit dem erwarteten Dateinamen wird,
 *    entscheidet der Browser mit dem `Content-Disposition` des Backends.
 * 3. Die Formweiche und der Querlauf.
 *
 * Dazu die Dichte-Staffel am Download-Anker (ein Inline-`<a>` erbt keine Steuerhöhe), an
 * Zeilenaktion und Dialogzielen, als Literale 30 / 48 / 72. Die übrigen Tests belegen
 * Tastaturweg (Kriterium 15), Kontrast in beiden Modi (5) und Fokus-Verdeckung (13); was nur
 * gemessen, nicht zugesichert wird, steht als Anhang am Test.
 *
 * Der Download läuft VOR dem Kategorie-Filter — der Filter „Foto" verdeckte sonst genau die
 * Zeile, deren Anker gezogen wird.
 *
 * Kein `networkidle` (SSE-Strom). Der Fixture-Name trägt keinen Modulnamen, sonst würde jede
 * Modulsuche der Palette mehrdeutig.
 */
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const FUEKW = { width: 1280, height: 900 };
const HANDSCHIRM = { width: 390, height: 844 };

/** Subpixel-Spielraum: Chromium rechnet unter Last anders als im Einzellauf. */
const SUBPIXEL = 0.5;

const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
/**
 * `soll` ist die Steuerhöhe, `sollSM` die kleine (antds Knöpfe der Bestätigungsblase), `fuge` der
 * Boden zwischen zwei Knöpfen eines Dialogfußes (LFH-653: ≥ 8 im Touch-, ≥ 16 im
 * Handschuh-Betrieb). In `kompakt` wird die Fuge nur gemessen: die Leitlinie nimmt den Fükw vom
 * Zielabstand aus. `klappkopf` ist der Boden des Klappkopfs: die Staffel, in `kompakt` aber die
 * 36 px von vor LFH-653 — der Boden hebt an, er kürzt nie (Spec „Kompakt wird nicht gekürzt“).
 */
const STAFFEL = [
  { dichte: 'kompakt', soll: 30, sollSM: 24, fuge: null, klappkopf: 36 },
  { dichte: 'komfortabel', soll: 48, sollSM: 48, fuge: 8, klappkopf: 48 },
  { dichte: 'handschuh', soll: 72, sollSM: 72, fuge: 16, klappkopf: 72 },
] as const;

const PDF = Buffer.from('%PDF-1.4 e2e');
const JPG = Buffer.from('\xff\xd8\xff\xe0 e2e', 'binary');

async function anmelden(page: Page, modus?: 'light' | 'dark') {
  // Der Modus muss VOR dem ersten Laden stehen — der Bootstrap in `index.html` liest ihn.
  if (modus) await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
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

/** Seeding per `page.request` für die Layout-Läufe; den Ablegen-Weg über die Oberfläche prüft
 *  der erste Test. */
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

/** Der offene Dialog. Geschlossene Modal-Portale liegen nicht im Zugänglichkeitsbaum. */
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
  // Ganzer Weg mit zwei Ablagen: unter Gate-Last reicht die Vorgabe von 30 s nicht.
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Ablage ${Date.now()}`);

  // Der Zähler im Navigationsrahmen belegt zweitens, dass die Ablage im Bestand landet
  // (gemeinsamer Query-Key). Angesteuert über die Modulzeile — der Einstieg über die
  // Navigation ist Teil der Aussage.
  const modulKnopf = page.getByRole('button', { name: /^Dokumente/ });
  const zaehler = modulKnopf.locator('[data-lfh="modul-zaehler"]');
  await expect(modulKnopf, 'Modulzeile „Dokumente" steht im Rahmen').toBeVisible();
  await modulKnopf.click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/dokumente$`));
  await expect(modulKnopf, 'die Modulzeile ist jetzt die aktive').toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(zaehler, 'ohne Dokumente KEIN Zähler (nicht „0")').toHaveCount(0);
  await expect(page.getByText('Noch keine Dokumente abgelegt.')).toBeVisible();

  // ── 1 · Ablegen über den Dialog, samt Fokus-Nachweis ──────────────────────────────────
  await page.getByRole('button', { name: 'Dokument ablegen' }).click();
  const dialog = ablegenDialog(page);
  await expect(dialog).toBeVisible();
  // Der verborgene `input[type=file]` ist im Browser nicht fokussierbar; der Knopf holt den
  // Fokus per `requestAnimationFrame`.
  await expect(
    dialog.locator('button.ant-btn', { hasText: 'Datei wählen' }),
    'Fokus liegt beim Öffnen auf „Datei wählen"',
  ).toBeFocused();
  await expect(
    dialog.locator('input[type="file"]'),
    'der verborgene Datei-Input trägt den Fokus NICHT',
  ).not.toBeFocused();
  // Dasselbe direkt am `document.activeElement`: der native `<button>` „Datei wählen".
  const aktiv = await page.evaluate(() => {
    const el = document.activeElement;
    return {
      tag: el?.tagName ?? null,
      typ: el?.getAttribute('type') ?? null,
      text: (el?.textContent ?? '').trim(),
    };
  });
  expect(aktiv, 'document.activeElement ist der Knopf „Datei wählen"').toEqual({
    tag: 'BUTTON',
    typ: 'button',
    text: 'Datei wählen',
  });
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
  // Der Anker steht VOR jeder Messung — ohne Zeilen gibt es keinen Überlauf.
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

  // Entfernen im Kartenzweig (LFH-656): Primäraktion ist „Bearbeiten“, Entfernen steht als roter
  // Eintrag im Aktionsmenü; die Rückfrage ist ein Seiten-Modal mit rotem OK. Der zugängliche
  // Name trägt den Titel.
  await expect(
    page.getByRole('button', { name: 'Dokument Lageplan Nord bearbeiten' }),
    'Primäraktion der Karte',
  ).toBeVisible();
  await page.getByRole('button', { name: 'Aktionen zu Dokument Lageplan Nord' }).click();
  const eintrag = page
    .locator('.ant-dropdown:not(.ant-dropdown-hidden)')
    .getByRole('menuitem', { name: 'Entfernen' });
  await expect(eintrag, 'der Menüeintrag ist rot').toHaveClass(/ant-dropdown-menu-item-danger/);
  await eintrag.click();
  const rueckfrage = page.getByRole('dialog').filter({ hasText: 'Dokument entfernen?' });
  const ok = rueckfrage.getByRole('button', { name: 'Entfernen' });
  await expect(ok, 'das OK der Rückfrage ist rot').toHaveClass(/ant-btn-dangerous/);
  // Erst nach der Zoom-Einblendung klicken: währenddessen nimmt das Modal keinen Klick an.
  await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
  await ok.click();
  await expect(rueckfrage, 'die Rückfrage schließt mit dem OK').toBeHidden();
  await expect(page.getByRole('link', { name: 'Lageplan Nord' })).toHaveCount(0);
  await expect(page.getByText('Noch keine Dokumente abgelegt.')).toBeVisible();
});

/** Waagrechter Abstand zwischen zwei nebeneinanderstehenden Zielen, auf eine Nachkommastelle. */
async function waagrechteFuge(links: Locator, rechts: Locator): Promise<number> {
  const a = await links.boundingBox();
  const b = await rechts.boundingBox();
  expect(a && b, 'keine Kästen messbar').toBeTruthy();
  return Math.round((b!.x - (a!.x + a!.width)) * 10) / 10;
}

/**
 * LFH-654 (Prüfliste LFH-632, Zeilen 1 · 3 und 2 · 3): was jsdom nicht tragen kann — echter
 * Upload-Fortschritt aus dem Browser, die Prüfphase nach dem letzten Byte und der
 * Entfernen-Zustand bis zur Serverantwort.
 *
 * Die Strecke drosselt CDP (`Network.emulateNetworkConditions`, nur Chromium): wenig
 * Upload-Bandbreite für den Prozentlauf, hohe Latenz für die Prüfphase — die Antwort kommt
 * Sekunden nach dem letzten Byte. Eine Route (`page.route`) taugt für die Prüfphase NICHT:
 * solange Playwright die Anfrage festhält, meldet Chromium keinerlei Upload-Ereignis (gemessen).
 * Die Zahl im Balken muss mindestens zweimal ZWISCHEN 0 und 100 stehen — sonst wäre sie nur ein
 * Endzustand, kein Fortschritt.
 */
test('Rückmeldung: Fortschritt, Prüfphase und Entfernen-Zustand (LFH-654)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Ablage Fortschritt ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/dokumente`);
  await expect(page.getByText('Noch keine Dokumente abgelegt.')).toBeVisible();

  // ── 1 · Prozent aus den Bytes, unter gedrosselter Strecke ─────────────────────────────
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 3_000, // die Antwort trifft Sekunden nach dem letzten Byte ein → Prüfphase
    downloadThroughput: -1,
    uploadThroughput: 256 * 1024, // Bytes/s: 2 MiB brauchen rund 8 s
  });
  const gross = Buffer.concat([Buffer.from('%PDF-1.4 e2e '), Buffer.alloc(2 * 1024 * 1024, 32)]);

  await page.getByRole('button', { name: 'Dokument ablegen' }).click();
  const dialog = ablegenDialog(page);
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: 'Lageplan Gross.pdf', mimeType: 'application/pdf', buffer: gross });
  await dialog.getByRole('combobox', { name: 'Kategorie' }).click();
  await waehleOption(page, 'Lagekarte/Plan');
  await dialog.getByRole('button', { name: 'Ablegen' }).click();

  const balken = dialog.getByRole('progressbar');
  await expect(balken, 'der Balken steht sofort, noch vor dem ersten Byte').toBeVisible();
  const zwischenwerte = new Set<number>();
  await expect
    .poll(
      async () => {
        const wert = Number(await balken.getAttribute('aria-valuenow'));
        if (wert > 0 && wert < 100) zwischenwerte.add(wert);
        return zwischenwerte.size;
      },
      { message: 'der Balken steht mindestens zweimal zwischen 0 und 100 %', timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(2);
  // Das sichtbare Etikett (die Ansage-Region daneben spricht nur in 10-%-Schritten).
  await expect(
    dialog.locator('[aria-hidden="true"]', { hasText: /^Wird hochgeladen · \d+ %$/ }),
  ).toBeVisible();
  const pruefBalken = dialog.getByRole('progressbar', { name: 'Datei wird geprüft' });
  await expect(pruefBalken, 'nach dem letzten Byte: Prüfphase ohne Zahl').toBeVisible({
    timeout: 30_000,
  });
  await expect(pruefBalken).not.toHaveAttribute('aria-valuenow');
  await expect(dialog.getByText(/%/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /Ablegen/ })).toHaveClass(/ant-btn-loading/);
  await expect(dialog, 'nach dem Erfolg schließt der Dialog').toBeHidden({ timeout: 60_000 });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  test.info().annotations.push({
    type: 'Zwischenwerte',
    description: [...zwischenwerte].sort((a, b) => a - b).join(', '),
  });
  await expect(page.getByRole('link', { name: 'Lageplan Gross' })).toBeVisible();

  // ── 2 · Entfernen: Zeile steht mit „wird entfernt“ bis zur Serverantwort ─────────────
  await seedeDokument(page, einsatzId, 'Foto Zufahrt', 'foto', 'Foto Zufahrt.jpg', JPG);
  await expect(page.getByRole('link', { name: 'Foto Zufahrt' })).toBeVisible();
  let loeschFrei!: () => void;
  const loeschen = new Promise<void>((res) => (loeschFrei = res));
  await page.route(`**/api/einsaetze/${einsatzId}/dokumente/*`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    await loeschen;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Dokument Foto Zufahrt entfernen' }).click();
  await page
    .locator('.ant-popconfirm:not(.ant-popover-hidden)')
    .getByRole('button', { name: 'Entfernen' })
    .click();
  const zeile = page.locator('tr', { has: page.getByRole('link', { name: 'Foto Zufahrt' }) });
  await expect(zeile, 'die Zeile steht und trägt den Zusatz').toContainText('wird entfernt');
  await expect(zeile.getByRole('button', { name: 'Dokument Foto Zufahrt entfernen' })).toHaveClass(
    /ant-btn-loading/,
  );
  const andere = page.locator('tr', { has: page.getByRole('link', { name: 'Lageplan Gross' }) });
  await expect(andere).not.toContainText('wird entfernt');
  loeschFrei();
  await expect(page.getByRole('link', { name: 'Foto Zufahrt' })).toHaveCount(0);
  await expect(page.getByText('wird entfernt')).toHaveCount(0);
});

test('Bearbeiten: Titel und Kategorie ändern, Datei bleibt, ETB weist die Änderung nach', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Ablage Bearbeiten ${Date.now()}`);
  await seedeDokument(page, einsatzId, 'Lagepaln Nord', 'sonstiges', 'Lageplan Nord.pdf', PDF);
  await page.goto(`/einsaetze/${einsatzId}/dokumente`);

  await page.getByRole('button', { name: 'Dokument Lagepaln Nord bearbeiten' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Dokument bearbeiten' });
  await expect(dialog.getByLabel('Titel'), 'vorbelegt mit dem Stand').toHaveValue('Lagepaln Nord');
  await dialog.getByLabel('Titel').fill('Lageplan Nord');
  await dialog.getByRole('combobox', { name: 'Kategorie' }).click();
  await waehleOption(page, 'Lagekarte/Plan');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();

  const zeile = page.getByRole('row', { name: /Lageplan Nord/ });
  await expect(zeile.getByRole('link', { name: 'Lageplan Nord' })).toBeVisible();
  await expect(zeile.getByText('Lagekarte/Plan')).toBeVisible();
  // Die Datei ist dieselbe: Dateiname und Download bleiben.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    zeile.getByRole('link', { name: 'Lageplan Nord' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Lageplan Nord.pdf');

  const etb = await page.request.get(`/api/einsaetze/${einsatzId}/etb`);
  const eintraege = (await etb.json()) as { typ: string; inhalt: string }[];
  expect(
    eintraege.filter((e) => e.typ === 'system' && e.inhalt.startsWith('Dokument geändert:')),
    'genau ein ETB-Nachweis der Änderung',
  ).toHaveLength(1);
});

/** Höhe eines Ziels in CSS-px, auf eine Nachkommastelle. */
async function hoehe(ziel: Locator): Promise<number> {
  const kasten = await ziel.boundingBox();
  expect(kasten, 'kein Kasten messbar').not.toBeNull();
  return Math.round(kasten!.height * 10) / 10;
}

test.describe('Dichte-Staffel: Download-Anker, Zeilenaktion und Ablegen-Dialog', () => {
  for (const { dichte, soll, sollSM, fuge: fugeBoden, klappkopf: klappkopfBoden } of STAFFEL) {
    test(`${dichte}: Anker, Entfernen und die Dialogziele halten ${soll} px`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
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
      // Eine zweite Zeile, damit der Abstand zwischen den Zielen benachbarter Zeilen messbar ist.
      await seedeDokument(
        page,
        einsatzId,
        'Lageplan Süd',
        'lagekarte_plan',
        'Lageplan Süd.pdf',
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

      await page.getByRole('button', { name: 'Dokument ablegen' }).click();
      const dialog = ablegenDialog(page);
      await expect(dialog.locator('button.ant-btn', { hasText: 'Datei wählen' })).toBeFocused();
      // Erst nach der Zoom-Einblendung messen: währenddessen ist der Dialog skaliert.
      await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);

      const ziele: Record<string, Locator> = {
        'Download-Anker': anker,
        'Bearbeiten (Zeile)': page.getByRole('button', {
          name: 'Dokument Lageplan Nord bearbeiten',
        }),
        'Entfernen (Zeile)': page.getByRole('button', { name: 'Dokument Lageplan Nord entfernen' }),
        'Datei wählen': dialog.locator('button.ant-btn', { hasText: 'Datei wählen' }),
        'Kategorie (Select)': dialog.locator('.ant-select').first(),
        Titel: dialog.getByLabel('Titel'),
        Abbrechen: dialog.getByRole('button', { name: 'Abbrechen' }),
        Ablegen: dialog.getByRole('button', { name: 'Ablegen' }),
      };
      const messwerte: string[] = [];
      for (const [name, ziel] of Object.entries(ziele)) {
        const h = await hoehe(ziel);
        messwerte.push(`${name}: ${h} px`);
        expect(
          h,
          `${name} (${dichte}): gemessen ${h} px, Soll ≥ ${soll} px`,
        ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
      }
      // antds `Collapse` rechnet den Kopf aus der Schrift; den Boden setzt der Kontext
      // (`antdKlappkopf`, LFH-653). Vorher 36 / 45 / 55 px.
      const klappkopf = await hoehe(dialog.locator('.ant-collapse-header'));
      messwerte.push(`Klappkopf „Bezug (optional)": ${klappkopf} px`);
      expect(
        klappkopf,
        `Klappkopf (${dichte}): gemessen ${klappkopf} px, Soll ≥ ${klappkopfBoden} px`,
      ).toBeGreaterThanOrEqual(klappkopfBoden - SUBPIXEL);
      // Fuge der Fußknöpfe der Erfassungs-Hülle (LFH-653, `size="middle"`; vorher 3 / 5 / 7 px).
      const fuge = await waagrechteFuge(ziele.Abbrechen, ziele.Ablegen);
      messwerte.push(`Fuge Abbrechen|Ablegen: ${fuge} px`);
      if (fugeBoden !== null) {
        expect(
          fuge,
          `Fuge Abbrechen|Ablegen (${dichte}): ${fuge} px, Soll ≥ ${fugeBoden} px`,
        ).toBeGreaterThanOrEqual(fugeBoden - SUBPIXEL);
      }
      // Senkrechte Fuge zwischen den Entfernen-Knöpfen zweier Zeilen (Kriterium 2, ≥ 16 px).
      const zeilenziele = await page
        .getByRole('button', { name: /^Dokument Lageplan .* entfernen$/ })
        .evaluateAll((els) =>
          els.map((e) => e.getBoundingClientRect()).sort((a, b) => a.top - b.top),
        );
      expect(zeilenziele, 'zwei Zeilen, zwei Entfernen-Knöpfe').toHaveLength(2);
      const zeilenfuge = Math.round((zeilenziele[1].top - zeilenziele[0].bottom) * 10) / 10;
      messwerte.push(`Fuge Entfernen Zeile 1|2: ${zeilenfuge} px`);
      if (dichte === 'handschuh') {
        expect(
          zeilenfuge,
          `Zeilenfuge im Handschuhbetrieb: ${zeilenfuge} px`,
        ).toBeGreaterThanOrEqual(16);
      }

      // Die Bestätigungsblase baut antd selbst; ihre Fuge kommt aus der Regel in `src/index.css`
      // (`var(--ant-padding)`, LFH-653). Erst den Dialog schließen, dann die Zeilenaktion.
      await ziele.Abbrechen.click();
      await expect(dialog).toBeHidden();
      await page.getByRole('button', { name: 'Dokument Lageplan Nord entfernen' }).click();
      const blase = page.locator('.ant-popconfirm:not(.ant-popover-hidden)');
      const blasenKnoepfe = blase.locator('.ant-popconfirm-buttons button');
      await expect(blasenKnoepfe).toHaveCount(2);
      // Erst nach der Einblendung messen: währenddessen ist die Blase skaliert.
      await expect(page.locator('.ant-zoom-big-appear, .ant-zoom-big-enter')).toHaveCount(0);
      for (const [i, knopf] of [blasenKnoepfe.first(), blasenKnoepfe.last()].entries()) {
        const h = await hoehe(knopf);
        messwerte.push(`Rückfrage Knopf ${i + 1}: ${h} px`);
        expect(
          h,
          `Rückfrage Knopf ${i + 1} (${dichte}): ${h} px, Soll ≥ ${sollSM} px`,
        ).toBeGreaterThanOrEqual(sollSM - SUBPIXEL);
      }
      const blasenfuge = await waagrechteFuge(blasenKnoepfe.first(), blasenKnoepfe.last());
      messwerte.push(`Fuge Rückfrage Abbrechen|Entfernen: ${blasenfuge} px`);
      if (fugeBoden !== null) {
        expect(
          blasenfuge,
          `Fuge der Rückfrage (${dichte}): ${blasenfuge} px, Soll ≥ ${fugeBoden} px`,
        ).toBeGreaterThanOrEqual(fugeBoden - SUBPIXEL);
      }

      await testInfo.attach('Treffflächen', {
        body: `${dichte} (Soll ≥ ${soll} px)\n${messwerte.join('\n')}`,
        contentType: 'text/plain',
      });
    });
  }
});

test('Tastaturweg: Dialog öffnen, Datei wählen, Kategorie, Enter legt ab', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Ablage Tastatur ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/dokumente`);
  await expect(page.getByText('Noch keine Dokumente abgelegt.')).toBeVisible();

  /*
   * Den Dateiwähler abfangen, BEVOR der Tastaturweg beginnt (LFH-687, LFH-536). Playwrights
   * Client schaltet das Abfangen mit dem ersten `filechooser`-Hörer ein, schickt die Nachricht
   * aber ohne auf sie zu warten (`updateSubscription(...).catch(() => {})`). Stand der Hörer erst
   * neben dem Enter, überholte der Tastendruck sie (in rund 11 von 25 CI-Läufen): rc-upload rief
   * `input.click()`, Chromium öffnete den nicht abgefangenen Dialog, und kein Ereignis kam an.
   * Scharf ist das Abfangen hier, lange bevor Enter fällt: dazwischen liegen Dutzende
   * Rundreisen (Dialog, Tab-Reihe). Eine Bestätigung bietet Playwright nicht.
   */
  let waehlerGeoeffnet!: (waehler: FileChooser) => void;
  const waehlerKommt = new Promise<FileChooser>((fertig) => (waehlerGeoeffnet = fertig));
  page.once('filechooser', (waehler) => waehlerGeoeffnet(waehler));

  await page.getByRole('button', { name: 'Dokument ablegen' }).focus();
  await page.keyboard.press('Enter');
  const dialog = ablegenDialog(page);
  const dateiKnopf = dialog.locator('button.ant-btn', { hasText: 'Datei wählen' });
  await expect(dateiKnopf).toBeFocused();
  /*
   * Erst tabben, wenn die Einblendung steht (LFH-536). Ein Tab während `ant-zoom-appear` verlor
   * den Fokus an `<body>`, obwohl alle Folgeziele fokussierbar waren. Am Ende der Einblendung
   * holte rc-dialog (`focusDialogContent`) ihn auf die Dialoghülle zurück, und die Reihe begann
   * bei „Schließen“ neu. Gemessen mit 8-fach gedrosselter CPU: ohne dieses Tor 15 von 20 rot,
   * mit Tor 0 von 20.
   */
  await expect(dialog, 'Dialog fertig eingeblendet').not.toHaveClass(/ant-zoom-(enter|appear)/);

  // Tab-Reihenfolge im Dialog, gemessen: rc-upload hüllt den Knopf in ein `span[role=button]`
  // — wäre das ein eigener Tab-Stopp, stünde er hier doppelt.
  const beschreibe = () =>
    page.evaluate(() => {
      const e = document.activeElement;
      if (!e) return '';
      if (e.tagName === 'BUTTON' || e.getAttribute('role') === 'button') {
        return (
          e.textContent?.trim() || (e.getAttribute('aria-label') ?? e.getAttribute('title') ?? '')
        );
      }
      if (e.tagName === 'A') return `a:${e.textContent?.trim()}`;
      return e.closest('.ant-form-item')?.querySelector('label')?.textContent ?? '';
    });
  const reihe = [await beschreibe()];
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Tab');
    reihe.push(await beschreibe());
  }
  expect(reihe).toEqual([
    'Datei wählen',
    'Kategorie',
    'Titel',
    'Bezug (optional)',
    'Abbrechen',
    'Ablegen',
  ]);
  const rueck: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Shift+Tab');
    rueck.push(await beschreibe());
  }
  expect(rueck, 'rückwärts dieselbe Reihe').toEqual([
    'Abbrechen',
    'Bezug (optional)',
    'Titel',
    'Kategorie',
    'Datei wählen',
  ]);
  await expect(dateiKnopf, 'zurück am ersten Ziel').toBeFocused();

  // Enter auf dem Knopf öffnet den Dateidialog — genau EIN `input.click()` je Tastendruck.
  await page.keyboard.press('Enter');
  const waehler = await waehlerKommt;
  await waehler.setFiles({ name: 'Einsatzbefehl 3.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(dialog.getByLabel('Titel')).toHaveValue('Einsatzbefehl 3');

  // Nach der Wahl ist „Datei entfernen" ein Tab-Stopp, der Dateiname nicht: ohne Vorschau
  // bedient er nichts (antd ≥ 6.6.5 gibt ihm dann weder `role="button"` noch `tabIndex`). Wo
  // der Fokus direkt nach `setFiles` steht, ist keine Produktmessung (Playwright fängt den
  // Dialog ab); gezählt wird nur der Weg bis zur Kategorie.
  const nachWahl: string[] = [];
  const kategorie = dialog.getByRole('combobox', { name: 'Kategorie' });
  for (
    let i = 0;
    i < 4 && !(await kategorie.evaluate((e) => e === document.activeElement));
    i += 1
  ) {
    await page.keyboard.press('Tab');
    nachWahl.push(await beschreibe());
  }
  expect(nachWahl.slice(-2)).toEqual(['Datei entfernen', 'Kategorie']);
  expect(nachWahl, 'der Dateiname ist kein Tab-Stopp').not.toContain('Einsatzbefehl 3.pdf');
  await expect(kategorie).toBeFocused();
  await page.keyboard.type('Befehl');
  // Erst Enter, wenn die Liste auf den einen Treffer gefiltert ist — sonst wählt Enter unter
  // Last den falschen Eintrag.
  const offeneListe = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
  await expect(offeneListe.locator('.ant-select-item-option')).toHaveCount(1);
  await expect(offeneListe.locator('.ant-select-item-option-active')).toHaveText('Befehl');
  await page.keyboard.press('Enter');
  await expect(offeneListe).toHaveCount(0);
  // Der Titel des gewählten Eintrags, nicht der Textinhalt der Hülle (der trägt in antd 6
  // auch den getippten Suchtext).
  await expect(dialog.locator('.ant-select').first().getByTitle('Befehl')).toBeVisible();

  // Enter im Titelfeld ist die eingebaute Formularübermittlung (Knopf im `<form>`).
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Titel')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: 'Einsatzbefehl 3' })).toBeVisible();
});

// Kriterium 5: Tag ≥ 7, Nacht ≥ 5 — als Literale. Seit LFH-652 tragen auch die geerbten Rollen
// diesen Boden, der absolute Boden 4,5 hat hier keine Stelle mehr.
const KONTRAST_ZIEL = { light: 7, dark: 5 } as const;

for (const modus of ['light', 'dark'] as const) {
  test(`Kontrast ${modus}: Zellen, Dialog und Pflichtmeldung`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize(FUEKW);
    await anmelden(page, modus);
    const einsatzId = await einsatzAnlegen(page, `E2E Ablage Kontrast ${modus} ${Date.now()}`);
    await seedeDokument(
      page,
      einsatzId,
      'Lageplan Nord',
      'lagekarte_plan',
      'Lageplan Nord.pdf',
      PDF,
    );
    await page.goto(`/einsaetze/${einsatzId}/dokumente`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    await page.mouse.move(0, 0);

    const zeile = page.locator('.ant-table-tbody tr.ant-table-row').first();
    await expect(zeile).toBeVisible();
    await pruefe(
      zeile.getByText('Lagekarte/Plan', { exact: true }),
      KONTRAST_ZIEL[modus],
      `${modus}/Kategorie`,
    );
    await pruefe(
      // Verfasser · Zeitpunkt (DTG, z. B. „222020SEP2026" — ohne Doppelpunkt).
      zeile.getByText(/^Administrator · /),
      KONTRAST_ZIEL[modus],
      `${modus}/Abgelegt`,
    );

    // Der Titel-Anker ist der geteilte `DownloadAnker` in `bedienText` und trägt den vollen
    // Boden, gemessen am Namensknoten in der Tabellenzelle.
    await pruefe(
      page.getByRole('link', { name: 'Lageplan Nord' }).locator('[data-lfh="download-anker-name"]'),
      KONTRAST_ZIEL[modus],
      `${modus}/Titel-Anker (bedienText)`,
    );

    // App-weite Rollen, die das Modul nur ERBT (LFH-652, Spec `textkontrast-rollen`): sie
    // tragen denselben Boden wie die eigenen Stellen. Der Messwert steht zusätzlich als Anhang.
    const geerbt: Record<string, Locator> = {
      Tabellenkopf: page.locator('.ant-table-thead th').first(),
      'Bezug „—" (Beschreibungstext)': zeile.getByText('—', { exact: true }),
    };
    const werte: string[] = [];
    for (const [name, ziel] of Object.entries(geerbt)) {
      await pruefe(ziel, KONTRAST_ZIEL[modus], `${modus}/${name}`);
      werte.push(`${name}: ${(await kontrast(ziel)).verhaeltnis.toFixed(2)}`);
    }

    await page.getByRole('button', { name: 'Dokument ablegen' }).click();
    const dialog = ablegenDialog(page);
    await expect(dialog.locator('button.ant-btn', { hasText: 'Datei wählen' })).toBeFocused();
    await pruefe(
      dialog.getByText('Datei', { exact: true }),
      KONTRAST_ZIEL[modus],
      `${modus}/Label`,
    );
    await pruefe(
      dialog.locator('button.ant-btn', { hasText: 'Datei wählen' }),
      KONTRAST_ZIEL[modus],
      `${modus}/Datei wählen`,
    );
    await pruefe(dialog.getByText('Bezug (optional)'), KONTRAST_ZIEL[modus], `${modus}/Klappkopf`);
    // Pflichtmeldung: Rot als TEXT liest die Textrolle `alarmText` (LFH-652).
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    const pflicht = dialog.getByText('Bitte eine Datei wählen');
    await pruefe(pflicht, KONTRAST_ZIEL[modus], `${modus}/Pflichtmeldung`);
    werte.push(`Pflichtmeldung: ${(await kontrast(pflicht)).verhaeltnis.toFixed(2)}`);
    // Standardknopf unter dem Zeiger: die Beschriftung wechselt nicht auf den helleren Hover-Ton
    // (LFH-652, Nachtrag aus LFH-690).
    const abbrechen = dialog.locator('button.ant-btn', { hasText: 'Abbrechen' });
    await abbrechen.hover();
    // Erst nach dem Farbübergang messen: mitten in der Transition läge die Beschriftung noch nahe
    // am Ruheton und bestünde den Boden, egal welchen Hover-Ton antd ansteuert.
    await abbrechen.evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
    await pruefe(abbrechen, KONTRAST_ZIEL[modus], `${modus}/Abbrechen unter dem Zeiger`);
    werte.push(`Abbrechen unter dem Zeiger: ${(await kontrast(abbrechen)).verhaeltnis.toFixed(2)}`);
    await testInfo.attach(`Kontrast ${modus}`, {
      body: werte.join('\n'),
      contentType: 'text/plain',
    });
  });
}

test('Fokus nie verdeckt: Tab-Durchlauf durch die Liste unter der stehenden Kopfzeile', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 600 });
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Ablage Fokus ${Date.now()}`);
  for (let i = 1; i <= 20; i += 1) {
    await seedeDokument(page, einsatzId, `Plan ${i}`, 'lagekarte_plan', `Plan ${i}.pdf`, PDF);
  }
  await page.goto(`/einsaetze/${einsatzId}/dokumente`);
  await expect(page.locator('a[download]')).toHaveCount(20);

  const reserve = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(
    reserve,
    'Vorbedingung: die Seite muss scrollen, sonst wandert nichts unter den Kopf',
  ).toBeGreaterThan(200);
  await page.evaluate((z) => window.scrollTo(0, z), Math.round(reserve / 2));

  const befund = await pruefeFokusVerdeckung(page, 80);
  expect(befund.fixierteKandidaten, 'Vorbedingung: es gibt einen fixierten Knoten').toBeGreaterThan(
    0,
  );
  expect(
    befund.stoppsInTabelle,
    `Vorbedingung: der Durchlauf erreicht die Tabelle (${befund.stoppsGesamt} Stopps)`,
  ).toBeGreaterThanOrEqual(8);
  expect(befund.verdeckt, befund.verdeckt.join('\n')).toEqual([]);
  await testInfo.attach('Fokus-Verdeckung', {
    body: `${befund.stoppsGesamt} Stopps, davon ${befund.stoppsInTabelle} in der Tabelle, ${befund.fixierteKandidaten} fixierte Kandidaten, ${befund.verdeckt.length} verdeckt`,
    contentType: 'text/plain',
  });
});

// Kriterium 13 im Dialog: die Maske des Modals und die Kopfleiste sind fixiert; der Durchlauf
// muss jedes Dialogziel besuchen. Bei 390 px in `handschuh` scrollt der Dialog in seiner Hülle
// — dort könnte ein Ziel unter einer fixierten Fläche landen.
for (const viewport of [FUEKW, HANDSCHIRM]) {
  for (const dichte of ['kompakt', 'handschuh'] as const) {
    test(`Fokus nie verdeckt im Ablegen-Dialog bei ${viewport.width} px, ${dichte}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      await anmelden(page);
      const einsatzId = await einsatzAnlegen(page, `E2E Ablage Dialogfokus ${Date.now()}`);
      await page.goto(`/einsaetze/${einsatzId}/dokumente`);
      await stelleDichte(page, dichte);
      await page.getByRole('button', { name: 'Dokument ablegen' }).click();
      const dialog = ablegenDialog(page);
      await expect(dialog.locator('button.ant-btn', { hasText: 'Datei wählen' })).toBeFocused();
      await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
      // Datei gewählt und Bezug aufgeklappt: jedes mögliche Dialogziel steht im Baum.
      await dialog
        .locator('input[type="file"]')
        .setInputFiles({ name: 'Lageplan Nord.pdf', mimeType: 'application/pdf', buffer: PDF });
      await dialog.getByText('Bezug (optional)').click();
      await expect(dialog.getByRole('combobox', { name: 'Bezug' })).toBeVisible();

      const ziele = {
        datei: dialog.locator('button.ant-btn', { hasText: 'Datei wählen' }),
        entfernen: dialog.getByRole('button', { name: 'Datei entfernen' }),
        kategorie: dialog.getByRole('combobox', { name: 'Kategorie' }),
        titel: dialog.getByLabel('Titel'),
        klappkopf: dialog.locator('.ant-collapse-header'),
        bezug: dialog.getByRole('combobox', { name: 'Bezug' }),
        abbrechen: dialog.getByRole('button', { name: 'Abbrechen' }),
        ablegen: dialog.getByRole('button', { name: 'Ablegen' }),
      };
      for (const [name, ziel] of Object.entries(ziele)) {
        await ziel.evaluate((el, n) => el.setAttribute('data-e2e-fokus', n), name);
      }
      await ziele.datei.focus();

      const befund = await pruefeFokusVerdeckung(page, 24);
      expect(befund.besuchteZiele.sort(), 'jedes Dialogziel muss per Tab besucht werden').toEqual(
        Object.keys(ziele).sort(),
      );
      expect(befund.fixierteKandidaten, 'Vorbedingung: es gibt fixierte Flächen').toBeGreaterThan(
        0,
      );
      expect(befund.verdeckt, befund.verdeckt.join('\n')).toEqual([]);
      const scrollt = await page
        .locator('.ant-modal-wrap')
        .evaluate((w) => w.scrollHeight > w.clientHeight);
      await testInfo.attach('Fokus-Verdeckung Dialog', {
        body: `${viewport.width}px ${dichte}: ${befund.stoppsGesamt} Stopps, ${befund.besuchteZiele.length} Dialogziele, ${befund.fixierteKandidaten} fixierte Kandidaten, ${befund.verdeckt.length} verdeckt, Dialog scrollt: ${scrollt}`,
        contentType: 'text/plain',
      });
    });
  }
}
