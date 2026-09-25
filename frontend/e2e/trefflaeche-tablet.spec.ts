import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * AK2 aus LFH-333 · B5: der Trefflächen-Nachweis am Führungs-Tablet (LFH-370 · B5j).
 *
 * Gemessen werden drei Stellen, an denen die Dichte-Staffel bis in die Pixel durchschlagen
 * muss: die Modulzeilen im INLINE-Rahmen, die Kategorie-Ziele der IconRail und die
 * Aktionsknöpfe einer Bestätigungsblase. Alles auf derselben Route, ein Seitenaufruf.
 * Dazu seit LFH-380 der Kippschalter (`Switch`) auf einer eigenen Route, Herleitung am
 * Test unten.
 *
 * ── WARUM EINE EIGENE DATEI UND NICHT `dichte.spec.ts` ──────────────────────────────
 *
 * Drei Gründe, jeder für sich hinreichend:
 *  - `dichte.spec.ts:15-19` grenzt sich wörtlich gegen Routen-Geometrie ab („die
 *    vollständige Trefflächen-Geometrie … bleibt bei den Modulpaketen"). AK2 IST diese
 *    Geometrie.
 *  - `dichte.spec.ts:11` setzt „kein Login" als Prämisse. Hier wird angemeldet und geseedet.
 *  - `hasTouch` ist eine BrowserContext-Option und lässt sich, anders als der Viewport,
 *    NICHT zur Laufzeit umstellen — es geht nur über `test.use`. Auf Dateiebene in
 *    `dichte.spec.ts` kippte das dessen Test „ohne Seed bleibt es kompakt" (:86-102) auf
 *    `komfortabel`.
 *
 * ── WARUM `hasTouch` ÜBERHAUPT ───────────────────────────────────────────────────────
 *
 * `setViewportSize` allein liefert KEIN Touch — `matchMedia('(pointer: coarse)')` bliebe
 * false, und das Wort „Tablet" wäre reine Prosa. Gemessen in Chromium: mit `hasTouch: true`
 * meldet die Seite `(pointer: coarse)` und `navigator.maxTouchPoints === 1`, ohne es
 * `(pointer: fine)` und 0. Genau daran hängt `zeigerIstGrob()` (`components/useViewport.ts`),
 * über das `ThemeModeProvider` die Stufe OHNE gespeicherte Wahl auf `komfortabel` vorbelegt
 * (LFH-361). Deshalb steht die `data-dichte`-Wache als erste Zusicherung jedes Tests: sie
 * trennt „Knopf zu klein" von „Stufe gar nicht angekommen".
 *
 * ── SCHWELLE: DIE STAFFEL, NICHT DIE 44 AUS DEM AK-TEXT ─────────────────────────────
 *
 * Das Elternticket nennt 44 px (WCAG SC 2.5.5, AAA). Bindend für die Routen ist aber Gate 3
 * der Bedien-Leitlinie mit 24 / 48 / 72 in der kurzen Achse, und `nav-schmal.spec.ts:24`
 * pinnt bereits 48. Ein Test auf 44 wäre SCHWÄCHER als der Bestand und liesse eine
 * Regression auf 44–47 px durch. Gemessen wird deshalb gegen die Stufe: 48 im
 * Tablet-Durchgang, 72 im Handschuh-Durchgang.
 *
 * Der zweite Durchgang ist nicht Zierde: ohne ihn bestünde ein hartkodiertes
 * `minHeight: 48` den Test, und AK2 hätte nicht belegt, dass die Zeile der STUFE folgt.
 *
 * ── WAS HIER BEWUSST NICHT GEMESSEN WIRD ────────────────────────────────────────────
 *
 * Kein routenweiter Scan aller fokussierbaren Elemente. Zwei Flächen des
 * Navigationsrahmens tragen ein bewusst FESTES `minHeight: 48`: der Drawer-Schliesser
 * (`EinsatzLayout.tsx:462`) und der Akkordeon-Kopf (`ModulAkkordeon.tsx:78`). Auf DIESER
 * Route sind sie nicht im Baum — der Drawer steht erst unter `lg`, `drawerIstNichtImBaum`
 * unten belegt es —, ein solcher Scan auf einem schmalen Schirm liefe aber per
 * Konstruktion rot. AK2 misst nur, was der Dichteachse folgt.
 *
 * DIESE LISTE IST SCHON EINMAL VERROTTET, UND EIN ZWEITES MAL. Beide Male stand hier ein
 * Ausschlussgrund, den der Code nicht mehr hergab:
 *
 *  - DIE ICONRAIL stand bis LFH-337 darin. Seit dem sichtbaren Etikett trägt `railZielStil`
 *    (`IconRail.tsx:41-47`) `Math.max(48, controlHeight)` — also 48 / 48 / 72 und damit
 *    exakt die {@link STAFFEL} dieser Datei; die 48 ist dort BODEN unter der Staffel, nicht
 *    Ersatz für sie. Sie wird seither mitgemessen (Abschnitt (b) unten) statt bloß
 *    umgeschrieben.
 *  - DER HAMBURGER stand bis LFH-516 darin, und das war im Browser widerlegbar:
 *    `EinsatzLayout.tsx:319-320` rechnet ebenfalls `Math.max(48, controlHeight)` und misst
 *    auf 390 px gemessene 48 / 48 / 72 (`gate3-trefflaeche.spec.ts`, Test „Navigations-Drawer
 *    auf 390 px"). Dasselbe gilt für die MODULZEILEN im Drawer — die frühere Fassung nannte
 *    pauschal „die Drawer-Trefffläche in `ModulAkkordeon.tsx:44`", aber die Datei übergibt
 *    dort nur `mindestTrefflaeche={48}`, und `modulZeilenStil` verrechnet das per `Math.max`
 *    mit der Stufe. Fest sind allein die zwei oben genannten Stellen; sie liegen als LFH-537.
 *
 * Ein falscher Ausschlussgrund lädt den nächsten Bearbeiter ein, ihn zu übernehmen —
 * deshalb steht hier je Stelle, WAS sie rechnet, und nicht bloß, dass sie ausgenommen sei.
 *
 * ── DIE BREITE: SEIT LFH-381 DIE STAFFEL, UND ZWAR AM MECHANISMUS ─────────────────
 *
 * Bis LFH-381 stand hier die Begründung, warum die Breite beschrifteter Knöpfe NICHT gegen
 * die Staffel geprüft wird: sie folgte der Beschriftung, nicht der Dichteachse — antds
 * `paddingInlineSM` ist das Literal `8 - lineWidth` = 7, der OK-Knopf mass rund 38 px in
 * JEDER Stufe, und geprüft wurde deshalb nur der harte Gate-1-Boden (24 px). Seit LFH-381
 * trägt jeder Knopf einen Breitenboden am Kontext (`antdKnopf()` in `theme/tokens.ts`,
 * `minWidth` = kleine Steuerhöhe), und die Breite wird hier gegen dieselbe Stufe geprüft
 * wie die Höhe.
 *
 * Der Einwand von damals gilt weiter und bestimmt die FORM der Zusicherung: eine bloße
 * Breitenmessung pinnte den Wortlaut, nicht den Mechanismus. Mit einem langen `okText`
 * wäre der Knopf auch ohne jeden Boden breit genug, und die Messung bliebe grün, während
 * alle übrigen Bestätigungsblasen zu schmal wären. Geprüft werden deshalb ZWEI Dinge:
 *  - die URSACHE: `getComputedStyle().minWidth` ist genau die Stufe. Das hängt weder am
 *    Etikett noch an der Einblendung (`transform` ändert keinen berechneten Stil);
 *  - die WIRKUNG: die gemessene Breite erreicht die Stufe.
 * Gegenprobe von Hand, gemessen am 24.09.2026 (LFH-381):
 *  - Boden aus `ThemeModeProvider` entfernt → beide Durchgänge rot, an der Ursache
 *    (`min-width` 0px statt 48px/72px).
 *  - Boden entfernt UND `okText="Kraft entfernen"` an der Personal-Blase (samt Etikett in der
 *    Schleife unten) → WEITER rot, an derselben Stelle. Eine reine Breitenmessung wäre hier
 *    grün geworden.
 *  - Boden drin und langer `okText` → grün.
 * Der Test fällt also am Mechanismus, nicht am Wortlaut. Der Messwert der Breite steht
 * weiter als Annotation im Bericht.
 *
 * Der Bestand stützt die Unterscheidung nach wie vor: `nav-schmal.spec.ts:191/211` misst
 * beide Achsen an ICON-ONLY-Knöpfen (dort bindet antd die Breite selbst an `controlHeight`),
 * `datensicht-schmal.spec.ts:154-163` misst an beschrifteten Zielen die Höhe.
 *
 * BEWUSST KEIN Device-Descriptor und kein zweites Playwright-Projekt — ein `devices['iPad …']`
 * zöge webkit nach, und ein Browser-Download ist im Repo nirgends abgesichert
 * (gleichlautend in fünf Bestands-Specs begründet).
 */
test.use({ hasTouch: true });

/** Führungs-Tablet nach A1: 1024 × 768, über antds `lg` (992) — der inline-Rahmen steht. */
const TABLET = { width: 1024, height: 768 };

/**
 * Subpixel-Spielraum für JEDEN Maßvergleich. `boundingBox()` liefert Fliesskomma, und
 * Chromium rechnet unter Last anders als im Einzellauf; in `nav-schmal.spec.ts:26-40` sind
 * drei gemessene Brüche dieser Art dokumentiert (`47.99999809` gegen 48). Ein Gate, das
 * zufällig rot wird, wird abgeschaltet statt befolgt.
 */
const SUBPIXEL = 0.5;

/** Gate 3: die Dichte-Staffel. Handgeschriebene Literale — aus dem Token zurückgelesen
 *  prüfte die Zusicherung sich selbst. */
const STAFFEL = [
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const KRAFT = 'Kirchgassner-Wohlfahrt, Maximiliane';

// Login-/Anlege-Helfer kopiert — es gibt (noch) kein geteiltes e2e-Hilfsmodul (gleichlautend
// in fünf Bestands-Specs vermerkt; `grep '^export' e2e/*.ts` liefert null Treffer).
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

/** Seeding per `page.request`: die Session ist Cookie-basiert und der Jar wird geteilt. */
async function seedeKraft(page: Page, einsatzId: string) {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personal`, {
    data: {
      adhoc: {
        name: KRAFT,
        funktion: 'Abschnittsleitung Technische Hilfeleistung',
        traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest',
      },
    },
  });
  expect(
    antwort.ok(),
    `Seeding Personal: ${antwort.status()} ${await antwort.text()}`,
  ).toBeTruthy();
}

/**
 * Höhe genau eines Knotens, subpixel-tolerant gegen die Sollstufe.
 *
 * `expect.poll` statt einer einmaligen Messung, und der Grund ist gemessen: antd blendet die
 * Bestätigungsblase mit `zoom-big-fast` ein, die bei `transform: scale(0.8)` beginnt.
 * `boundingBox()` liefert die TRANSFORMIERTE Box — mitten in der Einblendung misst man
 * deshalb exakt 80 % (gemessen 38,4 statt 48 und 57,6 statt 72; `getComputedStyle().height`
 * sagte an derselben Stelle bereits korrekt 48px bzw. 72px). Ohne das Warten prüfte dieser
 * Test die Animationskurve statt der Trefffläche und wäre je nach Maschinenlast rot.
 *
 * Das ist zugleich die Antwort auf einen Widerspruch, den dieses Ticket mitbrachte: der
 * Ticket-Text behauptete, beim Popconfirm genüge ein Token-Fix „nachweislich nicht". Er
 * genügt — seit LFH-361 liegt `controlHeightSM` auf 24/48/72, und ein kleiner Knopf liest
 * genau diesen Token. Die scheinbare Gegenmessung war die Einblendung.
 */
async function haeltTreffflaeche(ziel: Locator, soll: number, name: string): Promise<number> {
  await expect(ziel, `${name}: genau ein Knoten muss gemessen werden`).toHaveCount(1);
  await expect
    .poll(async () => (await ziel.boundingBox())?.height ?? 0, {
      message: `${name}: Soll ≥ ${soll} px hoch (subpixel-tolerant, nach der Einblendung)`,
    })
    .toBeGreaterThanOrEqual(soll - SUBPIXEL);
  const kasten = await ziel.boundingBox();
  expect(kasten, `${name}: kein Kasten messbar`).not.toBeNull();
  return kasten!.width;
}

/**
 * Der Drawer darf bei 1024 GAR NICHT im Baum sein.
 *
 * Ohne diese Probe wäre der ganze Test auch dann grün, wenn er versehentlich den Drawer
 * misst — `ModulAkkordeon.tsx:98` übergibt dort bereits 48, die Zeile wäre sofort gross
 * genug, ohne dass der inline-Rahmen je angefasst worden wäre. Wortlaut aus
 * `nav-schmal.spec.ts:250-252`.
 *
 * Steht VOR jedem Öffnen einer Blase. Die Popconfirm-Blase trägt zwar `role="tooltip"`
 * (@rc-component/tooltip) und nicht `dialog`, der Zähler bliebe also auch bei offener Blase
 * 0 — aber die Reihenfolge soll die Aussage nicht verwässern.
 */
async function drawerIstNichtImBaum(page: Page) {
  await expect(page.getByRole('navigation', { name: 'Kategorien' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Navigation öffnen' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

for (const { dichte, soll } of STAFFEL) {
  test(`Führungs-Tablet, Stufe ${dichte}: Modulzeilen und Bestätigungsknöpfe halten ${soll} px`, async ({
    page,
  }) => {
    // Anmelden und Anlegen laufen am Fükw-Mass (Projekt-Default 1280 × 720), erst danach wird
    // umgestellt — Vorgehen aus `nav-schmal.spec.ts:14-17` und `datensicht-schmal.spec.ts:63-66`.
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `Trefflaeche ${dichte} ${Date.now()}`);
    await seedeKraft(page, einsatzId);

    await page.setViewportSize(TABLET);

    if (dichte === 'handschuh') {
      // Eine GESPEICHERTE Wahl gewinnt gegen die Zeigerart (LFH-361) — nur so ist die
      // Handschuh-Stufe am Tablet überhaupt erreichbar. `ThemeModeProvider` liest den
      // Speicher beim Montieren, ein Setzen ohne Neuladen bliebe folgenlos.
      await page.goto(`/einsaetze/${einsatzId}/personal`);
      await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
        DICHTE_SCHLUESSEL,
        dichte,
      ] as const);
      await page.reload();
    } else {
      await page.goto(`/einsaetze/${einsatzId}/personal`);
    }

    /**
     * KEIN `waitForLoadState('networkidle')`. Die Bestands-Specs benutzen es (16 Stellen in
     * 6 Dateien) und diese Datei hatte es zunächst mitkopiert — es ist auf Einsatzrouten
     * strukturell fragil, weil dort ein SSE-Strom offen bleibt und die Bedingung „500 ms
     * keine Netzwerkaktivität" damit nie sauber eintritt. Gemessen: `datensicht-schmal.spec.ts`
     * fällt daran unter paralleler Ausführung reproduzierbar, isoliert nicht — auf main
     * genauso wie hier (→ LFH-385).
     *
     * Die folgenden Zusicherungen warten von sich aus (Playwright wiederholt sie bis zum
     * Zeitlimit) und sind inhaltlich, nicht netzwerklich — das ist die tragfähigere Wache.
     *
     * DIE WACHE selbst: im Tablet-Durchgang belegt sie, dass der grobe Zeiger die Stufe
     * vorbelegt hat (ohne gespeicherte Wahl); im Handschuh-Durchgang, dass die gespeicherte
     * Wahl angekommen ist. Ohne sie wäre ein verworfener Speicherwert nicht von einem
     * Darstellungsfehler zu unterscheiden, und jedes „zu klein" hätte zwei mögliche Ursachen.
     */
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

    await drawerIstNichtImBaum(page);

    // ── (a) Modulzeilen im INLINE-Rahmen ──────────────────────────────────────────────
    const panel = page.locator('[data-lfh="modul-panel"]');
    await expect(panel, 'der inline-Rahmen steht bei 1024 px').toHaveCount(1);
    for (const modul of ['Einheiten', 'Personal', 'Fahrzeuge', 'Material']) {
      await haeltTreffflaeche(
        panel.getByRole('button', { name: modul, exact: true }),
        soll,
        `Modulzeile „${modul}"`,
      );
    }

    // ── (b) die Kategorie-Ziele der IconRail ──────────────────────────────────────────
    //
    // Auf die Landmarke gescopt: „Lage" steht seit LFH-337 auch als Panel-Überschrift im
    // Baum, eine seitenweite Namensabfrage träfe zwei Knoten. `drawerIstNichtImBaum` oben
    // hat die Rail bereits als sichtbar belegt — hier geht es nur noch um die Höhe.
    const rail = page.getByRole('navigation', { name: 'Kategorien' });
    for (const kategorie of ['Führung', 'Lage']) {
      await haeltTreffflaeche(
        rail.getByRole('button', { name: kategorie, exact: true }),
        soll,
        `Kategorie-Ziel „${kategorie}"`,
      );
    }

    // ── (c) die AKTIONSKNÖPFE einer Bestätigungsblase, nicht ihr Auslöser ─────────────
    const zeile = page.locator('tr.ant-table-row');
    await expect(zeile, 'genau die eine geseedete Kraft').toHaveCount(1);

    const ausloeser = zeile.getByRole('button', { name: 'Entfernen', exact: true });
    // Der Auslöser hängt an `controlHeight`, die Blasenknöpfe an `controlHeightSM` — beide
    // zu messen macht die Aussage schärfer, weil sie zwei verschiedene Token prüfen.
    await haeltTreffflaeche(ausloeser, soll, 'Auslöser „Entfernen"');
    await ausloeser.click();

    /**
     * Die Blase scopen. GEMESSENE FALLE: die Ausblendklasse trägt das POPOVER-Präfix, nicht
     * das Popconfirm-Präfix — Popconfirm rendert über Popover, und @rc-component/trigger
     * setzt `${prefixCls}-hidden`. Ohne den Filter erwischt man ein geschlossenes Portal aus
     * einem früheren Klick; antd lässt sie im Baum stehen.
     */
    const blase = page.locator('.ant-popconfirm:not(.ant-popover-hidden)');
    await expect(blase, 'genau eine offene Bestätigungsblase').toHaveCount(1);

    // Sichtbare Beschriftungen per `getByRole(..., { name })`, nicht `getByText` — das AK
    // verlangt es, und `getByText` matchte auch `sr-only`/`aria-hidden`. Die Etiketten sind
    // vertraglich: antds `de_DE` liefert „OK" und „Abbrechen".
    for (const etikett of ['OK', 'Abbrechen']) {
      const knopf = blase.getByRole('button', { name: etikett, exact: true });
      const breite = await haeltTreffflaeche(knopf, soll, `Bestätigungsknopf „${etikett}"`);

      // Die URSACHE: der Breitenboden ist genau die Stufe (Herleitung im Dateikopf). Ohne
      // diese Zeile bestünde ein langes Etikett den Test auch ohne jeden Boden.
      expect(
        await knopf.evaluate((el) => getComputedStyle(el).minWidth),
        `Bestätigungsknopf „${etikett}": Breitenboden der Stufe`,
      ).toBe(`${soll}px`);
      // Die WIRKUNG: die gemessene Breite erreicht die Stufe.
      expect(
        breite,
        `Bestätigungsknopf „${etikett}" (gemessen ${breite}px breit, Soll ≥ ${soll})`,
      ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
      test.info().annotations.push({
        type: 'messwert',
        description: `Knopf „${etikett}" in ${dichte}: ${breite}px breit`,
      });
    }

    // Über „Abbrechen" schliessen, nicht über OK: OK löschte die geseedete Kraft. Nebenbei
    // belegt der Klick, dass der Knopf überhaupt bedienbar ist — ein 0×0-Element liesse sich
    // nicht klicken.
    await blase.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(blase).toHaveCount(0);
  });
}

/**
 * Der Kippschalter selbst, nicht nur seine Zeile (LFH-380).
 *
 * antd rechnet die Schalterhöhe aus der Schrift statt aus `controlHeight` — ohne die Ableitung
 * gemessen 23 px im Tablet-Durchgang und ebenso im Handschuh, ein Drittel des Bodens. LFH-370 hatte
 * die ZEILE um den Schalter gehoben (`zeilenzielStil`), das Steuerelement blieb darunter.
 * Die Ableitung steht in `theme/tokens.ts` (`switchMasse`) und hängt global an
 * `antdKomponenten` — gemessen wird deshalb ein beliebiger Schalter der App, hier der der
 * Anmeldeverfahren, weil er ohne Seeding immer im Baum steht: der Passwort-Weg ist
 * garantiert und gesperrt. Gesperrt ändert an der Geometrie nichts.
 *
 * ZWEI Achsen: die Höhe gegen die Staffel, die Breite gegen das Doppelte. Ein Schalter ist
 * ein Kippschalter, seine kurze Achse ist die Höhe — aber eine Spur, die nur in der Höhe
 * wächst, trüge einen Griff, der breiter ist als die Hälfte der Spur, und kippte nicht mehr
 * sichtbar. Die Breite belegt, dass der abhängige Token-Satz mitgekommen ist.
 *
 * Kein `drawerIstNichtImBaum`: die Admin-Route hat keine IconRail, die Probe wäre dort per
 * Konstruktion rot.
 */
for (const { dichte, soll } of STAFFEL) {
  test(`Führungs-Tablet, Stufe ${dichte}: der Kippschalter selbst hält ${soll} px`, async ({
    page,
  }) => {
    await anmelden(page);
    await page.setViewportSize(TABLET);
    await page.goto('/admin/einstellungen/anmeldung');
    if (dichte === 'handschuh') {
      // Gespeicherte Wahl schlägt die Zeigerart (LFH-361), wirksam erst nach dem Neuladen.
      await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
        DICHTE_SCHLUESSEL,
        dichte,
      ] as const);
      await page.reload();
    }
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

    const schalter = page.getByRole('switch', { name: 'Anmeldeverfahren: Passwort', exact: true });
    const breite = await haeltTreffflaeche(schalter, soll, 'Kippschalter „Passwort"');
    expect(
      breite,
      `Kippschalter „Passwort" (gemessen ${breite}px breit, Soll ≥ ${2 * soll})`,
    ).toBeGreaterThanOrEqual(2 * soll - SUBPIXEL);
    test.info().annotations.push({
      type: 'messwert',
      description: `Kippschalter in ${dichte}: ${breite}px breit`,
    });
  });
}
