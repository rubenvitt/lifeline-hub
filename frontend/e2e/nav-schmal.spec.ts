import { expect, test, type Page } from '@playwright/test';

/**
 * Der Einsatz-Navigationsrahmen auf dem Handschirm (LFH-329 · B1/H11).
 *
 * WARUM HIER UND NICHT IN VITEST: jsdom rechnet kein Layout — `boundingBox` und
 * `document.body.scrollWidth` gibt es dort nicht, und genau die beiden tragen die
 * zwei Gates, die dieses Paket zu erfüllen hat (kein waagerechter Überlauf; jede
 * Trefffläche mindestens auf dem A1-Maß). Dass der Rahmen unter `lg` überhaupt
 * dem Drawer weicht, belegt `src/einsatz/EinsatzLayout.test.tsx` — hier geht es
 * nur um die gemessene Wirkung.
 *
 * Bewusst KEIN zweites Playwright-Projekt und kein Device-Descriptor: ein
 * `devices['iPhone …']` zöge webkit nach, und ein Browser-Download ist im Repo
 * nirgends abgesichert. Anmelden und Anlegen laufen am Fükw-Maß (die Einsatzliste
 * ist noch nicht umgebaut), erst danach wird der Viewport umgestellt — dasselbe
 * Vorgehen wie in `seitenrinne.spec.ts`.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** A1 Festlegung 4: Untergrenze einer Trefffläche (Material 48 dp). */
const TREFFLAECHE = 48;

const HANDSCHIRM = { width: 390, height: 844 };

/**
 * Erwartete Drawer-Breite. Bewusst als handgeschriebene Zahl und NICHT aus
 * `theme/tokens` importiert: sonst prüfte der Test den Token gegen sich selbst
 * und bliebe auch dann grün, wenn das Maß gar nicht mehr am Drawer ankommt.
 */
const DRAWER_BREITE = 280;

// Login-/Anlege-Helfer aus `seitenrinne.spec.ts` kopiert — es gibt (noch) kein
// geteiltes e2e-Hilfsmodul.
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
 * Misst den waagerechten Überlauf elementweise UND benennt die Verursacher.
 *
 * WARUM NICHT `document.body.scrollWidth <= window.innerWidth`: dieses eine
 * Gesamtmaß ist auf 390 px heute rot, und zwar an einer Stelle, die diesem Paket
 * nicht gehört — die Knopfgruppe rechts in der Kopfzeile (Einsatz-Switcher,
 * Alarm-Zentrale, Theme-Umschalter, Benutzermenü) misst dort gemessene 869 px.
 * Ein Gesamtmaß-Assert wäre also entweder dauerhaft rot oder müsste ganz
 * entfallen; beides sagt nichts über den Navigationsrahmen aus. Die Prüfung
 * unten teilt deshalb elementweise nach Besitzer auf: `rahmen` (dieses Paket,
 * wird zugesichert), `kopfzeile` und `inhalt` (fremde Pakete, werden GEMELDET
 * statt stillschweigend übergangen).
 *
 * Ohne Täterliste meldet ein rotes Gate nur „ist zu breit", und der nächste
 * Leser fängt bei null an.
 */
async function messeUeberlauf(page: Page) {
  return page.evaluate(() => {
    const grenze = document.documentElement.clientWidth;
    const benenne = (el: Element) =>
      `${el.tagName.toLowerCase()}[${(el.getAttribute('class') ?? '').slice(0, 60)}] → ${Math.round(
        el.getBoundingClientRect().right,
      )}px`;
    // Ein Element, das in einer eigenen Scroll-/Klipp-Fläche sitzt (antds
    // Tabellen tun das), schiebt die SEITE nicht auf — es scrollt in seinem
    // Kasten. Ohne diese Unterscheidung meldete das Gate jede breite Tabelle als
    // Layoutfehler und wäre unbrauchbar.
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
      // Was WEDER Kopfzeile NOCH Modulseite ist: der Navigationsrahmen selbst
      // (Rahmen-Wurzel, Rail, Modul-Spalte, der ans Dokument gehängte Drawer).
      rahmen: zuBreit
        .filter((el) => !im(el, '.ant-layout-header') && !im(el, '.ant-layout-content'))
        .slice(0, 6)
        .map(benenne),
      kopfzeile: zuBreit.filter((el) => im(el, '.ant-layout-header')).slice(0, 3).map(benenne),
      inhalt: zuBreit.filter((el) => im(el, '.ant-layout-content')).slice(0, 3).map(benenne),
    };
  });
}

/**
 * Meldet, was AUSSERHALB dieses Pakets über den Rand ragt — laut, aber ohne den
 * Lauf rot zu färben.
 *
 * Gemessen an HEAD sind das zwei Stellen, die H11 nicht gehören und die je ein
 * eigenes Paket haben:
 *  - die Knopfgruppe rechts in der Kopfzeile (Switcher, Alarm, Theme, Benutzer),
 *  - die ETB-Tabelle, deren feste Spaltenbreiten zusammen breiter sind als der
 *    Handschirm und die (noch) keine eigene Scroll-Fläche mitbringt.
 *
 * Ein `body.scrollWidth`-Assert über die ganze Seite wäre dadurch dauerhaft rot
 * und würde als „H11 ist kaputt" gelesen. Deshalb: zusichern, was der Rahmen
 * beiträgt — und den Rest benennen, statt ihn zu verschweigen.
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
  expect(kasten.width, 'Hamburger-Breite').toBeGreaterThanOrEqual(TREFFLAECHE);
  expect(kasten.height, 'Hamburger-Höhe').toBeGreaterThanOrEqual(TREFFLAECHE);

  // Gate 1: außerhalb der Kopfzeile ragt nichts über den Rand, solange der
  // Drawer zu ist. Vor dem Umbau tat das der Rahmen selbst (Rail + Modul-Spalte
  // belegten über 300 px von 390).
  const zu = await messeUeberlauf(page);
  expect(
    zu.rahmen,
    `Der Navigationsrahmen ragt auf ${HANDSCHIRM.width} px über:\n${zu.rahmen.join('\n')}`,
  ).toEqual([]);
  meldeFremdenUeberlauf('Drawer zu', zu);

  // Drawer öffnen: Akkordeon statt Rail, und der Schließen-Knopf ist ebenfalls
  // eine Trefffläche (den bringt antd mit, von Haus aus zu klein).
  await hamburger.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('navigation', { name: 'Einsatz-Navigation' })).toBeVisible();
  const schliessen = (await drawer.locator('.ant-drawer-close').boundingBox())!;
  expect(schliessen.width, 'Schließen-Breite').toBeGreaterThanOrEqual(TREFFLAECHE);
  expect(schliessen.height, 'Schließen-Höhe').toBeGreaterThanOrEqual(TREFFLAECHE);

  // Der Drawer selbst darf die Seite nicht breiter machen — das war die
  // Entscheidung gegen Rail + Modul-Spalte im Drawer.
  const offen = await messeUeberlauf(page);
  expect(
    offen.rahmen,
    `Der offene Drawer erzeugt Überlauf:\n${offen.rahmen.join('\n')}`,
  ).toEqual([]);
  meldeFremdenUeberlauf('Drawer offen', offen);
  // Auf das TOKEN-Maß geprüft, nicht bloß auf „passt in den Schirm": antds
  // Vorgabebreite (378) läge ebenfalls unter 390, ein ignoriertes Breitenmaß
  // fiele einem `<= 390`-Assert also nie auf.
  // Gemessen mit Toleranz, nicht auf den Punkt: `boundingBox` liefert
  // Fließkomma, und unter Last hat Chromium hier 279.99999237060547
  // zurückgegeben — ein exakter Vergleich färbte das Gate rot, ohne dass sich
  // etwas geändert hätte. Ein halbes Pixel trennt trotzdem noch jede andere
  // Breite, die hier in Frage käme (antds Vorgabe 378, ein 320er Drawer).
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
  // Die Gegenprobe auf dem Projekt-Default (1280 ≥ lg). Ohne sie wäre der Test
  // oben auch dann grün, wenn der Hamburger bei JEDER Breite erschiene.
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
  // Getrennter Test, weil er eine ANDERE Frage stellt als der Test oben: dort
  // geht es darum, DASS der Drawer schmal genug ist, hier darum, WELCHE Box das
  // Maß bekommt. `size` hat in antd 6 das abgekündigte `width` abgelöst und ist
  // zugleich die Achse der Vorgabestufen ('default'/'large') — ein numerischer
  // Wert könnte dort im Grundsatz auf der Inhaltsbox statt auf dem Panel landen.
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Nav Box ${Date.now()}`);

  await page.setViewportSize(HANDSCHIRM);
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await page.getByRole('button', { name: 'Navigation öffnen' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const panel = (await page.locator('.ant-drawer-content-wrapper').boundingBox())!;
  const koerper = (await page.locator('.ant-drawer-body').boundingBox())!;
  expect(panel.width, 'Panel trägt das Maß').toBe(DRAWER_BREITE);
  // Der Körper liegt INNERHALB des Panels (Innenrand), ist also nie breiter.
  expect(koerper.width, 'Körper liegt im Panel').toBeLessThanOrEqual(DRAWER_BREITE);
});
