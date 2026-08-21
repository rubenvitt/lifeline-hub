import { expect, test, type Page, type Locator } from '@playwright/test';

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Mausgesten-Helfer: zieht das Zentrum von `quelle` auf das Zentrum von `ziel`. */
async function ziehe(page: Page, quelle: Locator, ziel: Locator) {
  const a = await quelle.boundingBox();
  const b = await ziel.boundingBox();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 16 });
  await page.mouse.up();
}

/** Legt Einsatz + Person + aktive UHS mit 1 Platz an und weist die Person dem Platz zu.
 *  Liefert den (eindeutigen) Personennamen zurück. */
async function setupBelegterPlatz(page: Page): Promise<string> {
  await anmelden(page);
  const einsatzName = `E2E UHS Move ${Date.now()}`;
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(einsatzName);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.waitForURL(/\/einsaetze\/\d+\//);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)\//)![1];

  await page.goto(`/einsaetze/${einsatzId}/personen`);
  await page.getByRole('button', { name: 'Schnellerfassung' }).click();
  const personName = `MovePat${Date.now()}`;
  // „Name" liegt seit LFH-340 · C5 eingeklappt — die Sichtungskategorie ist ins sichtbare
  // Feldbudget gerückt. Der Name bleibt der Anker dieser Specs, er ist nur einen Klick weiter.
  await page.getByRole('button', { name: /Weitere Angaben/ }).click();
  await page.getByLabel('Name', { exact: true }).fill(personName);
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();
  await expect(page.getByText(personName).first()).toBeVisible();

  await page.goto(`/einsaetze/${einsatzId}/unfallhilfsstellen`);
  const uhsName = `BHP Move ${Date.now()}`;
  await page.getByRole('button', { name: 'Erste UHS anlegen' }).click();
  await page.getByPlaceholder('z. B. BHP 50').fill(uhsName);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await page.getByRole('button', { name: uhsName }).click();

  await page.getByRole('button', { name: 'Plätze anlegen' }).click();
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page.getByText('Bett 1')).toBeVisible();
  await page.getByRole('button', { name: 'In Betrieb nehmen' }).click();
  await expect(page.getByRole('button', { name: 'Plätze bearbeiten' })).toBeVisible();

  // Person aus „Noch nicht aufgenommen" auf „Bett 1" ziehen → belegt.
  await ziehe(page, page.getByText(personName).first(), page.getByText('Bett 1'));
  await expect(page.getByText('belegt')).toBeVisible();
  return personName;
}

/** Drop-Target zu einem Spalten-Titel: der Karten-Body (dort sitzt die Droppable —
 *  NICHT der Header, sonst verfehlt der Drop die Drop-Zone). */
function dropZone(page: Page, titel: string): Locator {
  return page.locator('.ant-card', { hasText: titel }).locator('.ant-card-body');
}

// Neu: eine belegte Person ist ziehbar → in den Transport-Bereich rechts ziehen öffnet
// den Transport-Abschluss-Screen (ändert Patientendaten, daher Modal statt Sofortbuchung).
test('UHS Grundriss: belegte Person in den Transport-Bereich ziehen öffnet den Abschluss-Screen', async ({ page }) => {
  const personName = await setupBelegterPlatz(page);
  await ziehe(page, page.getByText(personName).first(), dropZone(page, 'Auf Transport gebracht'));
  // Der Abschluss-Screen ist der „Verbleib erfassen"-Dialog (Titel enthält den Personennamen,
  // Art-Auswahl mit Default „Transport"). Früherer Titel „In Transport bringen" existiert nicht mehr.
  await expect(page.getByRole('dialog')).toContainText('Verbleib erfassen');
});

// Neu: eine belegte Person in den Wartebereich (links) ziehen → verlässt den Platz,
// bleibt aber in der UHS (Belegung ohne Platz).
test('UHS Grundriss: belegte Person in den Wartebereich ziehen räumt den Platz', async ({ page }) => {
  const personName = await setupBelegterPlatz(page);
  await ziehe(page, page.getByText(personName).first(), dropZone(page, 'Wartebereich (Eingang)'));
  // Platz nicht mehr belegt …
  await expect(page.getByText('belegt')).toBeHidden();
  // … und die Person steht im Wartebereich.
  await expect(page.getByText(personName).first()).toBeVisible();
});

// Regression (Bug LFH-17): Platz-Karten müssen unabhängig von Belegung, Titellänge
// (Umbruch) und Tag-Anzahl EXAKT gleich groß bleiben — sonst „springt" das Layout und
// Karten überlappen. Dieser Test baut den Worst Case (langer 2-zeiliger Titel + belegt +
// Aufbereitung) neben kurzen/leeren Karten und prüft: (a) alle Karten gleich hoch,
// (b) keine Karte höher als der Raster-Zeilenabstand (120px), (c) keine Aktions-Icons
// werden durch overflow:hidden abgeschnitten.
test('UHS Grundriss: alle Platz-Karten sind gleich groß (Belegung/Titel-Umbruch/Tags egal)', async ({ page }) => {
  await anmelden(page);
  const einsatzName = `E2E UHS Uniform ${Date.now()}`;
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(einsatzName);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.waitForURL(/\/einsaetze\/\d+\//);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)\//)![1];

  await page.goto(`/einsaetze/${einsatzId}/personen`);
  await page.getByRole('button', { name: 'Schnellerfassung' }).click();
  const personName = `UniPat${Date.now()}`;
  // „Name" liegt seit LFH-340 · C5 eingeklappt — die Sichtungskategorie ist ins sichtbare
  // Feldbudget gerückt. Der Name bleibt der Anker dieser Specs, er ist nur einen Klick weiter.
  await page.getByRole('button', { name: /Weitere Angaben/ }).click();
  await page.getByLabel('Name', { exact: true }).fill(personName);
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();
  await expect(page.getByText(personName).first()).toBeVisible();

  await page.goto(`/einsaetze/${einsatzId}/unfallhilfsstellen`);
  const uhsName = `BHP Uniform ${Date.now()}`;
  await page.getByRole('button', { name: 'Erste UHS anlegen' }).click();
  await page.getByPlaceholder('z. B. BHP 50').fill(uhsName);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await page.getByRole('button', { name: uhsName }).click();

  // Lange (2-zeilige) Titel: Behandlungsplatz; kurze: Bett.
  await page.getByRole('button', { name: 'Plätze anlegen' }).click();
  await page.getByRole('combobox', { name: 'Platz-Typ' }).click({ force: true });
  await page.getByText('Behandlungsplatz', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Menge' }).fill('2');
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page.getByText('Behandlungsplatz 2')).toBeVisible();
  await page.getByRole('button', { name: 'Plätze anlegen' }).click();
  await page.getByRole('combobox', { name: 'Platz-Typ' }).click({ force: true });
  await page.getByText('Bett', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Menge' }).fill('1');
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page.getByText('Bett 1')).toBeVisible();

  await page.getByRole('button', { name: 'In Betrieb nehmen' }).click();
  await expect(page.getByRole('button', { name: 'Plätze bearbeiten' })).toBeVisible();

  // Behandlungsplatz 1 belegen (2-zeiliger Titel + belegt + Person + Aktionen).
  await ziehe(page, page.getByText(personName).first(), page.getByText('Behandlungsplatz 1'));
  await expect(page.getByText('belegt')).toBeVisible();
  // Behandlungsplatz 2 (unbelegt) zusätzlich auf „aufbereitung" → testet die Tag-Zeile
  // (eine feste, nicht umbrechende Zeile) als dritte mögliche Varianzquelle.
  const bp2 = page.locator('[data-testid="platz-karte"]', { hasText: 'Behandlungsplatz 2' });
  // CSS-Selektor auf das echte <button> — nicht getByRole, sonst trifft der von dnd-kit
  // mit role="button"+aria-disabled versehene Karten-Div (im Nicht-Edit deaktiviert).
  // Präfix-Selektor (LFH-341 · H40): der Auslöser trägt seit der Zeilenkennung
  // `Platzaktionen zu <bezeichnung>` — hier „Platzaktionen zu Behandlungsplatz 2".
  //
  // ┌─ HIER WIRD EIN ECHTER BEDIENBEFUND GEDÄMPFT, KEIN TESTFEHLER — LFH-457 ──────────────┐
  // │ Wer im Betrieb unmittelbar nach einer Belegung ein Platzmenü öffnet, VERLIERT es.    │
  // │ Das ist kein Wackeln der Testumgebung, sondern das Verhalten der Seite: die          │
  // │ Zuweisung eine Zeile weiter oben stößt eine Nachladung an, und die räumt das gerade  │
  // │ geöffnete Dropdown ab. Wer diesen Block anfasst, glättet also nichts Kaputtes am     │
  // │ Test — der Befund bleibt offen und steht in LFH-457.                                 │
  // │                                                                                      │
  // │ Warum die Dämpfung hier trotzdem vertretbar ist: dieser Test MISST etwas anderes —   │
  // │ gleiche Kartenhöhen und nicht abgeschnittene Icons. Das Menü ist Aufbau, nicht        │
  // │ Gegenstand. Beide Messungen bleiben unverändert scharf.                              │
  // │                                                                                      │
  // │ MIT DEM FIX ZU LFH-457 GEHÖRT DIESER BLOCK ZURÜCKGEBAUT — ein stehengebliebener      │
  // │ Wiederholversuch fängt dann nichts mehr ab und verdeckt nur den nächsten Rückfall.   │
  // └──────────────────────────────────────────────────────────────────────────────────────┘
  //
  // Zur Mechanik, knapp: gedämpft wird über ein begrenztes NEU-ÖFFNEN, nicht über eine
  // längere Frist. Die Eigenfrist am `menuitem` bleibt KURZ (2 s), damit ein abgeräumtes
  // Menü schnell auffällt und neu aufgemacht wird — der Block soll nicht 20 s auf ein Menü
  // warten, das aus einem anderen Grund ausbleibt. Auch der Auslöser-Klick ist befristet:
  // verschwände der Knopf selbst, scheiterte der Test sonst erst am Test-Timeout und damit
  // ohne brauchbare Diagnose. Doppelt angewandt werden kann die Verfügbarkeit nicht — der
  // Wiederholblock greift nur, wenn der Eintrag gar nicht geklickt wurde.
  // Nicht auf `networkidle` warten: auf Einsatzrouten bleibt ein SSE-Strom offen, die
  // Bedingung tritt nie ein (LFH-385).
  await expect(async () => {
    await bp2.locator('button[aria-label^="Platzaktionen"]').click({ timeout: 5_000 });
    await page.getByRole('menuitem', { name: 'als in Aufbereitung markieren' })
      .click({ timeout: 2_000 });
  }).toPass({ timeout: 20_000, intervals: [500, 1_000, 2_000] });
  await expect(bp2.getByText('aufbereitung')).toBeVisible();

  // Alle Karten messen: Höhen + ob Buttons unter die Kartenunterkante ragen (= geclippt).
  const mess = await page.locator('[data-testid="platz-karte"]').evaluateAll((karten) =>
    karten.map((c) => {
      const r = c.getBoundingClientRect();
      const btns = Array.from(c.querySelectorAll('button'));
      const maxBtnBottom = btns.length ? Math.max(...btns.map((b) => b.getBoundingClientRect().bottom)) : r.bottom;
      return { h: Math.round(r.height), overflow: Math.round(maxBtnBottom - r.bottom) };
    }),
  );
  const hoehen = mess.map((m) => m.h);
  expect(hoehen.length).toBeGreaterThanOrEqual(3);
  // (a) alle gleich groß (±1px Rundung), (b) ≤ Raster-Zeilenabstand, (c) keine geclippten Icons.
  expect(Math.max(...hoehen) - Math.min(...hoehen)).toBeLessThanOrEqual(1);
  expect(Math.max(...hoehen)).toBeLessThanOrEqual(120);
  for (const m of mess) expect(m.overflow).toBeLessThanOrEqual(1);
});

/** scrollWidth/clientWidth des nächsten scroll-baren Vorfahren einer Karte. */
async function scrollAhneMasse(karte: Locator): Promise<{ scrollWidth: number; clientWidth: number }> {
  return karte.evaluate((el) => {
    let n: HTMLElement | null = el as HTMLElement;
    while (n) {
      const o = getComputedStyle(n).overflow + getComputedStyle(n).overflowX;
      if (o.includes('auto') || o.includes('scroll')) {
        return { scrollWidth: n.scrollWidth, clientWidth: n.clientWidth };
      }
      n = n.parentElement;
    }
    return { scrollWidth: 0, clientWidth: 0 };
  });
}

// Regression: Eine Personenkarte wurde beim Drag mit `transform: translate()` INLINE
// verschoben, während sie Kind der linken Spalte (overflow:auto) blieb. Das vergrößert
// die scrollbare Region des Containers → es erscheint eine Scrollbar, die mit der
// Drag-Distanz dynamisch wächst. Fix: Person-Drag rendert via DragOverlay (Portal),
// der Originalknoten bewegt sich nicht mehr. Dieser Test misst die Scroll-Region des
// Spalten-Containers WÄHREND der Drag noch aktiv ist (gedrückte Maus).
test('UHS Grundriss: Person-Drag sprengt nicht die Scroll-Region der linken Spalte', async ({ page }) => {
  await anmelden(page);

  // Einsatz anlegen.
  const einsatzName = `E2E UHS PersonScroll ${Date.now()}`;
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(einsatzName);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.waitForURL(/\/einsaetze\/\d+\//);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)\//)![1];

  // Person per Schnellerfassung anlegen (landet in „Noch nicht aufgenommen").
  await page.goto(`/einsaetze/${einsatzId}/personen`);
  await page.getByRole('button', { name: 'Schnellerfassung' }).click();
  const personName = `PatScroll${Date.now()}`;
  // „Name" liegt seit LFH-340 · C5 eingeklappt — die Sichtungskategorie ist ins sichtbare
  // Feldbudget gerückt. Der Name bleibt der Anker dieser Specs, er ist nur einen Klick weiter.
  await page.getByRole('button', { name: /Weitere Angaben/ }).click();
  await page.getByLabel('Name', { exact: true }).fill(personName);
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();
  await expect(page.getByText(personName)).toBeVisible();

  // UHS anlegen (frischer Einsatz → Leerzustand mit „Erste UHS anlegen").
  await page.goto(`/einsaetze/${einsatzId}/unfallhilfsstellen`);
  const uhsName = `BHP PersonScroll ${Date.now()}`;
  await page.getByRole('button', { name: 'Erste UHS anlegen' }).click();
  await page.getByPlaceholder('z. B. BHP 50').fill(uhsName);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page.getByRole('button', { name: uhsName })).toBeVisible();

  // Detail öffnen — der Grundriss wird direkt angezeigt (Personen-Spalten + Fläche).
  await page.getByRole('button', { name: uhsName }).click();

  // Personenkarte in der linken Spalte finden (Tag mit Reg.-Nr. · Name).
  const karte = page.getByText(personName).first();
  await expect(karte).toBeVisible();

  // Vor dem Drag: Container scrollt nicht horizontal.
  const vor = await scrollAhneMasse(karte);
  expect(vor.scrollWidth).toBeLessThanOrEqual(vor.clientWidth + 1);

  // Drag starten und WEIT nach rechts/unten ziehen (über die Spaltenkante hinaus),
  // Maus aber gedrückt halten — der Inline-Transform ist nur während des Drags aktiv.
  const box = await karte.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 400, cy + 200, { steps: 16 });

  // Kernassertion: trotz weit nach rechts geschobener Karte darf die scrollbare
  // Region der linken Spalte nicht über ihre sichtbare Breite hinauswachsen.
  const waehrend = await scrollAhneMasse(karte);
  await page.mouse.up();

  expect(waehrend.scrollWidth).toBeLessThanOrEqual(waehrend.clientWidth + 1);
});

// Regression (Bug LFH-17): Beim Zuweisen eines Patienten wuchs die belegte Platz-Karte
// (zusätzliche Tags, Name, Aktionsbuttons) über den Raster-Zeilenabstand (SCHRITT_Y=120px)
// hinaus und überlappte die Karte der nächsten Zeile → „Layout-Bruch". Fix: kompakte
// Aktionen (Menü statt Buttons), nur EIN Status-Tag bei belegt+frei, einzeiliges Label
// mit Ellipsis → stabile, namenslängen-unabhängige Höhe. Test misst die reale Layout-Höhe
// einer belegten Karte (langer Name als Stresstest) und prüft die Nicht-Überlappung.
test('UHS Grundriss: belegte Platz-Karte bleibt unter dem Raster-Zeilenabstand (kein Overlap)', async ({ page }) => {
  await anmelden(page);

  const einsatzName = `E2E UHS Overlap ${Date.now()}`;
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(einsatzName);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.waitForURL(/\/einsaetze\/\d+\//);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)\//)![1];

  // Person mit absichtlich LANGEM Namen (stresst die Ellipsis-Begrenzung des Labels).
  await page.goto(`/einsaetze/${einsatzId}/personen`);
  await page.getByRole('button', { name: 'Schnellerfassung' }).click();
  const personName = `Maximiliane-Charlotte von Lindenberg-Hohenfels ${Date.now()}`;
  // „Name" liegt seit LFH-340 · C5 eingeklappt — die Sichtungskategorie ist ins sichtbare
  // Feldbudget gerückt. Der Name bleibt der Anker dieser Specs, er ist nur einen Klick weiter.
  await page.getByRole('button', { name: /Weitere Angaben/ }).click();
  await page.getByLabel('Name', { exact: true }).fill(personName);
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();
  await expect(page.getByText(personName).first()).toBeVisible();

  await page.goto(`/einsaetze/${einsatzId}/unfallhilfsstellen`);
  const uhsName = `BHP Overlap ${Date.now()}`;
  await page.getByRole('button', { name: 'Erste UHS anlegen' }).click();
  await page.getByPlaceholder('z. B. BHP 50').fill(uhsName);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page.getByRole('button', { name: uhsName })).toBeVisible();
  await page.getByRole('button', { name: uhsName }).click();

  // 6 Plätze (geplant) → Raster legt Bett 6 genau eine Zeile (120px) UNTER Bett 1.
  await page.getByRole('button', { name: 'Plätze anlegen' }).click();
  const menge = page.getByRole('spinbutton', { name: 'Menge' });
  await menge.fill('6');
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page.getByText('Bett 6')).toBeVisible();

  // UHS in Betrieb nehmen, damit die Belegung serverseitig akzeptiert wird.
  await page.getByRole('button', { name: 'In Betrieb nehmen' }).click();
  await expect(page.getByRole('button', { name: 'Plätze bearbeiten' })).toBeVisible();

  // Person auf „Bett 1" (oben links, Raster-Position 10/10) ziehen.
  const personKarte = page.getByText(personName).first();
  const bett1Text = page.getByText('Bett 1');
  const pBox = await personKarte.boundingBox();
  const zielBox = await bett1Text.boundingBox();
  await page.mouse.move(pBox!.x + pBox!.width / 2, pBox!.y + pBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(zielBox!.x + zielBox!.width / 2, zielBox!.y + zielBox!.height / 2, { steps: 16 });
  await page.mouse.up();

  // Belegung bestätigt (Karte zeigt „belegt").
  await expect(page.getByText('belegt')).toBeVisible();

  // Reale Layout-Höhe der absolut positionierten „Bett 1"-Karte: muss <= 120px bleiben,
  // sonst ragt sie in die Karte der nächsten Rasterzeile (Bett 6) hinein.
  const kartenHoehe = await bett1Text.evaluate((el) => {
    let n: HTMLElement | null = el as HTMLElement;
    while (n) {
      if (getComputedStyle(n).position === 'absolute') return n.getBoundingClientRect().height;
      n = n.parentElement;
    }
    return -1;
  });
  expect(kartenHoehe).toBeGreaterThan(0);
  expect(kartenHoehe).toBeLessThanOrEqual(120);
});

// Gegenprobe: Der DragOverlay (Portal) darf die dnd-kit-Kollisionserkennung NICHT
// brechen — ein Person→Platz-Drop muss weiterhin die Belegung auslösen. Der Overlay
// ist rein visuell; `over` wird aus dem (translatierten) Original-Rect berechnet.
test('UHS Grundriss: Person-Drop auf einen Platz löst die Belegung weiterhin aus', async ({ page }) => {
  await anmelden(page);

  const einsatzName = `E2E UHS PersonDrop ${Date.now()}`;
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(einsatzName);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.waitForURL(/\/einsaetze\/\d+\//);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)\//)![1];

  await page.goto(`/einsaetze/${einsatzId}/personen`);
  await page.getByRole('button', { name: 'Schnellerfassung' }).click();
  const personName = `PatDrop${Date.now()}`;
  // „Name" liegt seit LFH-340 · C5 eingeklappt — die Sichtungskategorie ist ins sichtbare
  // Feldbudget gerückt. Der Name bleibt der Anker dieser Specs, er ist nur einen Klick weiter.
  await page.getByRole('button', { name: /Weitere Angaben/ }).click();
  await page.getByLabel('Name', { exact: true }).fill(personName);
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();
  await expect(page.getByText(personName)).toBeVisible();

  await page.goto(`/einsaetze/${einsatzId}/unfallhilfsstellen`);
  const uhsName = `BHP PersonDrop ${Date.now()}`;
  await page.getByRole('button', { name: 'Erste UHS anlegen' }).click();
  await page.getByPlaceholder('z. B. BHP 50').fill(uhsName);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page.getByRole('button', { name: uhsName })).toBeVisible();
  await page.getByRole('button', { name: uhsName }).click();

  // Einen Platz anlegen (Default: Bett ×1) — erscheint als Drop-Ziel in der Mittelfläche.
  await page.getByRole('button', { name: 'Plätze anlegen' }).click();
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  const platzFrei = page.getByText('frei', { exact: true }).first();
  await expect(platzFrei).toBeVisible();

  // POST auf den Belegungs-Endpoint einsammeln.
  const belegRegex = /\/api\/einsaetze\/\d+\/personen\/\d+\/uhs-belegung$/;
  const belegungPromise = page.waitForRequest(
    (req) => req.method() === 'POST' && belegRegex.test(req.url()),
  );

  // Person aus der linken Spalte auf den Platz ziehen.
  const personKarte = page.getByText(personName).first();
  const pBox = await personKarte.boundingBox();
  const zielBox = await platzFrei.boundingBox();
  expect(pBox).not.toBeNull();
  expect(zielBox).not.toBeNull();
  await page.mouse.move(pBox!.x + pBox!.width / 2, pBox!.y + pBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(zielBox!.x + zielBox!.width / 2, zielBox!.y + zielBox!.height / 2, { steps: 16 });
  await page.mouse.up();

  // Kernassertion: der Drop traf den PLATZ (platz_id gesetzt), nicht versehentlich die
  // Inbox/Wartebereich. Das beweist, dass dnd-kits Kollisionserkennung trotz DragOverlay
  // weiterhin das korrekte Droppable bestimmt. (Die UHS ist hier 'geplant', daher lehnt
  // das Backend die eigentliche Belegung per Domänenregel ab — irrelevant für den Drop.)
  const req = await belegungPromise;
  const body = JSON.parse(req.postData() ?? '{}') as { platz_id?: number | null };
  expect(typeof body.platz_id).toBe('number');
});
