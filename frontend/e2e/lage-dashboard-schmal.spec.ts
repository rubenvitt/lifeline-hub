import { expect, test, type Page } from '@playwright/test';

/**
 * Die Kennzahlenleiste des Lage-Dashboards auf den drei Prüfbreiten (LFH-329 · B1).
 *
 * WARUM HIER UND NICHT IN VITEST: `vite.config.ts` fährt Vitest mit `css: false`,
 * und jsdom rechnet kein Layout — eine Container-Regel hat dort null Wirkung,
 * `gridTemplateColumns` bliebe leer und `scrollWidth` konstant 0. Dass die
 * Leiste UMBRICHT statt zu scrollen, ist ausschließlich hier messbar. Den
 * Quelltext der Staffel bewacht ergänzend ein Pin in
 * `src/pages/lage-dashboard/LageDashboardPage.test.tsx`.
 *
 * DIE STAFFEL HÄNGT AM CONTAINER, NICHT AM VIEWPORT: `.lfh-flaeche` trägt
 * `container-type: inline-size` (sprache.css). Gemessen wird deshalb immer
 * beides — die Viewport-Breite, die der Test einstellt, und die Container-
 * Breite, die daraus wirklich übrig bleibt. Letztere hängt am
 * Navigationsrahmen (unter `lg` ein Griff im Kopf, darüber Leiste + Panel) und
 * an der Seitenrinne; sie steht als Anmerkung in jedem Testergebnis, damit eine
 * spätere Schwellenverschiebung nachgerechnet und nicht geraten wird.
 *
 * Bewusst KEIN zweites Playwright-Projekt und kein Device-Descriptor: ein
 * `devices['iPhone …']` zöge webkit nach, und ein Browser-Download ist im Repo
 * nirgends abgesichert. Die Breite kommt per `setViewportSize` im bestehenden
 * chromium-Projekt.
 *
 * NICHT geprüft: `document.body.scrollWidth` auf Dokumentebene. Diese Spec
 * misst die Fläche, die die Leiste besitzt — der dokumentweite Überlauf hängt
 * am Navigationsrahmen und wird in `nav-schmal.spec.ts` belegt.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

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

/** Einmal angelegt, von allen Tests der Datei weiterbenutzt — vier Einsätze für
 *  dieselbe Vorbedingung wären reine Gate-Laufzeit. */
let einsatzId: string | null = null;

/**
 * Meldet an, stellt die Prüfbreite ein und öffnet das Dashboard.
 *
 * Anmeldung und Anlegen laufen im Default-Viewport (1280 × 720): auf 390 px
 * liegt „Neuer Einsatz" hinter dem Kopfgriff, und das Setup bräche an einer
 * Stelle, die dieser Test gar nicht prüft.
 */
async function dashboardOeffnen(page: Page, breite: number, hoehe: number) {
  await anmelden(page);
  einsatzId ??= await einsatzAnlegen(page, `E2E Kennzahlen ${Date.now()}`);

  await page.setViewportSize({ width: breite, height: hoehe });
  await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
  await expect(page.locator('.lfh-kennzahlen .lfh-kz')).toHaveCount(6);
}

/** Spaltenzahl + Container-Breite der Leiste, als Anmerkung protokolliert. */
async function messen(page: Page, viewportBreite: number) {
  const leiste = page.locator('.lfh-kennzahlen');
  const flaeche = page.locator('.lfh-flaeche');
  // Beweist, dass die Selektoren genau einen Knoten treffen — sonst wäre eine
  // grüne Zusicherung grün durch Nichtstun.
  await expect(flaeche).toHaveCount(1);
  await expect(leiste).toHaveCount(1);

  const mass = await leiste.evaluate((el) => ({
    spalten: getComputedStyle(el).gridTemplateColumns.split(' ').length,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  const flaecheBreite = await flaeche.evaluate((el) => el.clientWidth);

  test.info().annotations.push({
    type: 'gemessen',
    description:
      `Viewport ${viewportBreite} px → .lfh-flaeche ${flaecheBreite} px (Container) ` +
      `→ ${mass.spalten} Spalten, Leiste ${mass.scrollWidth}/${mass.clientWidth} px (Inhalt/Fläche), ` +
      // Die Einsatz-Nummer steht mit in der Anmerkung, damit belegt ist, dass alle
      // drei Tests DIESELBE Vorbedingung teilen — sonst legte ein Nachbartest still
      // seinen eigenen Einsatz an und niemand sähe es.
      `Einsatz ${einsatzId}`,
  });

  return { ...mass, flaecheBreite };
}

async function keinWaagerechterUeberlauf(page: Page) {
  for (const wahl of ['.lfh-kennzahlen', '.lfh-flaeche']) {
    const mass = await page.locator(wahl).evaluate((el) => ({
      scroll: el.scrollWidth,
      klient: el.clientWidth,
    }));
    expect(mass.scroll, `${wahl}: Inhalt breiter als die Fläche`).toBeLessThanOrEqual(
      mass.klient + 1,
    );
  }
}

/**
 * Jede Kennzahl steht vollständig in ihrem eigenen Knopf.
 *
 * Das ist die schärfere Prüfung: die Leiste ist ein Raster aus
 * `minmax(0, 1fr)` — sie bekommt NIE eine waagerechte Bildlaufleiste, auch
 * wenn die Spalten viel zu schmal werden. Zu schmale Spalten zeigen sich erst
 * hier, weil das längste Etikett („Kräfte F/UF/M//Σ", oberhalb der
 * Umbruchschwelle einzeilig) dann über seinen Knopf hinausläuft. Gemessen: bei
 * sechs erzwungenen Spalten läuft es ab Container 950 px um 14 px über, ab
 * 1036 px gar nicht mehr.
 */
async function jedeKennzahlStehtInIhremKnopf(page: Page) {
  const masse = await page.locator('.lfh-kennzahlen').evaluate((el) =>
    Array.from(el.querySelectorAll('.lfh-kz')).map((k) => ({
      scroll: k.scrollWidth,
      klient: k.clientWidth,
    })),
  );
  expect(masse).toHaveLength(6);
  for (const [i, mass] of masse.entries()) {
    expect(mass.scroll, `Kennzahl ${i + 1}: Inhalt läuft aus dem Knopf`).toBeLessThanOrEqual(
      mass.klient + 1,
    );
    expect(mass.klient, `Kennzahl ${i + 1} ohne Breite`).toBeGreaterThan(0);
  }
}

/**
 * Unterhalb der Umbruchschwelle bricht ein zu langes Etikett UM, statt einzeilig
 * zu bleiben — `sprache.css` setzt dort `.lfh-etikett { white-space: normal }`
 * mit der Begründung „Abgeschnittene Etiketten sind im Einsatz schlimmer als
 * eine zweite Zeile."
 *
 * WARUM DAS EINEN EIGENEN NACHWEIS BRAUCHT: die Regel war von keiner einzigen
 * Prüfung bewacht — man konnte sie ersatzlos entfernen, ohne dass irgendein Test
 * rot wurde (nachgemessen). Insbesondere fängt `jedeKennzahlStehtInIhremKnopf`
 * sie NICHT: das längste Etikett („Höchste Warnstufe") misst 161 px und passt
 * damit auch einzeilig in seinen 183 px breiten Knopf. Es läuft nicht über — es
 * bliebe bloß einzeilig, wo es zweizeilig gehört. Der einzige messbare
 * Unterschied ist die HÖHE des Etiketts: 30,4 px mit der Regel (zwei Zeilen à
 * 15,2), 15,2 px ohne sie.
 *
 * Gemessen wird gegen die gerechnete Zeilenhöhe, nicht gegen die feste 30,4:
 * eine Schriftgrößen-Pflege verschöbe sonst beide Werte und färbte den Test rot,
 * ohne dass die Regel litte.
 */
async function langesEtikettBrichtUm(page: Page) {
  const mass = await page.locator('.lfh-kennzahlen').evaluate((el) => {
    const etiketten = Array.from(el.querySelectorAll('.lfh-etikett'));
    const hoechstes = etiketten.reduce((a, b) =>
      a.getBoundingClientRect().height >= b.getBoundingClientRect().height ? a : b,
    );
    return {
      zeilenhoehe: parseFloat(getComputedStyle(etiketten[0]).lineHeight),
      whiteSpace: getComputedStyle(etiketten[0]).whiteSpace,
      maxHoehe: hoechstes.getBoundingClientRect().height,
      text: hoechstes.textContent,
      anzahl: etiketten.length,
    };
  });
  expect(mass.anzahl, 'Etiketten gefunden').toBe(6);
  expect(
    mass.maxHoehe,
    `Kein Etikett bricht um — „${mass.text}" misst ${mass.maxHoehe}px bei ` +
      `Zeilenhöhe ${mass.zeilenhoehe}px (white-space: ${mass.whiteSpace})`,
  ).toBeGreaterThan(mass.zeilenhoehe * 1.5);
}

// Bewusst KEIN `.serial`: die drei Tests sind unabhängig (jeder meldet sich
// selbst an), und im Reihen-Modus verdeckte ein Fehlschlag am Fükw-Schirm die
// Messwerte der übrigen zwei Breiten — also genau die Zahlen, die man zur
// Diagnose braucht. Den einmal angelegten Einsatz teilen sie ohne `.serial`,
// weil die Tests einer Datei ohne `fullyParallel` ohnehin nacheinander im
// selben Worker laufen.
test.describe('Kennzahlenleiste auf den drei Prüfbreiten', () => {
  test('am Fükw-Schirm (1366 px) steht jede Kennzahl vollständig in ihrem Knopf', async ({
    page,
  }) => {
    // Der primäre Einsatzkontext (Fükw, 13–15"). Gemessen bleiben von 1366 px
    // Viewport 1036 px Container übrig — der Navigationsrahmen (Leiste + Panel)
    // und die Seitenrinne nehmen den Rest. Damit liegt die Fläche UNTER der
    // Sechser-Schwelle von 1100 px, und die Leiste steht in 3 Spalten × 2 Zeilen.
    //
    // Das ist bewusst so: sechs Spalten brauchen mindestens ~1036 px Container,
    // sonst laufen die Etiketten aus ihren Knöpfen (gemessen: 950 px → 14 px
    // Überlauf). Eine Schwelle, die auf den Pixel genau aufgeht, ist keine
    // Schwelle. Wer das ändern will, misst neu — die Herleitung steht über dem
    // Container-Block in `src/theme/sprache.css`.
    await dashboardOeffnen(page, 1366, 768);
    const mass = await messen(page, 1366);
    expect(mass.spalten, 'Spalten am Fükw-Schirm').toBe(3);
    await keinWaagerechterUeberlauf(page);
    await jedeKennzahlStehtInIhremKnopf(page);

    // Gegenprobe zur Umbruchregel am Handschirm: OBERHALB der Schwelle bleiben
    // die Etiketten einzeilig. Ohne diese Zeile belegte der Umbruch-Nachweis
    // unten nur „irgendetwas bricht um", nicht „die Regel greift genau unterhalb
    // der Schwelle". Gemessen ist hier `nowrap` (Grundregel), unter 700 px
    // Container `normal`. Geprüft wird der gerechnete Stil und nicht die Höhe:
    // die hinge an der Etikettenlänge und bräche bei jeder Textpflege.
    const umbruch = await page
      .locator('.lfh-kennzahlen .lfh-etikett')
      .first()
      .evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(umbruch, 'Etiketten am Fükw-Schirm einzeilig').toBe('nowrap');
  });

  test('bei 1024 px steht die Kennzahlenleiste in 2 Spalten', async ({ page }) => {
    // Führungs-Tablet. Gemessen bleiben von 1024 px Viewport 694 px Container
    // übrig — 6 px UNTER der Umbruchschwelle von 700 px, die Leiste steht also in
    // 2 Spalten × 3 Zeilen.
    //
    // FRÜHER STAND HIER, eine Spaltenzahl-Zusicherung sei bewusst weggelassen,
    // weil die 694 px „jede Änderung an Navigationsrahmen oder Seitenrinne
    // kippt". Das war die Begründung dafür, dass dieser Test gar nichts
    // Unterscheidendes behauptete: die Überlaufprüfungen können hier nämlich
    // beide nicht fallen. `.lfh-kennzahlen` ist ein Raster aus `minmax(0, 1fr)`
    // und kann seinen Container waagerecht nicht überlaufen, und unterhalb von
    // 700 px Container setzt `sprache.css` `.lfh-etikett { white-space: normal }`
    // — umbrechende Etiketten laufen aus ihrem Knopf nicht heraus. Übrig blieb
    // die `.lfh-flaeche`-Hälfte; die zugesagte Aussage „jede Kennzahl ist lesbar"
    // war nicht gepinnt.
    //
    // Dass die 694 px empfindlich sind, ist deshalb kein Grund, nichts zu prüfen
    // — es ist der Grund, WARUM geprüft wird: verschiebt der Navigationsrahmen
    // die Fläche über 700 px, springt die Leiste auf 3 Spalten, und das gehört
    // gesehen. Die Container-Breite steht als eigene Zusicherung daneben, damit
    // ein Bruch benennt, welche Seite gekippt ist, statt nur „erwartet 2, war 3".
    await dashboardOeffnen(page, 1024, 768);
    const mass = await messen(page, 1024);
    expect(mass.flaecheBreite, 'Container unter der 700-px-Schwelle').toBeLessThan(700);
    expect(mass.spalten, 'Spalten am Führungs-Tablet').toBe(2);
    await keinWaagerechterUeberlauf(page);
    await jedeKennzahlStehtInIhremKnopf(page);
  });

  test('die Kennzahlenleiste bricht bei 390 px auf 2 Spalten und scrollt nicht waagerecht', async ({
    page,
  }) => {
    // Handschirm, einhändig. 6 Kennzahlen / 2 Spalten = 3 Zeilen — das Paketziel:
    // die Leiste bricht um, statt den Inhalt hinter einer waagerechten
    // Bildlaufleiste zu verstecken.
    //
    // ZUSAMMENGEFÜHRT aus zwei Tests, die dieselbe Vorbereitung auf derselben
    // Breite fuhren: „bricht auf 2 Spalten" und „scrollt nicht waagerecht".
    //
    // ACHTUNG, DAS WAR KEINE DUBLETTE — die naheliegende Begründung „der zweite
    // ist eine Teilmenge des ersten" ist FALSCH und per Mutationsprobe widerlegt:
    // setzt man im 700-px-Block `minmax(0, 1fr)` auf `minmax(220px, 1fr)`, fällt
    // NUR `keinWaagerechterUeberlauf` (gemessen: Leisteninhalt 441 px in 367 px
    // Fläche), während Spaltenzahl und „jede Kennzahl in ihrem Knopf" grün
    // bleiben. Die beiden Tests trugen also je eine eigene Aussage.
    //
    // Zusammengeführt wird trotzdem, aber unter einer Bedingung, die hier erfüllt
    // ist: es geht KEINE Zusicherung verloren. Der Test unten fährt alle drei
    // Prüfungen an derselben Messung. Gegenprobe mit derselben Mutation: der
    // zusammengeführte Test wird rot (an genau der Zeile oben). Was gespart wird,
    // ist ein Anmeldezyklus, nicht eine Aussage.
    await dashboardOeffnen(page, 390, 844);
    const mass = await messen(page, 390);
    expect(mass.spalten, 'Spalten am Handschirm').toBe(2);
    await keinWaagerechterUeberlauf(page);
    await jedeKennzahlStehtInIhremKnopf(page);
    await langesEtikettBrichtUm(page);
  });
});
