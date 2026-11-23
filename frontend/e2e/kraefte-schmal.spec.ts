import { expect, test, type Page } from '@playwright/test';
import { dialogSteht, eingeblendet } from './dialog-kern';
import { wechsleZuRolle } from './rollen-kern';
import { einsatzAnlegen, einsatzPerApi } from './einsatz-kern';
import { anmeldenPerApi } from './anmelde-kern';

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

async function anmelden(page: Page, optionen?: { startseite?: boolean }) {
  await anmeldenPerApi(page, ADMIN, PW, optionen);
}

/** Seeding per `page.request`: die Session ist Cookie-basiert, der Jar wird geteilt. */
async function seede(
  page: Page,
  einsatzId: string,
  pfad: string,
  data: unknown,
  was: string,
): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
  expect(antwort.ok(), `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

/** Liefert die ID der Kraft für die Personenansicht. */
async function seedeAlles(page: Page, einsatzId: string): Promise<number> {
  await seede(
    page,
    einsatzId,
    'fahrzeuge',
    { adhoc: { funkrufname: FUNKRUFNAME, fahrzeugtyp: 'LF 20' } },
    'Fahrzeug',
  );
  // Langer Träger: Funktion, Träger und Einsatzdauer stehen in der Kopfzeile der Personenansicht.
  const kraftId = await seede(
    page,
    einsatzId,
    'personal',
    {
      adhoc: {
        name: KRAFT,
        funktion: 'Abschnittsleitung',
        traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest',
      },
    },
    'Personal',
  );
  await seede(
    page,
    einsatzId,
    'material',
    // Menge > 1: ein Verbrauchsgut, dessen Menge bearbeitbar ist (LLH-1224 D2; ein Gerät zeigt
    // „1“ ohne Bearbeiten). Die Menge steht neben `adhoc`, nicht darin.
    { adhoc: { bezeichnung: MATERIAL }, menge: 12 },
    'Material',
  );
  await seede(page, einsatzId, 'einheiten', { name: '1. Zug' }, 'Einheit');
  return kraftId;
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

/**
 * Je Route ein Test (LLH-2081): als ein Test lud der Admin-Fall fünf ganze Seiten, ruhig 14 s,
 * unter Last (4 Worker) über dem Testlimit; der Beobachter-Fall mit sechs Seiten und
 * Rollenwechsel brauchte `test.slow()`. Jetzt meldet jeder Test an, legt Einsatz und Bestand über
 * die API an (der Fall prüft den Dialog nicht, `e2e/AGENTS.md`) und lädt genau eine Seite.
 */
async function routenEinsatz(page: Page, name: string) {
  await anmelden(page, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `${name} ${Date.now()}`);
  const kraftId = await seedeAlles(page, einsatzId);
  return { einsatzId, kraftId };
}

/** Die Personenansicht (LLH-1060) braucht die ID der Kraft; der Platzhalter steht für sie. */
const PERSONENANSICHT = 'personal/:kraftId';

function routenPfad(einsatzId: string, modul: string, kraftId: number) {
  return `/einsaetze/${einsatzId}/${modul.replace(':kraftId', String(kraftId))}`;
}

/** Je Route ein Wortlaut, der erst MIT den Daten erscheint — siehe `keinQuerlauf`. */
const ADMIN_ROUTEN = [
  { titel: 'Fahrzeuge', modul: 'fahrzeuge', wortlaut: FUNKRUFNAME },
  { titel: 'Personal', modul: 'personal', wortlaut: KRAFT },
  { titel: 'Material', modul: 'material', wortlaut: MATERIAL },
  { titel: 'Einheiten', modul: 'einheiten', wortlaut: '1. Zug' },
  // Ihr Kopf trägt Funktion, Träger und Einsatzdauer.
  {
    titel: 'Personenansicht',
    modul: PERSONENANSICHT,
    wortlaut: 'Freiwillige Feuerwehr Musterstadt-Nordwest',
  },
] as const;

for (const { titel, modul, wortlaut } of ADMIN_ROUTEN) {
  test(`bei 390 px läuft die Kräfte-Route ${titel} nicht waagerecht über`, async ({ page }) => {
    const { einsatzId, kraftId } = await routenEinsatz(page, `Kraefte schmal ${titel}`);
    await page.setViewportSize(HANDSCHIRM);
    await keinQuerlauf(page, routenPfad(einsatzId, modul, kraftId), wortlaut);
  });
}

/**
 * LFH-435 · Zweig: Beobachter (kein Schreibrecht). Die Karten verlieren Statusauslöser, die
 * Personalkarte die Inline-Angaben der Einteilung, die Materialkarte „Aus dem Einsatz nehmen",
 * der Kopf seine Dispositionsfelder,
 * Einheiten und Meldebild ihre Primäraktion.
 * Gemessen wird wie oben, dazu das Meldebild (`kraefteuebersicht`), das im Nur-Lese-Zweig
 * ebenfalls Knöpfe verliert.
 *
 * Jede Abwesenheit steht neben einem Geschwister, das BLEIBT (Ansicht-Umschalter, Drucken,
 * Karte): erst dessen Sichtbarkeit belegt, dass der Slot überhaupt gerendert hat — sonst wäre
 * `toHaveCount(0)` auch bei einem Tippfehler im Namen grün.
 */
const BEOBACHTER_ROUTEN: {
  titel: string;
  modul: string;
  wortlaut: string;
  vorbedingung: (page: Page) => Promise<void>;
}[] = [
  {
    titel: 'Fahrzeuge',
    modul: 'fahrzeuge',
    wortlaut: FUNKRUFNAME,
    vorbedingung: async (page) => {
      const karte = page.locator('[data-lfh="datensicht-karte"]');
      await expect(karte, 'Vorbedingung: genau eine Fahrzeugkarte').toHaveCount(1);
      // Bei 390 px steht die Ansicht hinter „Filter“ (LLH-1786); der Knopf bleibt ohne Schreibrecht.
      await expect(
        page.locator('[data-lfh="seitenkopf"]').getByRole('button', { name: /^Filter/ }),
        'Vorbedingung: der Filterknopf mit der Ansicht bleibt auch ohne Schreibrecht',
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
        karte.getByRole('button', { name: `Details zu ${FUNKRUFNAME}` }),
        'Vorbedingung: der lesende Aufklapper der Besatzung steht (LFH-697)',
      ).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Ad-hoc-Fahrzeug' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Fahrzeuge disponieren' })).toHaveCount(0);
    },
  },
  {
    titel: 'Personal',
    modul: 'personal',
    wortlaut: KRAFT,
    vorbedingung: async (page) => {
      const karte = page.locator('[data-lfh="datensicht-karte"]');
      await expect(karte, 'Vorbedingung: genau eine Personalkarte').toHaveCount(1);
      await expect(
        page.getByRole('button', { name: `Status von ${KRAFT} ändern` }),
        'Vorbedingung: ohne Schreibrecht kein Statusauslöser (PersonalPage `statusBedienung`)',
      ).toHaveCount(0);
      // Strukturell statt per Name: die Admin-Karte trägt Statusauslöser und die Inline-Angaben
      // der Einteilung. Seit LLH-1060 gibt es keinen Aufklapper der Zeitachse mehr; der Name
      // führt in die Personenansicht, in jeder Rolle.
      await expect(
        karte.getByRole('button'),
        'Vorbedingung: die Personalkarte trägt ohne Schreibrecht keinen Knopf',
      ).toHaveCount(0);
      await expect(
        karte.getByRole('link', { name: KRAFT }),
        'Vorbedingung: der Name führt in die Personenansicht',
      ).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Ad-hoc-Person' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Personal disponieren' })).toHaveCount(0);
    },
  },
  {
    // Die Personenansicht (LLH-1060) im Nur-Lese-Zweig: Hinweis statt Bedienung.
    titel: 'Personenansicht',
    modul: PERSONENANSICHT,
    wortlaut: 'Freiwillige Feuerwehr Musterstadt-Nordwest',
    vorbedingung: async (page) => {
      const hauptteil = page.getByRole('main');
      await expect(
        hauptteil.getByText(/^Nur Ansicht/).first(),
        'Vorbedingung: der Hinweis „Nur Ansicht“ steht',
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: `${KRAFT} entlassen` }),
        'Vorbedingung: ohne Schreibrecht kein „Entlassen“',
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Stornieren' }),
        'Vorbedingung: ohne Schreibrecht kein „Stornieren“',
      ).toHaveCount(0);
      await expect(
        hauptteil.getByRole('button', { name: /bearbeiten$|eintragen$/ }),
        'Vorbedingung: keine Angabe ist bearbeitbar',
      ).toHaveCount(0);
    },
  },
  {
    titel: 'Material',
    modul: 'material',
    wortlaut: MATERIAL,
    vorbedingung: async (page) => {
      const karte = page.locator('[data-lfh="datensicht-karte"]');
      await expect(karte, 'Vorbedingung: genau eine Materialkarte').toHaveCount(1);
      await expect(
        page.getByRole('button', { name: `Status von ${MATERIAL} ändern` }),
        'Vorbedingung: ohne Schreibrecht kein Statusauslöser (MaterialPage `statusBedienung`)',
      ).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Material disponieren' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Ad-hoc-Material' })).toHaveCount(0);
      // Nur Ansicht: die Menge steht als Zahl, nicht als Feld.
      await expect(page.getByRole('spinbutton')).toHaveCount(0);
    },
  },
  {
    titel: 'Einheiten',
    modul: 'einheiten',
    wortlaut: '1. Zug',
    vorbedingung: async (page) => {
      await expect(
        page.getByRole('main').getByRole('button', { name: 'Einheit bilden', exact: true }),
        'Vorbedingung: ohne Schreibrecht kein „Einheit bilden"',
      ).toHaveCount(0);
    },
  },
  {
    titel: 'Meldebild',
    modul: 'kraefteuebersicht',
    wortlaut: '1. Zug',
    vorbedingung: async (page) => {
      // Drucken ist ein Nebenweg des Kopfs (LLH-1786), bei 390 px hinter „Weitere“.
      await expect(
        page.getByRole('button', { name: 'Weitere Aktionen zum Meldebild' }),
        'Vorbedingung: der Auslöser der Nebenwege steht — Drucken bleibt erreichbar',
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
  },
];

for (const { titel, modul, wortlaut, vorbedingung } of BEOBACHTER_ROUTEN) {
  test(`bei 390 px läuft die Kräfte-Route ${titel} nicht waagerecht über (Beobachter)`, async ({
    page,
  }) => {
    const { einsatzId, kraftId } = await routenEinsatz(page, `Kraefte schmal lesend ${titel}`);
    await wechsleZuRolle(page, 'beobachter', einsatzId);
    await page.setViewportSize(HANDSCHIRM);
    await keinQuerlauf(page, routenPfad(einsatzId, modul, kraftId), wortlaut, () =>
      vorbedingung(page),
    );
  });
}

/**
 * LFH-983: Der Seitenkopf der drei Kräfte-Seiten ÖFFNET nur. Kein Auswahl- und kein Mengenfeld im
 * Kopf, kein englischer Stufentext von rc-input-number im DOM, auf allen vier Schirmen. Am Desktop
 * steht der Kopf einzeilig: alle Knöpfe auf einer Höhe, der Titel so hoch wie bei Personal.
 * Der Beobachter-Zweig steht im Test darüber (kein Disponier-Knopf).
 *
 * Je Schirm ein Test (LLH-2069): als ein Test lud der Fall 19 ganze Seiten, ruhig 51 s, unter Last
 * (4 Worker) über dem Testlimit, an wechselnden späten Stellen. Der Einsatz kommt über die API,
 * weil der Fall den Dialog nicht prüft; Material steht zuletzt, damit seine Dialoge ohne zweites
 * `goto` auf der schon geladenen Seite laufen.
 */
const SCHIRME = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
  { width: 1440, height: 900 },
] as const;

/** Meldet an, legt Einsatz und Bestand über die API an; liefert die Einsatz-ID. */
async function kopfEinsatz(page: Page, schirm: { width: number; height: number }) {
  await anmelden(page, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `Kopf oeffnet ${schirm.width} ${Date.now()}`);
  await seedeAlles(page, einsatzId);
  await page.setViewportSize(schirm);
  return einsatzId;
}

for (const schirm of SCHIRME) {
  test(`@${schirm.width}: der Kopf der Kräfte-Seiten disponiert nicht selbst, Mengen haben deutsche Namen`, async ({
    page,
  }) => {
    const einsatzId = await kopfEinsatz(page, schirm);
    const kopf = page.locator('[data-lfh="seitenkopf-aktionen"]');

    // Material zuletzt: die Dialoge unten laufen auf dieser Seite weiter.
    for (const [modul, wortlaut, knopf] of [
      ['personal', KRAFT, 'Personal disponieren'],
      ['fahrzeuge', FUNKRUFNAME, 'Fahrzeuge disponieren'],
      ['material', MATERIAL, 'Material disponieren'],
    ] as const) {
      await page.goto(`/einsaetze/${einsatzId}/${modul}`);
      await expect(page.getByText(wortlaut).first()).toBeVisible();
      await expect(
        kopf.getByRole('button', { name: knopf }),
        `${modul} @${schirm.width}`,
      ).toBeVisible();
      await expect(
        kopf.getByRole('combobox'),
        `${modul} @${schirm.width}: Auswahl im Kopf`,
      ).toHaveCount(0);
      await expect(
        kopf.getByRole('spinbutton'),
        `${modul} @${schirm.width}: Menge im Kopf`,
      ).toHaveCount(0);
    }

    // Material: die Menge ist in Zeile und Karte ein Wert ohne Feld (LLH-1093 D9); „Ausgeben“
    // öffnet einen Dialog mit benanntem Feld (LLH-1225 D5), der Disponier-Dialog sein Feld „Menge".
    // Geklickt wird erst in den stehenden Dialog (`e2e/AGENTS.md`, „Erst klicken, wenn der Dialog
    // steht“).
    await page.getByRole('button', { name: `${MATERIAL} ausgeben` }).click();
    const ausgabe = await dialogSteht(page, `${MATERIAL} ausgeben`);
    await expect(ausgabe.getByRole('spinbutton', { name: 'Menge ausgeben' })).toBeVisible();
    await ausgabe.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(ausgabe).toBeHidden();
    await kopf.getByRole('button', { name: 'Material disponieren' }).click();
    const dialog = await dialogSteht(page, 'Material disponieren');
    await expect(dialog.getByRole('spinbutton', { name: 'Menge' })).toBeVisible();
    expect(await page.content(), `Stufentexte @${schirm.width}`).not.toMatch(
      /Increase Value|Decrease Value/,
    );
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toBeHidden();
  });
}

test('am Desktop steht der Kopf der Kräfte-Seiten einzeilig', async ({ page }) => {
  // Einzeilig: alle Knöpfe im Kopf auf einer Höhe, der Titel so hoch wie bei Fahrzeugen: beide
  // Köpfe tragen eine Segmentleiste (Ansicht bzw. Gruppierung, LLH-1225 D4), die mit dem
  // Zielabstand höher steht als ein Knopf; Personal hat keine.
  const einsatzId = await kopfEinsatz(page, { width: 1440, height: 900 });
  const kopf = page.locator('[data-lfh="seitenkopf-aktionen"]');
  const titelOben = async (modul: string, wortlaut: string) => {
    await page.goto(`/einsaetze/${einsatzId}/${modul}`);
    await expect(page.getByText(wortlaut).first()).toBeVisible();
    const oben = await kopf
      .getByRole('button')
      .evaluateAll((knoepfe) => knoepfe.map((k) => Math.round(k.getBoundingClientRect().top)));
    expect(new Set(oben).size, `${modul}: Knöpfe auf mehreren Zeilen (${oben})`).toBe(1);
    return (await page.getByRole('heading', { level: 1 }).boundingBox())!.y;
  };
  const material = await titelOben('material', MATERIAL);
  const fahrzeuge = await titelOben('fahrzeuge', FUNKRUFNAME);
  expect(Math.abs(material - fahrzeuge)).toBeLessThanOrEqual(1);
  await titelOben('personal', KRAFT);
});

for (const { dichte, soll } of STAFFEL) {
  test(`Stufe ${dichte}: der Statuswechsel ist auf 390 px ein Ziel von ${soll} px`, async ({
    page,
  }) => {
    await anmelden(page);
    const einsatzId = await einsatzPerApi(page, `Statusziel ${dichte} ${Date.now()}`);
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
  await anmelden(page, { startseite: false });
  /**
   * Der Einsatzname darf die Knopfbeschriftung nicht enthalten: der Einsatz-Switcher in der
   * Kopfzeile trägt den Namen als eigenen Knopf, und die Knopfabfrage träfe ihn.
   */
  const einsatzId = await einsatzPerApi(page, `Gliederung ${Date.now()}`);
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

  /**
   * Geklickt wird nur in einen stehenden Dialog (LLH-1275, Muster `einsatz-kern.ts`): ohne die
   * Wache fielen „Abbrechen“ und „Bilden“ in jedem Lauf in `ant-zoom-appear-active`, das zweite
   * Öffnen in `ant-zoom-leave-active`. Unter Last verfehlte der Klick den wachsenden Knopf, der
   * Dialog blieb offen und seine Maske fing das nächste Öffnen ab.
   */
  const dialog = page.getByRole('dialog', { name: 'Einheit bilden' });
  const dialogOeffnen = async () => {
    await bildenKnopf.click();
    await eingeblendet(dialog);
  };

  const vorher = await anzahlEinheiten();

  // Öffnen und ABBRECHEN: die Zahl bleibt gleich.
  await dialogOeffnen();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  // Ausgezoomt und abgehängt (`destroyOnHidden`): erst dann öffnet der Knopf einen neuen Dialog.
  await expect(dialog).toBeHidden();
  expect(await anzahlEinheiten(), 'Abbrechen darf nichts anlegen').toBe(vorher);

  // Absenden MIT Namen: genau ein Datensatz, und er heisst wie eingegeben.
  await dialogOeffnen();
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
