import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Trefflächen-Nachweis am Führungs-Tablet: Modulzeilen im INLINE-Rahmen, Kategorie-Ziele der
 * IconRail und die Aktionsknöpfe einer Bestätigungsblase (eine Route), dazu der Kippschalter
 * (`Switch`) auf einer eigenen Route.
 *
 * `hasTouch` ist eine Kontext-Option und geht nur über `test.use`, deshalb eine eigene Datei
 * (in `dichte.spec.ts` kippte es dessen Vorgabe-Test). `setViewportSize` allein liefert kein
 * Touch: erst mit `hasTouch` meldet die Seite `(pointer: coarse)`, und `zeigerIstGrob()`
 * belegt die Stufe ohne gespeicherte Wahl auf `komfortabel` vor. Die `data-dichte`-Wache
 * steht deshalb vorn: sie trennt „Knopf zu klein" von „Stufe nicht angekommen".
 *
 * SCHWELLE IST DIE STAFFEL (48 bzw. 72), nicht die 44 aus WCAG 2.5.5 — ein Test auf 44 ließe
 * eine Regression auf 44–47 px durch. Der Handschuh-Durchgang belegt, dass die Zeile der
 * STUFE folgt und kein festes `minHeight: 48` trägt.
 *
 * DER NAVIGATIONSRAHMEN FOLGT DER STAFFEL AUF BEIDEN ACHSEN (LFH-384). Die vier Stellen, die
 * bis dahin ausgenommen waren — IconRail, Hamburger, Drawer-Schließer, Akkordeon-Kopf —
 * rechnen `Math.max(48, controlHeight)`; die Rail-Spalte wächst in `handschuh` auf 73 px
 * (72 Ziel + Haarlinie), statt ihre Breite als Dauerausnahme zu behalten (Entscheidung vom
 * 29.09.2026, Nachtrag Z2 in `docs/superpowers/specs/2026-07-28-rahmen-pruefliste.md`).
 * Rail und Modul-Panel misst der Durchgang am Tablet QUER (1024, inline-Rahmen), Hamburger,
 * Akkordeon und Schließer der Durchgang HOCHKANT (768, unter antds `lg` — der Drawer-Zweig).
 *
 * DIE BREITE der Blasenknöpfe trägt einen Boden am Kontext (`antdKnopf()`, `minWidth` =
 * kleine Steuerhöhe). Eine bloße Breitenmessung pinnte den Wortlaut — mit langem `okText`
 * wäre der Knopf auch ohne Boden breit genug. Geprüft werden deshalb die URSACHE (berechnetes
 * `minWidth` ist genau die Stufe; `transform` ändert keinen berechneten Stil) und die WIRKUNG
 * (gemessene Breite).
 */
test.use({ hasTouch: true });

/** Führungs-Tablet nach A1: 1024 × 768, über antds `lg` (992) — der inline-Rahmen steht. */
const TABLET = { width: 1024, height: 768 };

/** Dasselbe Tablet hochkant: 768 liegt unter antds `lg`, der Rahmen wird zum Drawer. */
const TABLET_HOCHKANT = { width: 768, height: 1024 };

/**
 * Subpixel-Spielraum für JEDEN Maßvergleich: `boundingBox()` liefert Fließkomma
 * (`47.99999809` gegen 48), und ein zufällig rotes Gate wird abgeschaltet statt befolgt.
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
 * Höhe genau eines Knotens, subpixel-tolerant gegen die Sollstufe. `expect.poll`, weil antd
 * die Blase mit `zoom-big-fast` ab `scale(0.8)` einblendet und `boundingBox()` die
 * transformierte Box liefert — sonst prüfte der Test die Animationskurve.
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
 * Der Drawer darf bei 1024 GAR NICHT im Baum sein — sonst wäre der Test auch grün, wenn er
 * versehentlich den Drawer misst (dort übergibt `ModulAkkordeon` bereits 48). Steht vor jedem
 * Öffnen einer Blase.
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
    // Anmelden und Anlegen am Projekt-Vorgabemaß, erst danach umstellen.
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `Trefflaeche ${dichte} ${Date.now()}`);
    await seedeKraft(page, einsatzId);

    await page.setViewportSize(TABLET);

    if (dichte === 'handschuh') {
      // Eine GESPEICHERTE Wahl gewinnt gegen die Zeigerart — nur so ist die Handschuh-Stufe am
      // Tablet erreichbar. `ThemeModeProvider` liest den Speicher beim Montieren.
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
     * Kein `networkidle`: auf Einsatzrouten bleibt ein SSE-Strom offen, die Bedingung tritt
     * nie sauber ein. Die Zusicherungen warten inhaltlich von selbst.
     *
     * Die Wache belegt im Tablet-Durchgang die Vorbelegung durch den groben Zeiger, im
     * Handschuh-Durchgang die gespeicherte Wahl — sonst hätte jedes „zu klein" zwei Ursachen.
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
    // Auf die Landmarke gescopt: „Lage" steht auch als Panel-Überschrift im Baum.
    // BEIDE Achsen: die Spalte ist fest, ein Ziel kann nur so breit sein wie sie (LFH-384).
    const rail = page.getByRole('navigation', { name: 'Kategorien' });
    for (const kategorie of ['Führung', 'Lage']) {
      const breite = await haeltTreffflaeche(
        rail.getByRole('button', { name: kategorie, exact: true }),
        soll,
        `Kategorie-Ziel „${kategorie}"`,
      );
      expect(
        breite,
        `Kategorie-Ziel „${kategorie}" (gemessen ${breite}px breit, Soll ≥ ${soll})`,
      ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
    }

    // ── (c) die AKTIONSKNÖPFE einer Bestätigungsblase, nicht ihr Auslöser ─────────────
    const zeile = page.locator('tr.ant-table-row');
    await expect(zeile, 'genau die eine geseedete Kraft').toHaveCount(1);

    const ausloeser = zeile.getByRole('button', { name: 'Entfernen', exact: true });
    // Der Auslöser hängt an `controlHeight`, die Blasenknöpfe an `controlHeightSM` — zwei Token.
    await haeltTreffflaeche(ausloeser, soll, 'Auslöser „Entfernen"');
    await ausloeser.click();

    /**
     * Die Blase scopen: Popconfirm rendert über Popover, die Ausblendklasse trägt das
     * POPOVER-Präfix. Ohne den Filter träfe man ein geschlossenes Portal eines früheren Klicks.
     */
    const blase = page.locator('.ant-popconfirm:not(.ant-popover-hidden)');
    await expect(blase, 'genau eine offene Bestätigungsblase').toHaveCount(1);

    // Per `getByRole(..., { name })`: `getByText` träfe auch `sr-only`/`aria-hidden`. „OK" und
    // „Abbrechen" liefert antds `de_DE`.
    for (const etikett of ['OK', 'Abbrechen']) {
      const knopf = blase.getByRole('button', { name: etikett, exact: true });
      const breite = await haeltTreffflaeche(knopf, soll, `Bestätigungsknopf „${etikett}"`);

      // Die URSACHE: der Breitenboden ist genau die Stufe. Ohne diese Zeile bestünde ein
      // langes Etikett den Test auch ohne jeden Boden.
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

    // Über „Abbrechen" schließen (OK löschte die geseedete Kraft); der Klick belegt nebenbei
    // die Bedienbarkeit.
    await blase.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(blase).toHaveCount(0);
  });
}

/**
 * Der Drawer-Zweig am Tablet HOCHKANT: Hamburger, Akkordeon-Köpfe, Modulzeilen im Drawer und
 * der Drawer-Schließer. Bis LFH-384 nahm diese Datei die Stellen im Handschuh-Durchgang aus —
 * Schließer und Kopf standen fest auf 48 und wären per Konstruktion rot gewesen.
 *
 * Die icon-only-Griffe (Hamburger, Schließer) auf BEIDEN Achsen: sie setzen Breite und Höhe
 * aus derselben Zahl, und ein Griff, der nur in der Höhe wächst, trifft man mit dem Handschuh
 * trotzdem nicht. Die Köpfe und Modulzeilen sind drawerbreit, dort zählt die Höhe.
 */
for (const { dichte, soll } of STAFFEL) {
  test(`Führungs-Tablet hochkant, Stufe ${dichte}: Hamburger, Akkordeon und Drawer-Schließer halten ${soll} px`, async ({
    page,
  }) => {
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `Trefflaeche Drawer ${dichte} ${Date.now()}`);

    await page.setViewportSize(TABLET_HOCHKANT);
    // `…/personal` klappt „Kräfte & Mittel" auf — die Modulzeilen stehen ohne Klick im Drawer.
    await page.goto(`/einsaetze/${einsatzId}/personal`);
    if (dichte === 'handschuh') {
      await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
        DICHTE_SCHLUESSEL,
        dichte,
      ] as const);
      await page.reload();
    }
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

    // Wache: hier gilt der Drawer-Zweig — sonst mäße der Test den inline-Rahmen ein zweites Mal.
    await expect(page.getByRole('navigation', { name: 'Kategorien' })).toHaveCount(0);

    const hamburger = page.getByRole('button', { name: 'Navigation öffnen' });
    const griffBreite = await haeltTreffflaeche(hamburger, soll, 'Hamburger');
    expect(
      griffBreite,
      `Hamburger (gemessen ${griffBreite}px breit, Soll ≥ ${soll})`,
    ).toBeGreaterThanOrEqual(soll - SUBPIXEL);

    await hamburger.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    const nav = drawer.getByRole('navigation', { name: 'Einsatz-Navigation' });
    await expect(nav).toBeVisible();

    // Kategorie-Köpfe tragen `aria-expanded`, Modulknöpfe nicht — das trennt beide ohne
    // Strukturselektor. Mindestmengen: sechs Kategorien, fünf Module in „Kräfte & Mittel".
    const koepfe = nav.locator('button[aria-expanded]');
    const module = nav.locator('button:not([aria-expanded])');
    expect(await koepfe.count(), 'mindestens sechs Akkordeon-Köpfe').toBeGreaterThanOrEqual(6);
    expect(await module.count(), 'mindestens fünf Modulzeilen').toBeGreaterThanOrEqual(5);
    for (const [menge, name] of [
      [koepfe, 'Akkordeon-Kopf'],
      [module, 'Drawer-Modulzeile'],
    ] as const) {
      const anzahl = await menge.count();
      for (let i = 0; i < anzahl; i += 1) {
        await haeltTreffflaeche(menge.nth(i), soll, `${name} #${i + 1}`);
      }
    }

    const schliesser = drawer.locator('.ant-drawer-close');
    const schliesserBreite = await haeltTreffflaeche(schliesser, soll, 'Drawer-Schließer');
    expect(
      schliesserBreite,
      `Drawer-Schließer (gemessen ${schliesserBreite}px breit, Soll ≥ ${soll})`,
    ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
    test.info().annotations.push({
      type: 'messwert',
      description: `${dichte}: Hamburger ${griffBreite}px, Schließer ${schliesserBreite}px breit`,
    });

    // Der Schließer bedient: der Klick schließt den Drawer.
    await schliesser.click();
    await expect(drawer).toBeHidden();
  });
}

/**
 * Der Kippschalter selbst: antd rechnet seine Höhe aus der Schrift statt aus `controlHeight`
 * (Ableitung `switchMasse` in `theme/tokens.ts`). Gemessen am Schalter der Anmeldeverfahren,
 * der ohne Seeding immer im Baum steht (gesperrt ändert an der Geometrie nichts).
 *
 * Zwei Achsen: Höhe gegen die Staffel, Breite gegen das Doppelte — eine Spur, die nur in der
 * Höhe wächst, kippte nicht mehr sichtbar. Kein `drawerIstNichtImBaum`: die Admin-Route hat
 * keine IconRail.
 */
for (const { dichte, soll } of STAFFEL) {
  test(`Führungs-Tablet, Stufe ${dichte}: der Kippschalter selbst hält ${soll} px`, async ({
    page,
  }) => {
    await anmelden(page);
    await page.setViewportSize(TABLET);
    await page.goto('/admin/einstellungen/anmeldung');
    if (dichte === 'handschuh') {
      // Gespeicherte Wahl schlägt die Zeigerart, wirksam erst nach dem Neuladen.
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
