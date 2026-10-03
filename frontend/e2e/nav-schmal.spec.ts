import { expect, test, type Locator, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';

/**
 * Der Einsatz-Navigationsrahmen auf dem Handschirm: kein waagerechter Überlauf und jede
 * Trefffläche mindestens auf dem A1-Maß — gemessene Wirkung (dass der Rahmen unter `lg` dem
 * Drawer weicht, belegt `src/einsatz/EinsatzLayout.test.tsx`).
 *
 * Kein Device-Descriptor (zöge webkit nach). Anmelden und Anlegen am Fükw-Maß, erst danach
 * wird der Viewport umgestellt.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** A1 Festlegung 4: Untergrenze einer Trefffläche (Material 48 dp). */
const TREFFLAECHE = 48;

/**
 * Subpixel-Spielraum für JEDEN Maßvergleich: `boundingBox()` liefert Fließkomma, und unter
 * Last kam `279.99999237` gegen 280 bzw. `47.99999809` gegen 48 — nur im vollen Sammel-Gate.
 * Ein halbes Pixel trennt 48 weiterhin von antds 32 und 280 von 320 und 378.
 */
const SUBPIXEL = 0.5;

/** Gate 3 der Bedien-Leitlinie: mindestens 48 px, subpixel-tolerant gemessen. */
function haeltTreffflaeche(wert: number, name: string) {
  expect(wert, `${name} (gemessen ${wert}px, Soll ≥ ${TREFFLAECHE})`).toBeGreaterThanOrEqual(
    TREFFLAECHE - SUBPIXEL,
  );
}

const HANDSCHIRM = { width: 390, height: 844 };

/** Erwartete Drawer-Breite als Literal — aus `theme/tokens` gelesen prüfte der Test sich selbst. */
const DRAWER_BREITE = 280;

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
 * Misst den waagerechten Überlauf elementweise UND benennt die Verursacher, aufgeteilt nach
 * Besitzer: `rahmen` (dieses Paket, wird zugesichert), `kopfzeile` und `inhalt` (fremd, werden
 * gemeldet). Ein Gesamtmaß wie `body.scrollWidth` lastete diesem Spec fremde Brüche an.
 */
async function messeUeberlauf(page: Page) {
  return page.evaluate(() => {
    const grenze = document.documentElement.clientWidth;
    const benenne = (el: Element) =>
      `${el.tagName.toLowerCase()}[${(el.getAttribute('class') ?? '').slice(0, 60)}] → ${Math.round(
        el.getBoundingClientRect().right,
      )}px`;
    // Ein Element in einer eigenen Scroll-/Klipp-Fläche (antds Tabellen) scrollt in seinem
    // Kasten und schiebt die Seite nicht auf.
    const eingefasst = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== 'visible') return true;
      }
      return false;
    };
    const zuBreit = Array.from(document.querySelectorAll('*')).filter(
      (el) => el.getBoundingClientRect().right > grenze + 1 && !eingefasst(el),
    );
    const im = (el: Element, wahl: string) => Boolean(el.closest(wahl));
    return {
      innerWidth: window.innerWidth,
      // Was weder Kopfzeile noch Modulseite ist: der Navigationsrahmen selbst (Rahmen-Wurzel,
      // Rail, Modul-Spalte, der ans Dokument gehängte Drawer).
      rahmen: zuBreit
        .filter((el) => !im(el, '.ant-layout-header') && !im(el, '.ant-layout-content'))
        .slice(0, 6)
        .map(benenne),
      kopfzeile: zuBreit
        .filter((el) => im(el, '.ant-layout-header'))
        .slice(0, 3)
        .map(benenne),
      inhalt: zuBreit
        .filter((el) => im(el, '.ant-layout-content'))
        .slice(0, 3)
        .map(benenne),
    };
  });
}

/**
 * Meldet, was AUSSERHALB dieses Pakets über den Rand ragt — laut, aber ohne den Lauf rot zu
 * färben. Derzeit meldet sie nichts; sie ist eine Wache.
 *
 * Lücke: `eingefasst()` behandelt JEDES `overflow-x` ungleich `visible` als Freibrief, auch
 * `hidden` — ein geklippter Inhalt fiele hier nicht auf (`gate1-ueberlauf.spec.ts` weist
 * `hidden` getrennt aus).
 */
function meldeFremdenUeberlauf(
  lage: string,
  messung: { kopfzeile: string[]; inhalt: string[] },
): void {
  for (const [bereich, treffer] of [
    ['Kopfzeile', messung.kopfzeile],
    ['Modulseite', messung.inhalt],
  ] as const) {
    if (treffer.length === 0) continue;
    console.log(`[${lage}] ${bereich} ragt über den Rand:\n${treffer.join('\n')}`);
  }
}

test('Navigationsrahmen: auf 390 px liegt die Navigation hinter dem Hamburger', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Nav schmal ${Date.now()}`);

  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByPlaceholder('Inhalt …')).toBeVisible();

  // Der inline-Rahmen ist weg …
  await expect(page.getByRole('navigation', { name: 'Kategorien' })).toHaveCount(0);
  // … und die Navigation hängt an einem Knopf, der die Trefffläche hält (Gate 3).
  const hamburger = page.getByRole('button', { name: 'Navigation öffnen' });
  const kasten = (await hamburger.boundingBox())!;
  haeltTreffflaeche(kasten.width, 'Hamburger-Breite');
  haeltTreffflaeche(kasten.height, 'Hamburger-Höhe');

  // Gate 1: außerhalb der Kopfzeile ragt nichts über den Rand, solange der Drawer zu ist.
  const zu = await messeUeberlauf(page);
  expect(
    zu.rahmen,
    `Der Navigationsrahmen ragt auf ${HANDSCHIRM.width} px über:\n${zu.rahmen.join('\n')}`,
  ).toEqual([]);
  meldeFremdenUeberlauf('Drawer zu', zu);

  // Drawer öffnen: Akkordeon statt Rail; der Schließen-Knopf ist ebenfalls eine Trefffläche.
  await hamburger.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('navigation', { name: 'Einsatz-Navigation' })).toBeVisible();
  const schliessen = (await drawer.locator('.ant-drawer-close').boundingBox())!;
  haeltTreffflaeche(schliessen.width, 'Schließen-Breite');
  haeltTreffflaeche(schliessen.height, 'Schließen-Höhe');

  // Der Drawer selbst darf die Seite nicht breiter machen.
  const offen = await messeUeberlauf(page);
  expect(offen.rahmen, `Der offene Drawer erzeugt Überlauf:\n${offen.rahmen.join('\n')}`).toEqual(
    [],
  );
  meldeFremdenUeberlauf('Drawer offen', offen);
  // Auf das TOKEN-Maß geprüft, nicht bloß „passt in den Schirm": antds Vorgabe (378) läge
  // ebenfalls unter 390.
  const drawerKasten = (await drawer.boundingBox())!;
  expect(
    Math.abs(drawerKasten.width - DRAWER_BREITE),
    `Drawer-Breite kommt aus dem Token (gemessen ${drawerKasten.width})`,
  ).toBeLessThanOrEqual(0.5);
  expect(drawerKasten.width).toBeLessThan(HANDSCHIRM.width);

  // Modulklick navigiert UND schließt den Drawer.
  await drawer.getByRole('button', { name: 'Personen', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen`));
  await expect(drawer).toHaveCount(0);
});

test('Navigationsrahmen: am Fükw-Schirm steht er weiter inline', async ({ page }) => {
  // Gegenprobe ab `lg`: ohne sie wäre der Test oben auch grün, wenn der Hamburger bei JEDER
  // Breite erschiene.
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Nav breit ${Date.now()}`);

  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByRole('navigation', { name: 'Kategorien' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Navigation öffnen' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Navigationsrahmen: das Breitenmaß landet auf dem Drawer-Panel, nicht auf dem Inhalt', async ({
  page,
}) => {
  // Eigene Frage: nicht OB der Drawer schmal genug ist, sondern WELCHE Box das Maß bekommt.
  // `size` ist in antd 6 zugleich die Achse der Vorgabestufen — ein numerischer Wert könnte
  // auf der Inhaltsbox statt auf dem Panel landen.
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Nav Box ${Date.now()}`);

  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await page.getByRole('button', { name: 'Navigation öffnen' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const panel = (await page.locator('.ant-drawer-content-wrapper').boundingBox())!;
  const koerper = (await page.locator('.ant-drawer-body').boundingBox())!;
  // Subpixel-tolerant wie oben; ein halbes Pixel trennt das Panel weiterhin von der schmaleren
  // Inhaltsbox und von antds 378.
  expect(
    Math.abs(panel.width - DRAWER_BREITE),
    `Panel trägt das Maß (gemessen ${panel.width})`,
  ).toBeLessThanOrEqual(SUBPIXEL);
  // Der Körper liegt INNERHALB des Panels. Der Nav-Drawer setzt die Körper-Polsterung auf 0,
  // Körper und Panel sind also dieselbe Messung — ebenfalls subpixel-tolerant (auch
  // 280.00000762939453 kam vor).
  expect(koerper.width, `Körper liegt im Panel (gemessen ${koerper.width})`).toBeLessThanOrEqual(
    DRAWER_BREITE + SUBPIXEL,
  );
});

/**
 * Modulsperre per Override (LFH-820, `openspec/changes/lfh-820-layout-gates-modulsperre-override/`):
 * eine Mandanten-, keine Rollenachse. Für den Admin ist kein Modul gesperrt (Admin-Ausnahme in
 * `src/einsatz/berechtigung.rs`); die gesperrten Zeilen (Schloss, „Keine Berechtigung") sieht nur
 * ein Benutzer ohne die verlangte Rolle — hier der Beobachter.
 *
 * Gesperrt werden zwei Module der Kategorie Führung, die auf dem Überblick offen steht: eine
 * Modulzeile und das Ziel der Sprungmarke „Entscheidungen" (ETB). So steht beides ohne Klick da.
 */
const GESPERRT_ZEILE = 'Aufträge/Befehle';
const GESPERRT_SPRUNG = 'Entscheidungen, springt zu ETB, Typ Entscheidung';

async function modulSperren(page: Page, einsatzId: string, modulKey: string) {
  const antwort = await page.request.put(
    `/api/einsaetze/${einsatzId}/modul-overrides/${modulKey}`,
    { data: { sichtbar: true, benoetigte_rolle: 'admin' } },
  );
  // Ein still gescheitertes Seeding führte zurück in den ungesperrten Zustand.
  expect(antwort.ok(), `Override ${modulKey}: ${antwort.status()} ${await antwort.text()}`).toBe(
    true,
  );
}

/** Admin legt an und sperrt, dann Wechsel auf den Beobachter; Viewport erst danach. */
async function beobachterMitSperre(page: Page, name: string): Promise<string> {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `${name} ${Date.now()}`);
  await modulSperren(page, einsatzId, 'auftraege');
  await modulSperren(page, einsatzId, 'etb');
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  return einsatzId;
}

/** Vorbedingung: der Sperrzweig steht — beide Zeilen gesperrt, mit Grund. */
async function sperrzweigSteht(ort: Locator) {
  for (const name of [GESPERRT_ZEILE, GESPERRT_SPRUNG]) {
    const zeile = ort.getByRole('button', { name, exact: true });
    await expect(zeile, `Vorbedingung: „${name}" gesperrt`).toBeDisabled();
    await expect(zeile).toHaveAttribute('title', 'Keine Berechtigung');
  }
}

test('Navigationsrahmen: auf 390 px hält der Drawer gesperrte Zeilen (Beobachter, Modulsperre)', async ({
  page,
}) => {
  const einsatzId = await beobachterMitSperre(page, 'E2E Nav Sperre schmal');

  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/ueberblick`);
  // Rollenneutraler Anker (wie Gate 1): die Überschrift, nicht die ETB-Erfassung.
  await expect(page.getByRole('heading', { name: 'Überblick', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Kategorien' })).toHaveCount(0);

  const hamburger = page.getByRole('button', { name: 'Navigation öffnen' });
  const kasten = (await hamburger.boundingBox())!;
  haeltTreffflaeche(kasten.width, 'Hamburger-Breite');
  haeltTreffflaeche(kasten.height, 'Hamburger-Höhe');

  const zu = await messeUeberlauf(page);
  expect(
    zu.rahmen,
    `Der Navigationsrahmen ragt auf ${HANDSCHIRM.width} px über:\n${zu.rahmen.join('\n')}`,
  ).toEqual([]);
  meldeFremdenUeberlauf('Sperre, Drawer zu', zu);

  await hamburger.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('navigation', { name: 'Einsatz-Navigation' })).toBeVisible();
  await sperrzweigSteht(drawer);

  const offen = await messeUeberlauf(page);
  expect(
    offen.rahmen,
    `Der offene Drawer mit gesperrten Zeilen erzeugt Überlauf:\n${offen.rahmen.join('\n')}`,
  ).toEqual([]);
  meldeFremdenUeberlauf('Sperre, Drawer offen', offen);
  // Jede Zeile des Drawers bleibt innerhalb des Panels — die gesperrte trägt ein Icon mehr.
  const drawerRechts = (await drawer.locator('.ant-drawer-content-wrapper').boundingBox())!;
  for (const name of [GESPERRT_ZEILE, GESPERRT_SPRUNG]) {
    const zeile = (await drawer.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(
      zeile.x + zeile.width,
      `„${name}" endet im Drawer (gemessen ${zeile.x + zeile.width})`,
    ).toBeLessThanOrEqual(drawerRechts.x + drawerRechts.width + SUBPIXEL);
  }
});

test('Navigationsrahmen: auf 1024 px hält die Liste gesperrte Zeilen (Beobachter, Modulsperre)', async ({
  page,
}) => {
  const einsatzId = await beobachterMitSperre(page, 'E2E Nav Sperre Tablet');

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`/einsaetze/${einsatzId}/ueberblick`);
  await expect(page.getByRole('heading', { name: 'Überblick', level: 1 })).toBeVisible();
  // Ab `lg` inline: Rail und Modulpanel, kein Hamburger.
  await expect(page.getByRole('navigation', { name: 'Kategorien' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Navigation öffnen' })).toHaveCount(0);
  const panel = page.locator('[data-lfh="modul-panel"]');
  await sperrzweigSteht(panel);

  const messung = await messeUeberlauf(page);
  expect(
    messung.rahmen,
    `Der Navigationsrahmen ragt auf 1024 px über:\n${messung.rahmen.join('\n')}`,
  ).toEqual([]);
  meldeFremdenUeberlauf('Sperre, 1024 px', messung);
  // Das Panel selbst läuft nicht in sich über (es klippt, statt die Seite aufzuschieben —
  // `messeUeberlauf` sähe das nicht).
  const panelMass = await panel.evaluate((el) => ({
    scroll: el.scrollWidth,
    klient: el.clientWidth,
  }));
  expect(panelMass.scroll, 'Modulpanel: Inhalt breiter als das Panel').toBeLessThanOrEqual(
    panelMass.klient + 1,
  );
});

/**
 * Der Griff muss auf seinem eigenen Grund lesbar sein — in BEIDEN Farbschemata. Ein
 * antd-Textknopf erbt `colorText` und folgt dem Schema, die Kopfzeile bleibt aber in beiden
 * Modi dunkel. Gemessen wird der Kontrast nach WCAG 1.4.11 (≥ 3:1), kein Farbwert — der
 * ginge bei jeder Palettenpflege rot.
 */
test('Navigationsrahmen: der Griff hebt sich in beiden Farbschemata vom Kopf ab', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Nav Kontrast ${Date.now()}`);

  for (const modus of ['light', 'dark'] as const) {
    await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await page.setViewportSize(HANDSCHIRM);
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await expect(page.getByRole('button', { name: 'Navigation öffnen' })).toBeVisible();

    const kontrast = await page.evaluate(() => {
      const kanal = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      const luminanz = (farbe: string) => {
        const [r, g, b] = farbe.match(/\d+(\.\d+)?/g)!.map(Number);
        return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
      };
      const kopf = document.querySelector('.ant-layout-header')!;
      const griff = document.querySelector('[aria-label="Navigation öffnen"]')!;
      const a = luminanz(getComputedStyle(kopf).backgroundColor);
      const b = luminanz(getComputedStyle(griff).color);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });

    expect(kontrast, `Griff gegen Kopfgrund im Modus ${modus}`).toBeGreaterThanOrEqual(3);
  }
});
