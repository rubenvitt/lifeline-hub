import { expect, test, type Locator, type Page } from '@playwright/test';
import { pruefeFokusVerdeckung } from './fokus-kern';
import { kontrast, pruefe } from './kontrast-kern';

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
 * selbst. Die Sollwerte stehen als Literale (30 / 48 / 72) — aus dem Token zurückgelesen prüfte
 * der Test den Token gegen sich selbst. Dieselbe Messung deckt Zeilenaktion und Dialogziele.
 *
 * Die übrigen Tests sind die Belege der Prüfliste Einsatztauglichkeit
 * (`docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md`): Tastaturweg (Kriterium 15),
 * Kontrast in beiden Modi (5) und Fokus-Verdeckung unter der stehenden Kopfzeile (13). Was
 * dort nur gemessen und nicht zugesichert wird (geerbte App-Rollen, Klappkopf, Knopffuge),
 * steht als Anhang am Test und als „offen" in der Prüfliste.
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
  { dichte: 'kompakt', soll: 30 },
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

const PDF = Buffer.from('%PDF-1.4 e2e');
const JPG = Buffer.from('\xff\xd8\xff\xe0 e2e', 'binary');

// Login-/Anlege-Helfer kopiert — es gibt (noch) kein geteiltes e2e-Hilfsmodul
// (gleichlautend in sechs Bestands-Specs vermerkt).
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
  // Ganzer Weg mit zwei Ablagen: unter Gate-Last (vier Shards, Rust-Suite daneben) reicht
  // die Vorgabe von 30 s nicht.
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Ablage ${Date.now()}`);

  // Der Navigationsrahmen steht ab `lg` inline; sein Zähler ist der zweite Beleg dafür, dass
  // die Ablage wirklich im Bestand landet (Query-Key `einsatz-dokumente`, gemeinsam genutzt).
  // Angesteuert wird über die Modulzeile, nicht per `goto`: der Einstieg über die Navigation
  // ist Teil des AK (Kategorie „Führung", die Startkategorie eines Einsatzes).
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
  // DIE Aussage, die jsdom nicht tragen kann: der verborgene `input[type=file]` ist im
  // Browser nicht fokussierbar, der Knopf holt den Fokus per `requestAnimationFrame`.
  await expect(
    dialog.locator('button.ant-btn', { hasText: 'Datei wählen' }),
    'Fokus liegt beim Öffnen auf „Datei wählen"',
  ).toBeFocused();
  await expect(
    dialog.locator('input[type="file"]'),
    'der verborgene Datei-Input trägt den Fokus NICHT',
  ).not.toBeFocused();
  // Dieselbe Aussage direkt am `document.activeElement` — weder `<body>` noch der Input,
  // sondern der native `<button>` mit dem Wortlaut „Datei wählen".
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

  // Entfernen im Kartenzweig: Auslöser neutral, OK der Rückfrage rot (E1 gilt auch unter md),
  // der zugängliche Name trägt den Titel (n Karten ≠ n gleichnamige Knöpfe).
  const entfernenKarte = page.getByRole('button', { name: 'Dokument Lageplan Nord entfernen' });
  await expect(entfernenKarte, 'der Auslöser ist NICHT rot').not.toHaveClass(/ant-btn-dangerous/);
  await entfernenKarte.click();
  // Das Primitiv setzt kein `okText` — gegriffen wird der Primärknopf der offenen Rückfrage.
  const ok = page.locator('.ant-popconfirm:not(.ant-popover-hidden) .ant-btn-primary');
  await expect(ok, 'das OK der Rückfrage ist rot').toHaveClass(/ant-btn-dangerous/);
  await ok.click();
  await expect(page.getByRole('link', { name: 'Lageplan Nord' })).toHaveCount(0);
  await expect(page.getByText('Noch keine Dokumente abgelegt.')).toBeVisible();
});

/** Höhe eines Ziels in CSS-px, auf eine Nachkommastelle. */
async function hoehe(ziel: Locator): Promise<number> {
  const kasten = await ziel.boundingBox();
  expect(kasten, 'kein Kasten messbar').not.toBeNull();
  return Math.round(kasten!.height * 10) / 10;
}

test.describe('Dichte-Staffel: Download-Anker, Zeilenaktion und Ablegen-Dialog', () => {
  for (const { dichte, soll } of STAFFEL) {
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
      // Erst nach der Zoom-Einblendung messen: währenddessen ist der Dialog skaliert, und ein
      // 48-px-Knopf misst gemessen 36 px (erster Lauf dieses Tests unter Last).
      await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);

      const ziele: Record<string, Locator> = {
        'Download-Anker': anker,
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
      // NUR GEMESSEN, NICHT ZUGESICHERT — beide liegen unter der Staffel und gehören nicht dem
      // Modul: der Klappkopf ist antds `Collapse` (kein `controlHeight`), der Abstand der
      // Fußknöpfe kommt aus der Erfassungs-Hülle. Die Zahlen stehen in der Prüfliste (Nr. 2).
      const klappkopf = await hoehe(dialog.locator('.ant-collapse-header'));
      const abbrechen = (await ziele.Abbrechen.boundingBox())!;
      const ablegen = (await ziele.Ablegen.boundingBox())!;
      const fuge = Math.round((ablegen.x - (abbrechen.x + abbrechen.width)) * 10) / 10;
      messwerte.push(
        `Klappkopf „Bezug (optional)": ${klappkopf} px`,
        `Fuge Abbrechen|Ablegen: ${fuge} px`,
      );
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

  await page.getByRole('button', { name: 'Dokument ablegen' }).focus();
  await page.keyboard.press('Enter');
  const dialog = ablegenDialog(page);
  const dateiKnopf = dialog.locator('button.ant-btn', { hasText: 'Datei wählen' });
  await expect(dateiKnopf).toBeFocused();

  // Tab-Reihenfolge im Dialog, GEMESSEN statt aus dem Quelltext gelesen: rc-upload hüllt den
  // Knopf in ein `span[role=button]` — wäre das ein eigener Tab-Stopp, stünde er hier doppelt.
  // Knopf und Klappkopf über ihren Wortlaut, Felder über ihr Label.
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

  // Leertaste auf dem Knopf öffnet den Dateidialog des Browsers — der Weg ohne Maus zur Datei.
  // NICHT Enter: rc-upload hängt an seiner Hülle einen eigenen Enter-Handler (`onKeyDown`),
  // und der native Knopf löst bei Enter zusätzlich `click` aus — zwei `input.click()` in einer
  // Geste, von denen Chromium nur einen bedient (gemessen: der Wähler kam nicht jedes Mal).
  const [waehler] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.keyboard.press('Space'),
  ]);
  await waehler.setFiles({ name: 'Einsatzbefehl 3.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(dialog.getByLabel('Titel')).toHaveValue('Einsatzbefehl 3');

  // Nach der Wahl steht die Datei als Listeneintrag mit „Datei entfernen" im Dialog — beide
  // sind Tab-Stopps, die gewählte Datei lässt sich also ohne Maus wieder verwerfen. Wo der
  // Fokus unmittelbar nach `setFiles` steht, ist KEINE Produktmessung: Playwright fängt den
  // Dateidialog ab, ein echter Dialog gibt den Fokus beim Schließen selbst zurück. Gezählt
  // wird deshalb nur der Weg bis zur Kategorie.
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
  expect(nachWahl.slice(-3)).toEqual(['Einsatzbefehl 3.pdf', 'Datei entfernen', 'Kategorie']);
  await expect(kategorie).toBeFocused();
  await page.keyboard.type('Befehl');
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.ant-select').first()).toContainText('Befehl');

  // Enter im Titelfeld ist die eingebaute Formularübermittlung (Knopf im `<form>`, LFH-332).
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Titel')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: 'Einsatzbefehl 3' })).toBeVisible();
});

// Kriterium 5: Tag ≥ 7, Nacht ≥ 5, nie < 4,5 — als Literale (Muster `hellmodus-kontrast`).
const KONTRAST_ZIEL = { light: 7, dark: 5 } as const;
const KONTRAST_BODEN = 4.5;

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

    // App-weite Rollen, die dieses Modul nur ERBT (Linkfarbe, Tabellenkopf, Sekundärtext):
    // zugesichert ist der absolute Boden, der Messwert steht als Anhang und in der Prüfliste.
    const geerbt: Record<string, Locator> = {
      'Titel-Anker (Linkfarbe)': page.getByRole('link', { name: 'Lageplan Nord' }),
      Tabellenkopf: page.locator('.ant-table-thead th').first(),
      'Bezug „—" (Sekundärtext)': zeile.getByText('—', { exact: true }),
    };
    const werte: string[] = [];
    for (const [name, ziel] of Object.entries(geerbt)) {
      await pruefe(ziel, KONTRAST_BODEN, `${modus}/${name}`);
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
    // Pflichtmeldung: leeres Absenden. Rot als TEXT ist eine app-weite Rolle (antds
    // `colorError`), deshalb auch hier nur der Boden plus Messwert.
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    const pflicht = dialog.getByText('Bitte eine Datei wählen');
    await pruefe(pflicht, KONTRAST_BODEN, `${modus}/Pflichtmeldung`);
    werte.push(`Pflichtmeldung (colorError): ${(await kontrast(pflicht)).verhaeltnis.toFixed(2)}`);
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
