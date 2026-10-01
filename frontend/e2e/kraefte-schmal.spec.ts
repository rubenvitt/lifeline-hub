import { expect, test, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';

/**
 * Die Kräfte-Module am Handschirm:
 *  1. Kein waagerechter Bildlauf auf 390 px, auf allen vier Modulrouten (dichteunabhängig).
 *  2. Der Statuswechsel ist ein Bedienziel der Dichtestufe (ein `Select` mit fester
 *     `minWidth` war auf der 390-px-Karte nicht erreichbar).
 *  3. „Einheit bilden" persistiert vor dem Absenden nichts.
 *
 * DIE SCHWELLE IST DIE STAFFEL (48 bzw. 72), nicht die 44 aus WCAG 2.5.5 — ein Test auf 44
 * ließe eine Regression auf 44–47 px durch.
 *
 * `hasTouch` (nur per `test.use`): ohne es bliebe `(pointer: coarse)` false und die Stufe
 * `kompakt`. `zeigerIstGrob()` belegt mit Touch `komfortabel` vor; die `data-dichte`-Wache
 * trennt „Ziel zu klein" von „Stufe nicht angekommen".
 *
 * Kein `networkidle` (SSE-Strom), kein Device-Descriptor (zöge webkit nach).
 */
test.use({ hasTouch: true });

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const HANDSCHIRM = { width: 390, height: 844 };

/** Die Dichte-Staffel als Literale — aus `theme/tokens` importiert prüfte der Test sich selbst. */
const STAFFEL = [
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

/** Subpixel-Spielraum: `boundingBox()` liefert Fließkomma, Chromium rechnet unter Last anders. */
const SUBPIXEL = 0.5;

/** Schlüssel aus `theme/ThemeModeProvider.tsx`. Bewusst literal — der Wert ist Vertrag. */
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

const FUNKRUFNAME = 'Florian Musterstadt 44/1';
const KRAFT = 'Kirchgassner-Wohlfahrt, Maximiliane';
const MATERIAL = 'Wolldecke';

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

/** Seeding per `page.request`: die Session ist Cookie-basiert, der Jar wird geteilt. */
async function seede(page: Page, einsatzId: string, pfad: string, data: unknown, was: string) {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
  expect(antwort.ok(), `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
}

async function seedeAlles(page: Page, einsatzId: string) {
  await seede(
    page,
    einsatzId,
    'fahrzeuge',
    { adhoc: { funkrufname: FUNKRUFNAME, fahrzeugtyp: 'LF 20' } },
    'Fahrzeug',
  );
  await seede(
    page,
    einsatzId,
    'personal',
    { adhoc: { name: KRAFT, funktion: 'Abschnittsleitung' } },
    'Personal',
  );
  await seede(
    page,
    einsatzId,
    'material',
    { adhoc: { bezeichnung: MATERIAL, menge: 12 } },
    'Material',
  );
  await seede(page, einsatzId, 'einheiten', { name: '1. Zug' }, 'Einheit');
}

/**
 * Breite des Dokuments gegen die Sichtfläche. Die Wache zeigt auf den INHALT: der Aufrufer
 * nennt einen Wortlaut, der erst MIT den Daten erscheint — ohne Zeilen gibt es keinen
 * Überlauf, und ein Test vor dem Inhalt prüfte den Ladebildschirm. `poll` fängt zusätzlich ein
 * Layout, das erst nach dem ersten Bild in seine Endbreite wächst.
 */
async function keinQuerlauf(
  page: Page,
  pfad: string,
  inhaltsWortlaut: string | RegExp,
  vorbedingung?: () => Promise<void>,
) {
  await page.goto(pfad);
  await expect(
    page.getByText(inhaltsWortlaut).first(),
    `${pfad}: der Inhalt muss vor der Messung stehen — sonst misst der Test den Ladezustand`,
  ).toBeVisible();
  // Zwischen Anker und Messung: der Rollenzweig muss stehen (LFH-435), sonst mäße ein
  // Nicht-Admin-Durchgang still den Admin-Zweig.
  if (vorbedingung) await vorbedingung();
  await expect
    .poll(
      async () =>
        page
          .evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
          }))
          .then((m) => m.scroll - m.client),
      {
        message: `${pfad} läuft waagerecht über`,
      },
    )
    .toBeLessThanOrEqual(SUBPIXEL);
}

test('bei 390 px läuft keine der vier Kräfte-Routen waagerecht über', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Kraefte schmal ${Date.now()}`);
  await seedeAlles(page, einsatzId);

  await page.setViewportSize(HANDSCHIRM);

  // Je Route ein Wortlaut, der erst MIT den Daten erscheint — siehe `keinQuerlauf`.
  const routen: [string, string][] = [
    ['fahrzeuge', FUNKRUFNAME],
    ['personal', KRAFT],
    ['material', MATERIAL],
    ['einheiten', '1. Zug'],
  ];
  for (const [modul, wortlaut] of routen) {
    await keinQuerlauf(page, `/einsaetze/${einsatzId}/${modul}`, wortlaut);
  }
});

/**
 * LFH-435 · Zweig: Beobachter (kein Schreibrecht). Die Karten verlieren Statusauslöser und
 * „Entfernen", der Kopf seine Dispositionsfelder, Einheiten und Meldebild ihre Primäraktion.
 * Gemessen wird wie oben, dazu das Meldebild (`kraefteuebersicht`), das im Nur-Lese-Zweig
 * ebenfalls Knöpfe verliert.
 *
 * Jede Abwesenheit steht neben einem Geschwister, das BLEIBT (Ansicht-Umschalter, Drucken,
 * Karte): erst dessen Sichtbarkeit belegt, dass der Slot überhaupt gerendert hat — sonst wäre
 * `toHaveCount(0)` auch bei einem Tippfehler im Namen grün.
 */
test('bei 390 px läuft keine der Kräfte-Routen waagerecht über (Beobachter)', async ({ page }) => {
  // Zusätzliche Anmeldung und eine Route mehr als der Admin-Geschwister.
  test.slow();
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Kraefte schmal lesend ${Date.now()}`);
  await seedeAlles(page, einsatzId);
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  await page.setViewportSize(HANDSCHIRM);
  const karte = page.locator('[data-lfh="datensicht-karte"]');
  const hauptteil = page.getByRole('main');

  const routen: [string, string, () => Promise<void>][] = [
    [
      'fahrzeuge',
      FUNKRUFNAME,
      async () => {
        await expect(karte, 'Vorbedingung: genau eine Fahrzeugkarte').toHaveCount(1);
        await expect(
          page.getByRole('radiogroup', { name: 'Ansicht' }),
          'Vorbedingung: der Ansicht-Umschalter bleibt auch ohne Schreibrecht',
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: `Status von ${FUNKRUFNAME} ändern` }),
          'Vorbedingung: ohne Schreibrecht kein Statusauslöser (FahrzeugePage `statusBedienung`)',
        ).toHaveCount(0);
        await expect(
          karte.getByRole('combobox'),
          'Vorbedingung: die Karte trägt keine Besatzungs-Auswahl',
        ).toHaveCount(0);
        await expect(
          karte.getByRole('button', { name: `Besatzung zu ${FUNKRUFNAME}` }),
          'Vorbedingung: der lesende Aufklapper der Besatzung steht (LFH-697)',
        ).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Ad-hoc-Fahrzeug' })).toHaveCount(0);
      },
    ],
    [
      'personal',
      KRAFT,
      async () => {
        await expect(karte, 'Vorbedingung: genau eine Personalkarte').toHaveCount(1);
        await expect(
          page.getByRole('button', { name: `Status von ${KRAFT} ändern` }),
          'Vorbedingung: ohne Schreibrecht kein Statusauslöser (PersonalPage `statusBedienung`)',
        ).toHaveCount(0);
        // Strukturell statt per Name: die Admin-Karte trägt Statusauslöser UND „Entfernen". Einzige
        // Ausnahme ist der LESENDE Aufklapper der Kräfte-Zeitachse (LFH-552) — er steht in jeder
        // Rolle und wird hier eigens gezählt.
        await expect(
          karte.getByRole('button', { name: /^(?!Zeitachse zu )/ }),
          'Vorbedingung: die Personalkarte trägt ohne Schreibrecht kein schreibendes Bedienziel',
        ).toHaveCount(0);
        await expect(
          karte.getByRole('button', { name: `Zeitachse zu ${KRAFT}` }),
          'Vorbedingung: der lesende Aufklapper der Zeitachse steht',
        ).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Ad-hoc-Person' })).toHaveCount(0);
      },
    ],
    [
      'material',
      MATERIAL,
      async () => {
        await expect(karte, 'Vorbedingung: genau eine Materialkarte').toHaveCount(1);
        await expect(
          page.getByRole('button', { name: `Status von ${MATERIAL} ändern` }),
          'Vorbedingung: ohne Schreibrecht kein Statusauslöser (MaterialPage `statusBedienung`)',
        ).toHaveCount(0);
      },
    ],
    [
      'einheiten',
      '1. Zug',
      async () => {
        await expect(
          hauptteil.getByRole('button', { name: 'Einheit bilden', exact: true }),
          'Vorbedingung: ohne Schreibrecht kein „Einheit bilden"',
        ).toHaveCount(0);
      },
    ],
    [
      'kraefteuebersicht',
      '1. Zug',
      async () => {
        await expect(
          page.getByRole('button', { name: /Drucken/ }).first(),
          'Vorbedingung: der Druckknopf bleibt — die Werkzeugzeile ist gerendert',
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'In Lagebericht übernehmen' }),
          'Vorbedingung: ohne Schreibrecht kein „In Lagebericht übernehmen"',
        ).toHaveCount(0);
        await expect(
          page.getByRole('button', { name: 'Einheit', exact: true }),
          'Vorbedingung: ohne Schreibrecht keine Primäraktion „Einheit"',
        ).toHaveCount(0);
      },
    ],
  ];
  for (const [modul, wortlaut, vorbedingung] of routen) {
    await keinQuerlauf(page, `/einsaetze/${einsatzId}/${modul}`, wortlaut, vorbedingung);
  }
});

for (const { dichte, soll } of STAFFEL) {
  test(`Stufe ${dichte}: der Statuswechsel ist auf 390 px ein Ziel von ${soll} px`, async ({
    page,
  }) => {
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `Statusziel ${dichte} ${Date.now()}`);
    await seedeAlles(page, einsatzId);

    await page.setViewportSize(HANDSCHIRM);

    if (dichte === 'handschuh') {
      // Eine GESPEICHERTE Wahl gewinnt gegen die Zeigerart — nur so ist die Handschuh-Stufe
      // erreichbar; wirksam erst nach dem Neuladen.
      await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
      await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
        DICHTE_SCHLUESSEL,
        dichte,
      ] as const);
      await page.reload();
    } else {
      await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
    }

    // Erste Zusicherung: die Stufe ist angekommen.
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

    // Auf 390 px steht der Kartenzweig; dort trägt der Statuswechsel sein Bedienziel.
    const karte = page.locator('[data-lfh="datensicht-karte"]');
    await expect(karte.first()).toBeVisible();

    const ausloeser = page.getByRole('button', { name: `Status von ${FUNKRUFNAME} ändern` });
    await expect(ausloeser, 'genau ein Statusauslöser je Karte').toHaveCount(1);

    const kasten = await ausloeser.boundingBox();
    expect(kasten, 'Statusauslöser nicht messbar').not.toBeNull();
    expect(
      kasten!.height,
      `Statusauslöser (gemessen ${kasten!.height} px) soll die Stufe ${dichte} halten`,
    ).toBeGreaterThanOrEqual(soll - SUBPIXEL);

    // Und er BEDIENT auch. Das Menü liegt im Portal — deshalb seitenweit gesucht.
    await ausloeser.click();
    await expect(
      page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]'),
    ).toBeVisible();
  });
}

test('„Einheit bilden" persistiert erst beim Absenden — und nie als „Neue Einheit"', async ({
  page,
}) => {
  /**
   * Gemessen wird der PERSISTIERTE Bestand über die API, nicht die Anzeige.
   */
  await anmelden(page);
  /**
   * Der Einsatzname darf die Knopfbeschriftung nicht enthalten: der Einsatz-Switcher in der
   * Kopfzeile trägt den Namen als eigenen Knopf, und die Knopfabfrage träfe ihn.
   */
  const einsatzId = await einsatzAnlegen(page, `Gliederung ${Date.now()}`);
  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/einheiten`);

  // Auf den Seiteninhalt gescopt (die Kopfzeile trägt eigene Knöpfe), `exact` gegen Zusätze.
  const bildenKnopf = page
    .getByRole('main')
    .getByRole('button', { name: 'Einheit bilden', exact: true })
    .first();

  const anzahlEinheiten = async () => {
    const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/einheiten`);
    expect(antwort.ok()).toBeTruthy();
    return ((await antwort.json()) as unknown[]).length;
  };

  const vorher = await anzahlEinheiten();

  // Öffnen und ABBRECHEN: die Zahl bleibt gleich.
  await bildenKnopf.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  expect(await anzahlEinheiten(), 'Abbrechen darf nichts anlegen').toBe(vorher);

  // Absenden MIT Namen: genau ein Datensatz, und er heisst wie eingegeben.
  await bildenKnopf.click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill('2. Zug');
  await dialog.getByRole('button', { name: 'Bilden' }).click();

  await expect
    .poll(anzahlEinheiten, { message: 'Absenden legt genau eine Einheit an' })
    .toBe(vorher + 1);

  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/einheiten`);
  const namen = ((await antwort.json()) as { name: string }[]).map((e) => e.name);
  expect(namen).toContain('2. Zug');
  expect(namen, 'kein Platzhalter-Datensatz').not.toContain('Neue Einheit');
});
