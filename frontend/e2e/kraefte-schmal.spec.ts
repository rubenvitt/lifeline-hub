import { expect, test, type Page } from '@playwright/test';

/**
 * Die Kräfte-Module am Handschirm (LFH-339 · C4, AK 2 und AK 5).
 *
 * Zwei Aussagen, die bewusst getrennt bleiben:
 *
 *  1. **Kein waagerechter Bildlauf** auf 390 px — auf allen vier Modulrouten. Das ist eine
 *     Layout-Aussage und dichteunabhängig.
 *  2. **Der Statuswechsel ist ein Bedienziel der Dichtestufe.** Bis C4 sass er in einem
 *     `<Select>` mit fester `minWidth` (150 bei Fahrzeug/Personal, 170 bei Material) mitten
 *     in der Tabellenzeile — auf der 390-px-Karte war er damit gar nicht erreichbar.
 *
 * Dazu AK 5: „Einheit bilden" darf vor dem Absenden nichts persistieren.
 *
 * ── DIE SCHWELLE IST DIE STAFFEL, NICHT DIE 44 AUS DEM AK-TEXT ──────────────────────────
 *
 * Das Ticket nennt „≥ 44 px" (WCAG SC 2.5.5, AAA). Bindend für die Routen ist aber Gate 3
 * der Bedien-Leitlinie mit 30 / 48 / 72, und `trefflaeche-tablet.spec.ts:32-41` hat diese
 * Korrektur schon einmal begründet: ein Test auf 44 wäre SCHWÄCHER als der Bestand und
 * liesse eine Regression auf 44–47 px durch. Gemessen wird gegen die Stufe — 48 im
 * Berührungs-Durchgang, 72 im Handschuh-Durchgang. Das AK ist damit übererfüllt, nicht
 * verfehlt.
 *
 * ── WARUM `hasTouch` ───────────────────────────────────────────────────────────────────
 *
 * `setViewportSize` allein liefert KEIN Touch — `matchMedia('(pointer: coarse)')` bliebe
 * false, die Stufe bliebe `kompakt` (30 px), und „Handschirm" wäre reine Prosa. Genau daran
 * hängt `zeigerIstGrob()` (`components/useViewport.ts`), über das `ThemeModeProvider` die
 * Stufe OHNE gespeicherte Wahl auf `komfortabel` vorbelegt (LFH-361). Die
 * `data-dichte`-Wache steht deshalb als erste Zusicherung: sie trennt „Ziel zu klein" von
 * „Stufe gar nicht angekommen".
 *
 * `hasTouch` ist eine BrowserContext-Option und lässt sich nicht zur Laufzeit umstellen —
 * daher `test.use` auf Dateiebene.
 *
 * ── WAS HIER BEWUSST NICHT GEMESSEN WIRD ────────────────────────────────────────────────
 *
 * Kein `waitForLoadState('networkidle')`: auf Einsatzrouten bleibt ein SSE-Strom offen, die
 * Bedingung „500 ms keine Netzwerkaktivität" tritt dort nie sauber ein (in
 * `trefflaeche-tablet.spec.ts:206-213` gemessen und als LFH-385 erfasst). Die Zusicherungen
 * unten warten von sich aus und sind inhaltlich statt netzwerklich.
 *
 * Kein Device-Descriptor und kein zweites Playwright-Projekt — ein `devices['iPhone …']`
 * zöge webkit nach, und ein Browser-Download ist im Repo nirgends abgesichert
 * (gleichlautend in fünf Bestands-Specs begründet).
 */
test.use({ hasTouch: true });

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const HANDSCHIRM = { width: 390, height: 844 };

/**
 * Die Dichte-Staffel als handgeschriebene Zahlen, NICHT aus `theme/tokens` importiert:
 * sonst prüfte der Test den Token gegen sich selbst und bliebe auch dann grün, wenn das Maß
 * am Bedienelement gar nicht mehr ankommt.
 */
const STAFFEL = [
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

/** Subpixel-Spielraum: `boundingBox()` liefert Fliesskomma, und Chromium rechnet unter Last
 *  anders als im Einzellauf (in `nav-schmal.spec.ts:26-46` dreimal gemessen). */
const SUBPIXEL = 0.5;

/** Schlüssel aus `theme/ThemeModeProvider.tsx`. Bewusst literal — der Wert ist Vertrag. */
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

const FUNKRUFNAME = 'Florian Musterstadt 44/1';
const KRAFT = 'Kirchgassner-Wohlfahrt, Maximiliane';
const MATERIAL = 'Wolldecke';

// Login-/Anlege-Helfer kopiert — es gibt (noch) kein geteiltes e2e-Hilfsmodul
// (gleichlautend in fünf Bestands-Specs vermerkt).
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
  await seede(page, einsatzId, 'fahrzeuge', { adhoc: { funkrufname: FUNKRUFNAME, fahrzeugtyp: 'LF 20' } }, 'Fahrzeug');
  await seede(page, einsatzId, 'personal', { adhoc: { name: KRAFT, funktion: 'Abschnittsleitung' } }, 'Personal');
  await seede(page, einsatzId, 'material', { adhoc: { bezeichnung: MATERIAL, menge: 12 } }, 'Material');
  await seede(page, einsatzId, 'einheiten', { name: '1. Zug' }, 'Einheit');
}

/**
 * Breite des Dokuments gegen die Sichtfläche — die eigentliche Aussage von AK 2.
 *
 * ── DIE WACHE MUSS AUF DEN INHALT ZEIGEN, NICHT AUF DIE SEITE ───────────────────────────
 *
 * GEMESSEN und teuer gelernt: die erste Fassung wartete auf
 * `page.locator('main, [role="main"], body')` — und `body` ist IMMER sichtbar. Gemessen
 * wurde damit eine Seite, deren Daten noch gar nicht da waren; ohne Zeilen gibt es keinen
 * Überlauf, und der Test war zweimal grün, während `/material` in Wirklichkeit **327 px**
 * überlief. Ein Test, der vor dem Inhalt misst, prüft den Ladebildschirm.
 *
 * Deshalb: der Aufrufer nennt einen Wortlaut, der erst MIT den Daten erscheint. Ohne ihn
 * gäbe es keine Zusicherung, sondern eine Zufallsmessung.
 *
 * Zusätzlich `poll` statt einer Einmalmessung — nicht gegen die Ladezeit (die deckt die
 * Wache), sondern gegen den umgekehrten Fehler: ein Layout, das erst nach dem ersten
 * Bildaufbau in seine Endbreite wächst.
 */
async function keinQuerlauf(page: Page, pfad: string, inhaltsWortlaut: string | RegExp) {
  await page.goto(pfad);
  await expect(
    page.getByText(inhaltsWortlaut).first(),
    `${pfad}: der Inhalt muss vor der Messung stehen — sonst misst der Test den Ladezustand`,
  ).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    })).then((m) => m.scroll - m.client), {
      message: `${pfad} läuft waagerecht über`,
    })
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

for (const { dichte, soll } of STAFFEL) {
  test(`Stufe ${dichte}: der Statuswechsel ist auf 390 px ein Ziel von ${soll} px`, async ({ page }) => {
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `Statusziel ${dichte} ${Date.now()}`);
    await seedeAlles(page, einsatzId);

    await page.setViewportSize(HANDSCHIRM);

    if (dichte === 'handschuh') {
      // Eine GESPEICHERTE Wahl gewinnt gegen die Zeigerart (LFH-361) — nur so ist die
      // Handschuh-Stufe erreichbar. `ThemeModeProvider` liest den Speicher beim Montieren,
      // ein Setzen ohne Neuladen bliebe folgenlos.
      await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
      await page.evaluate(
        ([schluessel, wert]) => window.localStorage.setItem(schluessel, wert),
        [DICHTE_SCHLUESSEL, dichte] as const,
      );
      await page.reload();
    } else {
      await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
    }

    // Erste Zusicherung: die Stufe ist angekommen. Ohne sie hätte jedes „zu klein" zwei
    // mögliche Ursachen.
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

    // Auf 390 px steht der Kartenzweig — dort war der Statuswechsel vor C4 gar nicht
    // vorhanden, weil ein `Select` mit fester Mindestbreite die Karte breit gedrückt hätte.
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

    // Und er BEDIENT auch: ein Ziel der richtigen Größe, das nichts öffnet, wäre die
    // halbe Aussage. Das Menü liegt im Portal — deshalb seitenweit gesucht, nicht in der Karte.
    await ausloeser.click();
    await expect(page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')).toBeVisible();
  });
}

test('„Einheit bilden" persistiert erst beim Absenden — und nie als „Neue Einheit"', async ({ page }) => {
  /**
   * AK 5. Der Knopf schrieb bis C4 sofort einen Platzhalter-Datensatz in die Datenbank.
   * Gemessen wird der PERSISTIERTE Bestand über die API, nicht die Anzeige: eine Zählung im
   * DOM sagt nichts darüber, was in der Gliederung wirklich steht.
   */
  await anmelden(page);
  /**
   * DER EINSATZNAME DARF DIE KNOPFBESCHRIFTUNG NICHT ENTHALTEN. Gemessen: mit
   * `Einheit bilden ${Date.now()}` trägt der Einsatz-Switcher in der Kopfzeile den Namen
   * als eigenen Knopf („Einheit bilden 1786995411585 down"), und `getByRole('button', {
   * name: 'Einheit bilden' }).first()` traf IHN statt des gesuchten. Der Test scheiterte
   * dann an einem nie erscheinenden Dialog — ein Fehlerbild, das nach kaputtem Code
   * aussieht und keins ist.
   */
  const einsatzId = await einsatzAnlegen(page, `Gliederung ${Date.now()}`);
  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/einheiten`);

  // Auf den Seiteninhalt gescopt, nicht seitenweit: die Kopfzeile ist eine `banner`-Landmarke
  // und trägt eigene Knöpfe. `exact`, damit ein Name mit Zusatz nicht mitzählt.
  const bildenKnopf = page.getByRole('main').getByRole('button', { name: 'Einheit bilden', exact: true }).first();

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

  await expect.poll(anzahlEinheiten, { message: 'Absenden legt genau eine Einheit an' }).toBe(vorher + 1);

  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/einheiten`);
  const namen = ((await antwort.json()) as { name: string }[]).map((e) => e.name);
  expect(namen).toContain('2. Zug');
  expect(namen, 'kein Platzhalter-Datensatz').not.toContain('Neue Einheit');
});
