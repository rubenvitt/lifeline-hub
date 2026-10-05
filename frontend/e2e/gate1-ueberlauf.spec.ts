import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, benutzerAnlegen, wechsleZu, wechsleZuRolle } from './rollen-kern';

// Beide Kopfzeilen teilen Auslöser, aber nicht ihren Layout-Rahmen. Die gespeicherte Wahl
// muss auch bei Touch gelten; Pixel prüft nur der Browser.
test.describe('LFH-460 Kopfzeilen und Bediendichte', () => {
  test.use({ hasTouch: true });

  test('kurzer Einsatzname hält den Handschuh-Boden', async ({ page }) => {
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, 'A');
    await page.addInitScript(() => localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
    for (const breite of [390, 1024]) {
      await page.setViewportSize({ width: breite, height: 900 });
      await page.goto(`/einsaetze/${einsatzId}/etb`);
      await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
      // Name = Einsatzname. Bis LFH-595 hängte antds DownOutlined sein `aria-label` („down“) an;
      // die Icons des Satzes sind `aria-hidden`.
      const wechsler = page.locator('header').getByRole('button', { name: 'A', exact: true });
      await expect(wechsler).toBeVisible();
      expect
        .soft((await wechsler.boundingBox())!.width, `${breite}px: kurzer Name`)
        .toBeGreaterThanOrEqual(72);
    }
  });

  for (const mitVerwaltung of [true, false]) {
    for (const stufe of ['kompakt', 'komfortabel', 'handschuh'] as const) {
      for (const breite of [390, 1024]) {
        test(`${breite}px ${stufe} ${mitVerwaltung ? 'Admin' : 'ohne Verwaltungsrecht'}: kein Querlauf und erreichbare Kopfziele`, async ({
          page,
        }) => {
          await anmelden(page);
          const einsatzId = await einsatzAnlegen(
            page,
            `LFH-460 Hochwasser Abschnitt Nordwest ${Date.now()}`,
          );
          await page.addInitScript(
            (dichte) => localStorage.setItem('lifeline-hub.dichte', dichte),
            stufe,
          );
          await page.setViewportSize({ width: breite, height: 900 });

          if (!mitVerwaltung) {
            // Ohne `org_rolle` 'keiner'/'keine', kein Einsatzmitglied: nur `/einsaetze`.
            // Langer Anzeigename als Überlaufstoff für das Benutzermenü.
            await wechsleZu(
              page,
              await benutzerAnlegen(page, 'beobachter', 'Maximiliane Kirchgassner-Wohlfahrt'),
            );
          }
          const routen = mitVerwaltung
            ? ['/einsaetze', `/einsaetze/${einsatzId}/etb`]
            : ['/einsaetze'];
          for (const route of routen) {
            await page.goto(route);
            await expect(page.locator('html')).toHaveAttribute('data-dichte', stufe);
            if (route !== '/einsaetze') {
              await expect(page.getByPlaceholder('Inhalt …')).toBeVisible();
            } else if (mitVerwaltung) {
              await expect(page.locator('[data-testid="einsaetze-raster"]')).toBeVisible();
            } else {
              // Der neue Benutzer hat keine Einsatzmitgliedschaft, das Raster bleibt leer.
              await expect(page.getByText('Keine Einsätze', { exact: true })).toBeVisible();
            }
            // Konkrete Inhaltsanker statt networkidle: die Einsatzroute hält SSE offen.
            const kopf = page.locator('header');
            await expect(kopf).toHaveCount(1);
            if (!mitVerwaltung) {
              await expect(kopf.getByRole('link', { name: 'Verwaltung' })).toHaveCount(0);
              await expect(kopf.getByText(/^Verwaltung/)).toBeVisible();
              await expect(kopf.getByText('Keine Berechtigung')).toHaveCount(
                breite === 1024 ? 1 : 0,
              );
            }
            const messung = await kopf.evaluate((el) => {
              const k = el.getBoundingClientRect();
              const ziele = Array.from(el.querySelectorAll('button, a[href]')).map((ziel) => {
                const r = ziel.getBoundingClientRect();
                return {
                  name: ziel.getAttribute('aria-label') ?? ziel.textContent,
                  x: r.x,
                  y: r.y,
                  rechts: r.right,
                  unten: r.bottom,
                  breite: r.width,
                  hoehe: r.height,
                };
              });
              return {
                dokument: document.documentElement.scrollWidth,
                viewport: window.innerWidth,
                kopfUnten: k.bottom,
                kopfOben: k.top,
                kopfBreite: el.clientWidth,
                kopfInhalt: el.scrollWidth,
                kopfHoehe: el.clientHeight,
                kopfInhaltHoehe: el.scrollHeight,
                ziele,
              };
            });
            const kontext = `${route} ${breite}px ${stufe}`;
            console.log(kontext, JSON.stringify(messung));
            expect.soft(messung.dokument, kontext).toBeLessThanOrEqual(messung.viewport);
            expect.soft(messung.kopfInhalt, kontext).toBeLessThanOrEqual(messung.kopfBreite);
            expect.soft(messung.kopfInhaltHoehe, kontext).toBeLessThanOrEqual(messung.kopfHoehe);
            expect(
              messung.ziele.length,
              `${kontext}: tatsächlich Bedienziele messen`,
            ).toBeGreaterThanOrEqual(mitVerwaltung ? (route === '/einsaetze' ? 4 : 5) : 3);
            for (const ziel of messung.ziele) {
              const name = `${kontext}: ${ziel.name}`;
              expect.soft(ziel.x, name).toBeGreaterThanOrEqual(0);
              expect.soft(ziel.rechts, name).toBeLessThanOrEqual(breite);
              expect.soft(ziel.y, name).toBeGreaterThanOrEqual(messung.kopfOben);
              expect.soft(ziel.unten, name).toBeLessThanOrEqual(messung.kopfUnten);
              const boden = stufe === 'handschuh' ? 72 : stufe === 'komfortabel' ? 48 : 24;
              expect.soft(ziel.hoehe, name).toBeGreaterThanOrEqual(boden);
              expect.soft(ziel.breite, name).toBeGreaterThanOrEqual(boden);
              for (const nachbar of messung.ziele) {
                if (nachbar === ziel) continue;
                const ueberlappt =
                  Math.min(ziel.rechts, nachbar.rechts) > Math.max(ziel.x, nachbar.x) &&
                  Math.min(ziel.unten, nachbar.unten) > Math.max(ziel.y, nachbar.y);
                expect.soft(ueberlappt, `${name}: überdeckt ${nachbar.name}`).toBe(false);
              }
            }
            expect(messung.kopfHoehe, `${kontext}: höchstens zwei Zeilen`).toBeLessThanOrEqual(
              stufe === 'handschuh' ? 288 : stufe === 'komfortabel' ? 192 : 120,
            );
            /*
             * Einzeilig auf dem Führungs-Tablet: bei 1024 px stehen Ruhezustände nur als Icon.
             * Geprüft nur in `kompakt`, dem einzigen deterministischen Fall: headless meldet der
             * Browser „Benachrichtigung blockiert" und der Strom oft „VERBINDE" — Störungen, die ihr
             * Wort behalten und den Kopf in größeren Stufen umbrechen dürfen. Den Ruhezustand
             * in `handschuh` belegt `kopfzeile-schmal.spec.ts`.
             */
            if (breite === 1024 && stufe === 'kompakt') {
              expect(messung.kopfHoehe, `${kontext}: einzeilig (52 px)`).toBeLessThanOrEqual(52);
              const oberste = Math.max(...messung.ziele.map((z) => z.y));
              const unterste = Math.min(...messung.ziele.map((z) => z.unten));
              expect(oberste, `${kontext}: alle Kopfziele in EINER Zeile`).toBeLessThan(unterste);
            }
            if (stufe === 'handschuh') {
              await test.info().attach(`${route} Kopfzeile`, {
                body: await page.screenshot(),
                contentType: 'image/png',
              });
            }
            const inhalt = await page.locator('.ant-layout-content').first().boundingBox();
            expect(
              inhalt!.y,
              `${kontext}: Kopf verdeckt keinen Seiteninhalt`,
            ).toBeGreaterThanOrEqual(messung.kopfUnten);
            await kopf.getByRole('button', { name: 'Suchen', exact: true }).click();
            await expect(page.getByRole('combobox', { name: /Suchen: Module/ })).toBeFocused();
            await page.keyboard.press('Escape');
            await kopf.getByRole('button', { name: 'Benutzermenü' }).click();
            await expect(page.getByRole('menuitem', { name: /Profil/ })).toBeVisible();
            await page.keyboard.press('Escape');
          }
        });
      }
    }
  }
});

/**
 * Gate 1 der Bedien-Leitlinie: kein waagerechter Überlauf auf den Arbeitsbreiten, gemessen
 * über die ganze Seite (die Einzel-Specs sehen nur ihren Ausschnitt).
 *
 * DIE 1-PX-TOLERANZ ist kein Aufweichen: Chromium rundet `scrollWidth` auf ganze Pixel,
 * Layoutbreiten dürfen gebrochen sein.
 *
 * BEI EINEM BRUCH nennt die Diagnose das schuldige Element mit Tag, Klassen und Breite.
 *
 * SEEDING, WEIL EINE LEERE LISTE NICHT ÜBERLAUFEN KANN: `seedeUeberlaufstoff` sät je Modul
 * einen Datensatz mit ABSICHTLICH LANGEN Werten per `page.request` (teilt den Cookie-Jar des
 * Kontexts), und der Anker jeder Zeile ist der gesäte Datensatz, nicht der Seitenrahmen.
 *
 * DER EINSATZNAME `E2E Gate1 <ts>` trägt bewusst keinen Modulnamen: die Kommandopalette
 * durchsucht Module und Einsätze gemeinsam, sonst flakte `command-palette.spec.ts`.
 *
 * Bei 390 px wird nicht durchgehend eine Tabelle gemessen: `Datensicht` mit `form="auto"`
 * rendert unter `md` Karten. Die Anker sind deshalb form-agnostisch (gesäter Text, kein
 * `tr.ant-table-row`).
 */

/**
 * Führungswagen · Führungs-Tablet quer · Führungs-Tablet hoch · mobil (A1, Gate 1).
 *
 * 768 px ist genau antds `md`-Grenze: dort wechselt `Datensicht` (`form="auto"`) auf Tabelle,
 * und die Tabelle hat die wenigsten Pixel, die sie je bekommt.
 */
const PRUEFBREITEN = [
  { name: 'Fükw', breite: 1366, hoehe: 768 },
  { name: 'Führungs-Tablet', breite: 1024, hoehe: 768 },
  { name: 'Führungs-Tablet hoch', breite: 768, hoehe: 1024 },
  { name: 'mobil', breite: 390, hoehe: 844 },
] as const;

async function anmelden(page: Page) {
  await anmeldenAlsAdmin(page);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

/**
 * Namentliche Freistellungen bekannter Bestands-Verstöße — derzeit LEER. Die Mechanik
 * bleibt als Weg, einen künftigen Befund zu benennen statt zu dulden (ein rot geborenes Gate
 * wird abgeschaltet statt befolgt):
 *  - Ein Verstoß auf einer NICHT gelisteten Route × Breite ist rot.
 *  - Wächst ein gelisteter Verstoß über seinen `deckel`, ist er rot.
 *  - Ist ein gelisteter Eintrag behoben (≤ 1 px) oder wird er nicht mehr gemessen, meldet
 *    das Gate ihn als TOT und erzwingt seine Streichung.
 * Wer einen Eintrag braucht, misst ihn und schreibt den Verursacher dazu — und legt ein Ticket an.
 */
type Freistellung = {
  /** Modulroute wie in {@link ROUTEN}. */
  modul: string;
  /**
   * Rolle des Durchgangs (LFH-435): eine Freistellung für den Beobachter lässt den
   * Admin-Durchgang derselben Route × Breite unberührt — und umgekehrt.
   */
  rolle: Gate1Rolle;
  /** Sichtbreite in px, auf der der Verstoß auftritt. */
  breite: number;
  /** Obergrenze: darüber ist der Eintrag rot statt freigestellt. */
  deckel: number;
  /** Der Messwert bei Aufnahme — als Beleg, nicht als Schwelle. */
  gemessen: number;
};

// Expliziter Typ: `[] as const` hätte den Elementtyp `never`, und der Zugriff auf
// `modul`/`breite`/`deckel` unten fiele um.
const BESTAND_OFFEN: readonly Freistellung[] = [];

/**
 * Ein Datensatz je Modul, mit absichtlich langen Werten. Die Ad-hoc-Kraft erscheint auf der
 * Personalseite und im Meldebild (Sammelzeile „Ohne Einheit"). Jede Antwort wird
 * zugesichert: ein still fehlgeschlagenes Seeding führt zurück in den Leerzustand.
 */
/** Lange Bezeichnung einer externen Stelle im Kommunikationsplan (LFH-848). */
const KOMMUNIKATION_STELLE = 'Polizeiinspektion Musterstadt-Nordwest, Führungsgruppe';

async function seedeUeberlaufstoff(page: Page, einsatzId: string) {
  const anlegen = async (pfad: string, data: unknown, was: string) => {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
  };

  await anlegen(
    'personal',
    {
      adhoc: {
        name: 'Kirchgassner-Wohlfahrt, Maximiliane',
        funktion: 'Abschnittsleitung Technische Hilfeleistung',
        traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest',
      },
    },
    'Personal (Personalseite + Meldebild)',
  );
  await anlegen(
    'befehle',
    { vorlage: 'befehl_lad', titel: 'Befehl an den 2. Zug zur Menschenrettung im Abschnitt Nord' },
    'Befehl',
  );
  // Ohne Status setzt das Backend `erfasst`, genau der Standardreiter der Personenseite;
  // mit anderem Status fiele die Person aus der Standardsicht.
  await anlegen(
    'personen',
    {
      name: 'Oberacher-Dreiszigmark',
      vorname: 'Wolfgang-Sebastian',
      antreff_ort: 'Bahnübergang Nordwestring, Höhe Kilometer 4,7',
      notiz: 'Über die Drehleiter aus dem zweiten Obergeschoss gerettet',
    },
    'Person',
  );
  // Presse und Medienarbeit S5 (LFH-554): lange Medien-, Themen- und Notiztexte als Stoff für
  // die Karten des Presse-Logs und die Zeitachse des Informationstelefons.
  await anlegen(
    'stab/medienkontakte',
    {
      art: 'anfrage',
      medium: PRESSE_MEDIUM,
      thema: PRESSE_THEMA,
      kontakt_name: 'Redaktion Landespolitik, Maximiliane Kirchgassner-Wohlfahrt',
      kontakt_erreichbarkeit: 'landespolitik.redaktion@rundfunkanstalt-musterstadt.example',
    },
    'Medienkontakt',
  );
  await anlegen(
    'stab/infotelefon',
    {
      anliegen: 'vermisstensuche',
      notiz: ANRUF_NOTIZ,
      anrufer_name: 'Oberacher-Dreiszigmark, Wolfgang-Sebastian',
      rueckruf: '+49 5141 123456789',
      rueckruf_noetig: true,
    },
    'Anruf',
  );
  {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/stab/pressemitteilungen`, {
      data: {
        vorlage: 'erstinformation',
        titel: PM_TITEL,
        abschnitte: [{ schluessel: 'sachverhalt', text: ETB_STOFF }],
      },
    });
    expect(antwort.ok(), `Seeding Pressemitteilung: ${antwort.status()}`).toBeTruthy();
    PRESSEMITTEILUNG.set(einsatzId, ((await antwort.json()) as { id: number }).id);
  }
  // Der Status-Default `aktiv` deckt sich mit dem Standardreiter der Tierseite.
  await anlegen(
    'tiere',
    {
      spezies: 'grosstier',
      rufname: 'Donnerhall-vom-Wiesengrund',
      rasse_beschreibung: 'Süddeutsches Kaltblut, Stockmaß 163 cm',
      antreff_ort: 'Weidekoppel südlich der Bundesstraße',
    },
    'Tier',
  );
  // Kommunikationsplan S6 (LFH-848): eine Behörde mit langer Bezeichnung, langer Nummer und
  // langem Hinweis. Die Antwort ist der ganze Plan; die id der Stelle steht darin.
  const plan = await page.request.post(
    `/api/einsaetze/${einsatzId}/stab/kommunikationsplan/stellen`,
    { data: { stellenart: 'behoerde', bezeichnung: KOMMUNIKATION_STELLE } },
  );
  expect(plan.ok(), `Seeding Kommunikationsplan: ${await plan.text()}`).toBeTruthy();
  const stelle = ((await plan.json()) as { id: number; bezeichnung?: string }[]).find(
    (s) => s.bezeichnung === KOMMUNIKATION_STELLE,
  )!;
  await anlegen(
    `stab/kommunikationsplan/stellen/${stelle.id}/verbindungen`,
    {
      mittel: 'festnetz',
      wert: '+49 421 361-1234567',
      hinweis: 'Lagedienst rund um die Uhr, außerhalb Bürozeit über Zentrale',
    },
    'Verbindung',
  );
}

/**
 * Misst das Wurzelelement und benennt bei Überschreitung die Verursacher.
 *
 * GRENZE: jedes `overflow-x: hidden` an einem Vorfahren nimmt überlaufende Kinder aus der
 * Wurzelmetrik — der Inhalt ist abgeschnitten, das Gate trotzdem grün. Wer eine Rotmeldung
 * mit `overflow-x: hidden` „behebt", hat sie versteckt.
 *
 * Elemente in einem eigenen Bildlaufbereich sind KEIN Verstoß (dafür trägt die
 * Katalogtabelle ihren Bildlauf). `hidden` wird von `auto`/`scroll` getrennt ausgewiesen:
 * nur Letztere geben den Inhalt zurück, ein `[GEKLIPPT]` ist ein Fund, kein Freispruch.
 */
async function ueberlauf(page: Page): Promise<{ ueber: number; schuldige: string[] }> {
  return page.evaluate(() => {
    const wurzel = document.documentElement;
    const ueber = wurzel.scrollWidth - wurzel.clientWidth;
    if (ueber <= 1) return { ueber, schuldige: [] };

    const grenze = wurzel.clientWidth;
    const schuldige: string[] = [];
    const bildlaufArt = (el: Element) => {
      const ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll') return ' [eigener Bildlauf]';
      // Klippen ist kein Bildlauf: der Inhalt ist weg, nicht erreichbar.
      if (ox === 'hidden') return ' [GEKLIPPT — Inhalt ohne Bildlauf unerreichbar]';
      return '';
    };

    // FLACH über alle Elemente statt Baumabstieg: ein absolut positioniertes oder aus einem
    // Bildlaufbereich ragendes Element hat brave Vorfahren, ein Abstieg fände es nie.
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const rechteck = el.getBoundingClientRect();
      if (rechteck.right <= grenze + 1) continue;
      if (rechteck.width === 0 || rechteck.height === 0) continue;
      const klassen = el.className?.toString().slice(0, 50) ?? '';
      const stil = getComputedStyle(el);
      schuldige.push(
        `${el.tagName.toLowerCase()}.${klassen} → rechts ${Math.round(rechteck.right)}px, ` +
          `breit ${Math.round(rechteck.width)}px, position ${stil.position}, overflow-x ${stil.overflowX}` +
          bildlaufArt(el),
      );
      if (schuldige.length >= 12) break;
    }
    return { ueber, schuldige };
  });
}

/** Meldet an, legt den Einsatz an und sät den Überlaufstoff aller Routen — je Prüfbreite. */
async function gate1Vorbereiten(page: Page): Promise<string> {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate1 ${Date.now()}`);
  await seedeUeberlaufstoff(page, einsatzId);
  // Eine Schicht mit absichtlich langem Einheits- und Abschnittsnamen.
  {
    const post = async (pfad: string, data: unknown, was: string) => {
      const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
      expect(
        antwort.ok(),
        `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`,
      ).toBeTruthy();
      return (await antwort.json()) as { id: number };
    };
    const abschnitt = await post(
      'abschnitte',
      { name: 'Deichverteidigung Nordwestring zwischen Kilometer 4,7 und 6,2' },
      'Abschnitt (Ablösung)',
    );
    const einheit = await post(
      'einheiten',
      {
        name: 'Fachgruppe Wasserschaden/Pumpen Ortsverband Musterstadt-Nordwest',
        abschnitt_id: abschnitt.id,
      },
      'Einheit (Ablösung)',
    );
    await post('abloesungen', { einheit_id: einheit.id, rhythmus_minuten: 390 }, 'Schicht');

    // Ein Bezirk mit allen drei Sekundärfeldern der Karte und eine Stelle, deren Belegung
    // „fast voll" neben die Zahl setzt — die breiteste Tabellenzelle. Namen ohne „Betreuung".
    const bezirk = await post(
      'betreuung/bezirke',
      {
        bezeichnung: 'Uferstraße 12–40 und Deichweg 1–9 zwischen Schleuse und Pumpwerk Nordwest',
        plan_personen: 1210,
        plan_erhebung: 'geschaetzt',
        abschnitt_id: abschnitt.id,
      },
      'Bezirk',
    );
    await post(
      `betreuung/bezirke/${bezirk.id}/staende`,
      { evakuiert: 1180, erhebung: 'geschaetzt' },
      'Stand',
    );
    const antwort = await page.request.patch(
      `/api/einsaetze/${einsatzId}/betreuung/bezirke/${bezirk.id}`,
      { data: { raeumung: 'laeuft' } },
    );
    expect(antwort.ok(), `Seeding Räumung: ${antwort.status()}`).toBeTruthy();
    const stelle = await post(
      'betreuung/stellen',
      {
        bezeichnung: 'Notunterkunft Mehrzweckhalle Gesamtschule Musterstadt-Nordwest',
        art: 'notunterkunft',
        kapazitaet_personen: 1500,
        abschnitt_id: abschnitt.id,
      },
      'Stelle',
    );
    await post(`betreuung/stellen/${stelle.id}/belegungen`, { belegt: 1420 }, 'Belegung');

    // Ein LAUFENDES Zeitfenster (sonst stünde die Karte unter „vergangen") mit Sonderkost und
    // einer Ausgabe mit langem Ort — die breiteste Zeile der Karte.
    const jetzt = Date.now();
    const zeitfenster = await post(
      'verpflegung/zeitfenster',
      {
        bezeichnung: 'Mittagessen Deichverteidigung Nordwestring Kilometer 4,7 bis 6,2',
        von_at: new Date(jetzt - 3_600_000).toISOString(),
        bis_at: new Date(jetzt + 3 * 3_600_000).toISOString(),
        bedarf_kraefte: 180,
        bedarf_betreute: 240,
        bedarf_weitere: 35,
        sonderkost: { vegetarisch: 40, vegan: 12, diaet_allergenarm: 6, saeugling_kleinkind: 4 },
      },
      'Zeitfenster',
    );
    await post(
      `verpflegung/zeitfenster/${zeitfenster.id}/ausgaben`,
      {
        menge: 120,
        ort: 'Ausgabestelle Mehrzweckhalle Gesamtschule Musterstadt-Nordwest, Eingang Deichweg',
        sonderkost: { vegetarisch: 20, vegan: 4 },
        bemerkung: 'Anlieferung durch Feldküche Ortsverband Musterstadt-Nordwest, Rest folgt',
      },
      'Ausgabe',
    );
  }
  // Ein ETB-Eintrag mit langem Inhalt: der Lese-Anker des Beobachters, der keine
  // Erfassungsleiste hat — und für den Admin zusätzlicher Überlaufstoff.
  {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
      data: {
        typ: 'meldung',
        inhalt: ETB_STOFF,
        von: 'Abschnittsleitung Deichverteidigung Nordwestring',
        an: 'Einsatzleitung Technische Einsatzleitung Musterstadt',
      },
    });
    expect(antwort.ok(), `Seeding ETB: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  }
  // Wetter per Stub, sonst ginge das Backend an Bright Sky. Langer Gemeindename als Stoff.
  await page.route(`**/api/einsaetze/${einsatzId}/wetter`, (route) =>
    route.fulfill({
      json: {
        ort: { name: 'Samtgemeinde Sottrum-Hellwege-Horstedt-Reeßum', kreis: 'Rotenburg (Wümme)' },
        warnungen: {
          zustand: 'ok',
          abgerufen_at: new Date().toISOString(),
          daten: [
            {
              stufe: 'schwer',
              ereignis: 'ORKANARTIGE BÖEN',
              ueberschrift: 'Amtliche UNWETTERWARNUNG vor ORKANARTIGEN BÖEN im Kreisgebiet',
              beginn: new Date(Date.now() - 3_600_000).toISOString(),
              ende: new Date(Date.now() + 3_600_000).toISOString(),
            },
          ],
        },
        vorhersage: { zustand: 'ausfall' },
      },
    }),
  );
  return einsatzId;
}

type Gate1Rolle = 'admin' | 'beobachter' | 'fuehrungskraft';

const ETB_STOFF =
  'Pegel Musterstadt-Nordwest steigt weiter, Deichverteidigung zwischen Kilometer 4,7 und 6,2 ' +
  'verstärken, Sandsackbefüllung am Bauhof Nordwestring anlaufen lassen';

const PRESSE_MEDIUM = 'Norddeutscher Rundfunk Landesfunkhaus Niedersachsen Hörfunkredaktion';
const PRESSE_THEMA = 'Zahl der Evakuierten im Abschnitt Deichverteidigung Nordwestring';
const ANRUF_NOTIZ =
  'Sucht den Vater, zuletzt gesehen am Bahnübergang Nordwestring Höhe Kilometer 4,7, Rückruf erbeten';
const PM_TITEL = 'Hochwasser Musterstadt-Nordwest: Evakuierung Deichverteidigung Nordwestring';
/** Kennung der gesäten Pressemitteilung je Einsatz (die Detailroute braucht sie). */
const PRESSEMITTEILUNG = new Map<string, number>();

type Gate1Route = {
  pfad: string;
  anker: (p: Page) => Locator;
  /** Läuft nach `goto` und VOR der Ankerprüfung, je Breite erneut. */
  vorbereiten?: (p: Page) => Promise<void>;
  /**
   * Nur-Lese-Zweig (LFH-435): Anker und Vorbedingung des Beobachters, wo sie vom Admin
   * abweichen. Die VORBEDINGUNG belegt, dass der Rollenzweig steht — ohne sie mäße der
   * Durchgang still den Admin-Zustand oder weniger Ziele.
   */
  lesend?: { anker?: (p: Page) => Locator; vorbedingung?: (p: Page) => Promise<void> };
  /** Für Nicht-Admins leitet die Route um — zugesichert statt gemessen. */
  umleitungOhneAdmin?: boolean;
};

/** Der Rechtehinweis des Nur-Lese-Zweigs (`RechteHinweis`, antd `Alert`). */
function rechteHinweis(p: Page, text: RegExp) {
  return expect(
    p.getByRole('alert').filter({ hasText: text }),
    'Vorbedingung: der Rechtehinweis des Nur-Lese-Zweigs steht',
  ).toBeVisible();
}

const NUR_SCHREIBENDE = /^Nur Einsatzleitung und Führungspersonal/;

function gate1Routen(einsatzId: string): Gate1Route[] {
  // Eine Route je Layoutfamilie (Ebene-1-Shell, Lagebild, Einsatz-Workspace, Admin-Layout)
  // plus die Datensicht- und Fachmodule.
  //
  // JE ROUTE EIN INHALTSANKER, den NUR diese Seite hat — `.ant-layout-content` steht auf
  // jeder Route, und ein Redirect auf eine leere Seite mäße sich überlauffrei. Die Anker
  // müssen auf allen Breiten stehen, also nie ein `tr.ant-table-row` auf Datensicht-Routen
  // (unter `md` Karten). „Neuer Einsatz" liegt auf 390 px hinter dem Kopfgriff.
  return [
    {
      pfad: '/einsaetze',
      anker: (p: Page) => p.locator('[data-testid="einsaetze-raster"]'),
      lesend: {
        vorbedingung: async (p: Page) => {
          await expect(
            p.getByRole('link', { name: 'Verwaltung' }),
            'Vorbedingung: kein freier Verwaltungs-Link',
          ).toHaveCount(0);
          await expect(
            p.getByRole('button', { name: 'Neuer Einsatz' }),
            'Vorbedingung: ohne Recht kein „Neuer Einsatz"',
          ).toHaveCount(0);
        },
      },
    },
    {
      // Die Startseite des Einsatzes (`redirectZiel()`); der Beobachter sieht dort den Hinweis.
      pfad: `/einsaetze/${einsatzId}/ueberblick`,
      anker: (p: Page) => p.getByRole('heading', { name: 'Überblick', level: 1 }),
      lesend: { vorbedingung: (p: Page) => rechteHinweis(p, NUR_SCHREIBENDE) },
    },
    {
      pfad: `/einsaetze/${einsatzId}/lage-dashboard`,
      anker: (p: Page) =>
        p.getByRole('group', { name: 'Lage in Zahlen' }).locator('[data-lfh="kennzahl"]').first(),
    },
    {
      pfad: `/einsaetze/${einsatzId}/etb`,
      anker: (p: Page) => p.getByPlaceholder('Inhalt …'),
      lesend: {
        anker: (p: Page) => p.getByText(ETB_STOFF),
        vorbedingung: (p: Page) =>
          expect(
            p.getByPlaceholder('Inhalt …'),
            'Vorbedingung: ohne Schreibrecht keine Erfassungsleiste',
          ).toHaveCount(0),
      },
    },
    {
      pfad: '/admin/benutzer',
      anker: (p: Page) => p.locator('tr.ant-table-row').first(),
      umleitungOhneAdmin: true,
    },
    {
      // Anker ist der Seitentitel, nicht eine Tabellenzeile: die Fahrzeugliste kann leer sein.
      pfad: '/admin/stammdaten/fahrzeuge',
      anker: (p: Page) => p.getByRole('heading', { name: 'Fahrzeuge', level: 1 }),
      umleitungOhneAdmin: true,
    },
    {
      pfad: `/einsaetze/${einsatzId}/personal`,
      anker: (p: Page) => p.getByText('Kirchgassner-Wohlfahrt, Maximiliane'),
    },
    {
      // Datenanker statt Kennzahlenkopf (der steht auch über leerer Tabelle): die
      // Sammelzeile „Ohne Einheit" gibt es nur, wenn eine Kraft disponiert ist.
      pfad: `/einsaetze/${einsatzId}/kraefteuebersicht`,
      anker: (p: Page) => p.getByText('Ohne Einheit', { exact: true }),
    },
    {
      // Stab mit der Vorbereitung der Lagebesprechung (LFH-550). Anker ist die Sichtungszeile,
      // sobald ihre Quelle feststeht — ihr Wert ist die längste Zeile und muss auf 390 px
      // umbrechen.
      pfad: `/einsaetze/${einsatzId}/stab`,
      anker: (p: Page) =>
        p.locator(
          '[data-lfh="vorbereitung-zeile"][data-schluessel="sichtung"]:not([data-zustand="laden"])',
        ),
      lesend: {
        anker: (p: Page) =>
          p.locator(
            '[data-lfh="vorbereitung-zeile"][data-schluessel="sichtung"]:not([data-zustand="laden"])',
          ),
        vorbedingung: (p: Page) =>
          expect(
            p.getByRole('button', { name: 'In Lagebericht übernehmen' }),
            'Vorbedingung: ohne Schreibrecht keine Übernahme',
          ).toHaveCount(0),
      },
    },
    {
      // Funkplan S6 (LFH-548). Datenanker ist die gesäte Einheit mit langem Namen IN der Tabelle
      // (sie steht auch in den Lücken, deshalb auf die Sicht verengt); der Baum startet offen.
      pfad: `/einsaetze/${einsatzId}/stab/funkplan`,
      anker: (p: Page) =>
        p.getByRole('region', { name: 'Funkplan' }).getByRole('link', {
          name: 'Fachgruppe Wasserschaden/Pumpen Ortsverband Musterstadt-Nordwest',
        }),
      lesend: {
        anker: (p: Page) =>
          p.getByRole('region', { name: 'Funkplan' }).getByRole('link', {
            name: 'Fachgruppe Wasserschaden/Pumpen Ortsverband Musterstadt-Nordwest',
          }),
        vorbedingung: (p: Page) =>
          expect(
            p.getByRole('button', { name: 'In Lagebericht übernehmen' }),
            'Vorbedingung: ohne Schreibrecht keine Übernahme',
          ).toHaveCount(0),
      },
    },
    {
      // Kommunikationsplan S6 (LFH-848). Datenanker ist die gesäte Behörde IN der Tabelle.
      pfad: `/einsaetze/${einsatzId}/stab/kommunikationsplan`,
      anker: (p: Page) =>
        p.getByRole('region', { name: 'Kommunikationsplan' }).getByText(KOMMUNIKATION_STELLE),
      lesend: {
        vorbedingung: (p: Page) =>
          expect(
            p.getByRole('button', { name: 'Stelle hinzufügen' }),
            'Vorbedingung: ohne Schreibrecht kein „Stelle hinzufügen“',
          ).toHaveCount(0),
      },
    },
    {
      // Fernmeldeskizze (LFH-893): Darstellung „Skizze“ des Funkplans, über die Sichtvorgabe
      // geöffnet — gemessen im breitesten Zustand: Palette auf (wo es sie gibt: Stab-Schreibrecht,
      // nicht mobil; ab `xxl` ohnehin offen) und die gesäte Einheit mit langem Namen gewählt,
      // also Werkzeugleiste, Palette, Fläche und Eigenschaftspaneel nebeneinander bzw. darunter.
      // Datenanker ist der Titel des Paneels mit ihrem Namen.
      pfad: `/einsaetze/${einsatzId}/stab/funkplan?ansicht=skizze`,
      vorbereiten: async (p: Page) => {
        const einheit = p
          .getByRole('group', { name: 'Fernmeldeskizze', exact: true })
          .getByRole('button', { name: /^Einheit Fachgruppe Wasserschaden\/Pumpen / });
        await expect(einheit).toBeVisible();
        const palette = p.locator('[data-lfh="skizze-palette-knopf"]');
        if ((await palette.count()) > 0 && (await palette.getAttribute('aria-expanded')) !== 'true')
          await palette.click();
        await einheit.click();
      },
      anker: (p: Page) =>
        p.locator('[data-lfh="skizze-paneel-titel"]').filter({
          hasText: 'Fachgruppe Wasserschaden/Pumpen Ortsverband Musterstadt-Nordwest',
        }),
      lesend: {
        vorbedingung: async (p: Page) => {
          await expect(
            p.locator('[data-lfh="skizze-rechte-grund"]'),
            'Vorbedingung: ohne Schreibrecht nennt das Paneel den Grund',
          ).toContainText('Kein Schreibrecht im Einsatz');
          await expect(
            p.locator('[data-lfh="skizze-palette-knopf"]'),
            'Vorbedingung: ohne Schreibrecht keine Palette',
          ).toHaveCount(0);
        },
      },
    },
    {
      // Organigramm der Führungsorganisation (LFH-626): Ansicht der Seite Einsatzabschnitte, über
      // die Sichtvorgabe geöffnet. Datenanker ist die gesäte Einheit mit langem Namen IM
      // Organigramm (die Gliederung zeigt sie nicht).
      pfad: `/einsaetze/${einsatzId}/einsatzabschnitte?ansicht=organigramm`,
      anker: (p: Page) =>
        p.getByRole('region', { name: 'Organigramm' }).getByRole('link', {
          name: 'Fachgruppe Wasserschaden/Pumpen Ortsverband Musterstadt-Nordwest',
        }),
      lesend: {
        vorbedingung: (p: Page) =>
          expect(
            p.getByRole('button', { name: 'In Lagebericht übernehmen' }),
            'Vorbedingung: ohne Schreibrecht keine Übernahme',
          ).toHaveCount(0),
      },
    },
    {
      // Pressearbeit S5 (LFH-554): die Karte des gesäten Medienkontakts im Presse-Log.
      pfad: `/einsaetze/${einsatzId}/stab/presse`,
      anker: (p: Page) => p.getByText(`${PRESSE_MEDIUM} · ${PRESSE_THEMA}`),
      lesend: { vorbedingung: (p: Page) => rechteHinweis(p, NUR_SCHREIBENDE) },
    },
    {
      // Detailseite der Pressemitteilung: Entwurf mit Editor bzw. Lesetext ohne Schreibrecht.
      pfad: `/einsaetze/${einsatzId}/stab/presse/mitteilungen/${PRESSEMITTEILUNG.get(einsatzId)}`,
      anker: (p: Page) => p.getByRole('heading', { level: 1, name: PM_TITEL }),
      lesend: {
        vorbedingung: (p: Page) =>
          expect(
            p.getByRole('button', { name: 'Entwurf speichern' }),
            'Vorbedingung: ohne Schreibrecht kein Editor',
          ).toHaveCount(0),
      },
    },
    {
      // Informationstelefon S5 (LFH-554): der gesäte Anruf in der Zeitachse.
      pfad: `/einsaetze/${einsatzId}/stab/infotelefon`,
      anker: (p: Page) => p.getByText(ANRUF_NOTIZ),
      lesend: {
        vorbedingung: async (p: Page) => {
          await rechteHinweis(p, NUR_SCHREIBENDE);
          await expect(
            p.getByRole('button', { name: 'Erfassen' }),
            'Vorbedingung: ohne Schreibrecht keine Erfassungsleiste',
          ).toHaveCount(0);
        },
      },
    },
    {
      // Stab mit der Arbeitsaufnahme (LFH-551): die sieben Zeilen tragen die längsten Texte der
      // Seite (Punkt + Quelle + Bemerkung). Datenanker ist die letzte Zeile — sie steht erst,
      // wenn die Checkliste geladen ist.
      pfad: `/einsaetze/${einsatzId}/stab`,
      anker: (p: Page) =>
        p
          .getByRole('region', { name: 'Arbeitsaufnahme' })
          .getByRole('checkbox', { name: 'Einsatzbereitschaft an die Leitstelle gemeldet' }),
      lesend: {
        vorbedingung: (p: Page) =>
          expect(
            p
              .getByRole('region', { name: 'Arbeitsaufnahme' })
              .getByRole('checkbox', { name: 'Einsatzbereitschaft an die Leitstelle gemeldet' }),
            'Vorbedingung: ohne Schreibrecht ist der Haken gesperrt',
          ).toBeDisabled(),
      },
    },
    {
      pfad: `/einsaetze/${einsatzId}/auftraege`,
      // Ohne `forceRender` ist die Befehlsliste nach `goto` nicht im Baum (Standardreiter
      // „Aufträge"); der Reiterwechsel läuft deshalb je Breite erneut.
      vorbereiten: async (p: Page) => {
        const reiter = p.getByRole('tab', { name: 'Befehle' });
        // antd klappt Reiter bei Enge in ein Mehr-Menü; ohne Zählung wäre der Klick ein
        // irreführender Timeout.
        await expect(reiter).toHaveCount(1);
        await reiter.click();
      },
      anker: (p: Page) => p.getByRole('link', { name: /Befehl an den 2\. Zug/ }),
    },
    {
      pfad: `/einsaetze/${einsatzId}/personen`,
      anker: (p: Page) => p.getByText('Oberacher-Dreiszigmark'),
    },
    {
      pfad: `/einsaetze/${einsatzId}/tiere`,
      anker: (p: Page) => p.getByText('Donnerhall-vom-Wiesengrund'),
    },
    {
      // Datenanker ist die gestubte Warnung, nicht der Seitenkopf.
      pfad: `/einsaetze/${einsatzId}/wetter-pegel`,
      anker: (p: Page) => p.getByText('Orkanartige Böen'),
    },
    {
      // Datenanker ist die Karte der gesäten Schicht, nicht der Seitenkopf.
      pfad: `/einsaetze/${einsatzId}/abloesung`,
      anker: (p: Page) =>
        p.getByRole('article', {
          name: 'Schicht Fachgruppe Wasserschaden/Pumpen Ortsverband Musterstadt-Nordwest',
        }),
      lesend: { vorbedingung: (p: Page) => rechteHinweis(p, NUR_SCHREIBENDE) },
    },
    {
      // Datenanker ist die Bezirkskarte (in jeder Breite Karte); die Stellen-Tabelle trägt auf
      // 390 px ihren eigenen Bildlauf, der kein Verstoß ist.
      pfad: `/einsaetze/${einsatzId}/betreuung`,
      anker: (p: Page) =>
        p
          .getByRole('region', { name: 'Evakuierungsbezirke' })
          .getByText('Uferstraße 12–40 und Deichweg 1–9 zwischen Schleuse und Pumpwerk Nordwest'),
      lesend: { vorbedingung: (p: Page) => rechteHinweis(p, NUR_SCHREIBENDE) },
    },
    {
      // Dieselbe Seite mit AUFGEKLAPPTEM Verlauf an Karte und Zeile. Der Anker steht erst,
      // wenn beide Bereiche offen und geladen sind.
      pfad: `/einsaetze/${einsatzId}/betreuung`,
      vorbereiten: async (p: Page) => {
        await p.getByRole('button', { name: /^Verlauf zu Bezirk / }).click();
        await p.getByRole('button', { name: /^Verlauf zu Stelle / }).click();
      },
      // Auf den Verlaufseintrag eingegrenzt: dieselbe Zahl steht auch als Kopfzahl des Blocks.
      anker: (p: Page) =>
        p.locator('[data-lfh="verlauf-eintrag"]').getByText(/1.420 untergebracht/),
    },
    {
      // Der zugängliche Name trägt hinter der Bezeichnung den Zeitraum — Präfix statt Wortlaut.
      pfad: `/einsaetze/${einsatzId}/verpflegung`,
      anker: (p: Page) =>
        p.getByRole('article', {
          name: /^Zeitfenster Mittagessen Deichverteidigung Nordwestring Kilometer 4,7 bis 6,2 /,
        }),
      lesend: { vorbedingung: (p: Page) => rechteHinweis(p, NUR_SCHREIBENDE) },
    },
    {
      // Gemessen mit OFFENER Leiste (unter `lg` unter der Karte, auf dem Handschirm per
      // Vorgabe zu), weil das der breitere Rahmen ist. Die Zeile misst den RAHMEN: die Leiste
      // trägt `overflowY: 'auto'` (damit auch `overflow-x: auto`), ein zu breiter Eintrag
      // liefe in ihrem eigenen Bildlauf über. Der Datenanker belegt nur, dass sie offen steht.
      pfad: `/einsaetze/${einsatzId}/lagekarte`,
      vorbereiten: async (p: Page) => {
        await expect(
          p.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas'),
        ).toHaveCount(1);
        const einblenden = p.getByRole('button', { name: 'Leiste einblenden' });
        if ((await einblenden.count()) > 0) await einblenden.click();
      },
      anker: (p: Page) =>
        p
          .getByRole('complementary', { name: 'Kartenleiste' })
          .getByText('Fachgruppe Wasserschaden/Pumpen Ortsverband Musterstadt-Nordwest')
          .first(),
    },
  ];
}

/** Nur Systemrolle „Admin" ändert Stammdaten und Org-Defaults — der Rest liest nach. */
const NUR_SYSTEM_ADMIN = /^Nur Benutzer mit der Systemrolle „Admin“ dürfen/;

const FAHRZEUG_STOFF = 'Florian Musterstadt-Nordwest 46/11-1 Wechsellader Abrollbehälter';

/**
 * Verwaltungsrouten der Org-Führungskraft (LFH-435): sie kommt in die Verwaltung, ist aber kein
 * System-Admin — Rechtehinweis und gesperrte Aktionen stehen, die Benutzerverwaltung leitet um.
 */
function gate1VerwaltungRouten(): Gate1Route[] {
  return [
    {
      pfad: '/admin/stammdaten/fahrzeuge',
      anker: (p: Page) => p.getByText(FAHRZEUG_STOFF).first(),
      lesend: {
        vorbedingung: async (p: Page) => {
          await rechteHinweis(p, NUR_SYSTEM_ADMIN);
          await expect(
            p.getByRole('button', { name: 'Fahrzeug anlegen' }),
            'Vorbedingung: die Primäraktion steht gesperrt, nicht versteckt',
          ).toBeDisabled();
        },
      },
    },
    {
      pfad: '/admin/einstellungen/einsatz',
      anker: (p: Page) => p.getByRole('heading', { name: 'Einsatz-Defaults', level: 1 }),
      lesend: { vorbedingung: (p: Page) => rechteHinweis(p, NUR_SYSTEM_ADMIN) },
    },
    {
      pfad: '/admin/benutzer',
      anker: (p: Page) => p.locator('tr.ant-table-row').first(),
      umleitungOhneAdmin: true,
    },
  ];
}

/**
 * Misst alle Routen einer Rolle auf einer Breite und meldet gesammelt. Für Nicht-Admins
 * gelten Lese-Anker und Vorbedingungen des Nur-Lese-Zweigs (`lesend`).
 */
async function gate1Messen(
  page: Page,
  routen: Gate1Route[],
  rolle: Gate1Rolle,
  { name, breite, hoehe }: (typeof PRUEFBREITEN)[number],
) {
  // ALLE Routen messen und gesammelt melden: sonst verdeckt der erste Fund die übrigen.
  const verstoesse: string[] = [];
  const messwerte: string[] = [];
  const tot: string[] = [];
  const genutzteFreistellungen = new Set<string>();
  const lesend = rolle !== 'admin';
  await page.setViewportSize({ width: breite, height: hoehe });
  for (const { pfad, anker, vorbereiten, lesend: zweig, umleitungOhneAdmin } of routen) {
    await page.goto(pfad);
    if (lesend && umleitungOhneAdmin) {
      // Ohne Admin-Recht gibt es diese Fläche nicht — die Umleitung ist die Zusicherung.
      await expect(page, `${pfad}: leitet für ${rolle} um`).toHaveURL(/\/einsaetze$/);
      messwerte.push(`${pfad} @${breite}: umgeleitet`);
      continue;
    }
    // Erst wenn der Rahmen steht, ist die Messung aussagekräftig. `first()`, weil der
    // Verwaltungsbereich zwei Rahmen schachtelt.
    await expect(page.locator('.ant-layout-content').first()).toBeVisible();
    // Reiter-Umschaltungen o. Ä. VOR dem Anker, sonst prüft er eine Fläche außerhalb des Baums.
    if (vorbereiten) await vorbereiten(page);
    // Erst der Anker belegt, dass die GEMEINTE Seite steht; er ersetzt das Warten auf ein
    // ruhiges Netz, das der SSE-Strom nie hergibt (LFH-385).
    await expect(
      ((lesend && zweig?.anker) || anker)(page),
      `${pfad} bei ${breite}px (${rolle}): die gemeinte Seite ist nicht gerendert`,
    ).toBeVisible();
    // Der Rollenzweig muss stehen, BEVOR gemessen wird — sonst misst der Durchgang still den
    // Admin-Zustand.
    if (lesend && zweig?.vorbedingung) await zweig.vorbedingung(page);

    const { ueber, schuldige } = await ueberlauf(page);
    messwerte.push(`${pfad} @${breite}: ${ueber}px`);

    // Freistellung über das Modul-Segment (der ganze Pfad enthält die laufende Einsatz-ID),
    // die Breite UND die Rolle.
    const frei = BESTAND_OFFEN.find(
      (b) => pfad.endsWith(`/${b.modul}`) && b.breite === breite && b.rolle === rolle,
    );
    if (frei) {
      genutzteFreistellungen.add(`${frei.modul}@${frei.breite}`);
      if (ueber <= 1) {
        tot.push(
          `${pfad} bei ${breite}px (${rolle}) ist BEHOBEN (${ueber}px) — der Eintrag in ` +
            `BESTAND_OFFEN ist tot und muss samt seiner Zeile im Kopfkommentar weg.`,
        );
      } else if (ueber > frei.deckel) {
        verstoesse.push(
          `${pfad} bei ${breite}px (${name}, ${rolle}): ${ueber}px über — das ist mehr als der ` +
            `freigestellte Deckel ${frei.deckel}px (gemessen war ${frei.gemessen}px), also eine ` +
            `VERSCHLECHTERUNG, kein Bestand\n  ${schuldige.slice(0, 4).join('\n  ')}`,
        );
      }
      continue;
    }

    if (ueber > 1) {
      verstoesse.push(
        `${pfad} bei ${breite}px (${name}, ${rolle}): ${ueber}px über\n  ${schuldige.slice(0, 4).join('\n  ')}`,
      );
    }
  }

  // Ein Eintrag, den keine Route dieser Breite und Rolle getroffen hat, ist ebenso tot. Einträge
  // auf einer Breite, die keine Prüfbreite ist, meldet JEDER Test seiner Rolle.
  const pruefbreiten: readonly number[] = PRUEFBREITEN.map((pb) => pb.breite);
  for (const b of BESTAND_OFFEN) {
    if (b.rolle !== rolle) continue;
    const hierZustaendig = b.breite === breite || !pruefbreiten.includes(b.breite);
    if (hierZustaendig && !genutzteFreistellungen.has(`${b.modul}@${b.breite}`)) {
      tot.push(
        `BESTAND_OFFEN nennt ${b.modul}@${b.breite}px (${b.rolle}), aber diese Route × Breite ` +
          `wird für die Rolle gar nicht gemessen — tote Freistellung.`,
      );
    }
  }
  expect(tot, `Tote Freistellungen:\n${tot.join('\n')}`).toEqual([]);
  // Messwerte protokollieren: ein grüner Lauf ohne Zahlen lässt offen, ob gemessen wurde.
  test.info().annotations.push({ type: 'messwert', description: messwerte.join(' · ') });
  expect(verstoesse, `Gate 1 verletzt:\n${verstoesse.join('\n')}`).toEqual([]);
}

/*
 * JE PRÜFBREITE UND ROLLE EIN TEST: jeder hat sein eigenes Zeitbudget, und ein Bruch nennt
 * Breite und Rolle im Testnamen. Innerhalb eines Tests wird ALLES gemessen und gesammelt
 * gemeldet.
 *
 * ROLLEN (LFH-435): der Admin läuft nur durch die freien Zweige. Der Beobachter (weder
 * Verwaltungs- noch Schreibrecht) sieht Rechtehinweise, gesperrte Aktionen und den
 * Nur-Lese-ETB; die Org-Führungskraft die Verwaltung ohne Admin-Recht.
 *
 * `mode: 'parallel'` verteilt die Tests auf Worker (die Konfiguration fährt kein
 * `fullyParallel`). Sie sind unabhängig, jeder legt seinen eigenen Einsatz an.
 */
test.describe('Gate 1', () => {
  test.describe.configure({ mode: 'parallel' });
  for (const pruefbreite of PRUEFBREITEN) {
    const { name, breite } = pruefbreite;
    test(`Gate 1 · ${name} (${breite} px): keine tragende Route läuft waagerecht über`, async ({
      page,
    }) => {
      // 20 Routen je Breite, jede mit `goto` und Inhaltsanker; `test.slow()` (90 s) reichte
      // unter Last nicht mehr, seit der Überblick mitgemessen wird (LFH-435). Die drei
      // S5-Seiten (LFH-554) kosten je Breite rund 10 s mehr.
      test.setTimeout(240_000);
      const einsatzId = await gate1Vorbereiten(page);
      await gate1Messen(page, gate1Routen(einsatzId), 'admin', pruefbreite);
    });

    test(`Gate 1 · ${name} (${breite} px) · Beobachter: auch ohne Schreibrecht läuft keine Route über`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      // Gesät wird als Admin; der Wechsel im selben Kontext behält den Wetter-Stub.
      const einsatzId = await gate1Vorbereiten(page);
      await wechsleZuRolle(page, 'beobachter', einsatzId);
      await gate1Messen(page, gate1Routen(einsatzId), 'beobachter', pruefbreite);
    });

    test(`Gate 1 · ${name} (${breite} px) · Führungskraft: die Verwaltung ohne Admin-Recht läuft nicht über`, async ({
      page,
    }) => {
      test.slow();
      await anmelden(page);
      const antwort = await page.request.post('/api/fahrzeuge', {
        data: {
          // Funkrufnamen sind je Org eindeutig: Breite und Zeitstempel trennen parallele Tests
          // und den CI-Retry, der auf derselben DB läuft.
          funkrufname: `${FAHRZEUG_STOFF} ${breite} ${Date.now()}`,
          fahrzeugtyp: 'WLF mit AB-Hochwasser',
          kennzeichen: 'MU-NW 4611',
        },
      });
      expect(
        antwort.ok(),
        `Seeding Fahrzeug: ${antwort.status()} ${await antwort.text()}`,
      ).toBeTruthy();
      await wechsleZuRolle(page, 'fuehrungskraft');
      await gate1Messen(page, gate1VerwaltungRouten(), 'fuehrungskraft', pruefbreite);
    });
  }

  /*
   * STEHENDES SAMMELBANNER AUF DEM HANDSCHIRM (LFH-694, Spec `einsatztauglichkeit-layout`): die
   * Routen oben laufen ohne Banner — es erscheint nur auf ein Live-Ereignis. Ablösung und
   * Verpflegung stellen es in die Werkzeugzeile neben die Segmentleiste; bei 390 px trug das
   * nicht (0 px Text, im Handschuh-Betrieb 59 px Überlauf). Gesät werden 12 gezeigte Einträge,
   * damit die Segmentleiste ihre zweistellige Zahl trägt.
   *
   * ROLLEN (LFH-435): nur Admin. Die Werkzeugzeile hat keinen Rollenzweig; der Beobachter sieht
   * dieselbe Segmentleiste und dasselbe Banner, ein zweiter Lauf bewiese nichts Neues.
   */
  for (const modul of ['abloesung', 'verpflegung'] as const) {
    for (const dichte of ['kompakt', 'komfortabel', 'handschuh'] as const) {
      test(`Gate 1 · mobil (390 px) · ${modul} · ${dichte}: stehendes Sammelbanner läuft nicht über und verschiebt nichts`, async ({
        page,
      }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width: 390, height: 844 });
        await anmelden(page);
        const neu = await page.request.post('/api/einsaetze', {
          data: { bezeichnung: `E2E Banner ${modul} ${dichte} ${Date.now()}` },
        });
        expect(neu.ok(), `Seeding Einsatz: ${neu.status()}`).toBeTruthy();
        const einsatzId = ((await neu.json()) as { id: number }).id;
        const post = async (pfad: string, data: unknown, was: string) => {
          const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
          expect(
            antwort.ok(),
            `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`,
          ).toBeTruthy();
          return (await antwort.json()) as { id: number };
        };
        const jetzt = Date.now();
        const zeitfenster = (bezeichnung: string, vonMin: number, bisMin: number) =>
          post(
            'verpflegung/zeitfenster',
            {
              bezeichnung,
              von_at: new Date(jetzt + vonMin * 60_000).toISOString(),
              bis_at: new Date(jetzt + bisMin * 60_000).toISOString(),
              bedarf_kraefte: 10,
              bedarf_betreute: 0,
              bedarf_weitere: 0,
              sonderkost: {},
            },
            bezeichnung,
          );
        const schicht = async (abschnittId: number, name: string, rhythmus: number) => {
          const einheit = await post('einheiten', { name, abschnitt_id: abschnittId }, name);
          await post('abloesungen', { einheit_id: einheit.id, rhythmus_minuten: rhythmus }, name);
        };
        let abschnittId = 0;
        if (modul === 'abloesung') {
          abschnittId = (await post('abschnitte', { name: 'Deichwache Nord' }, 'Abschnitt')).id;
          for (let i = 1; i <= 12; i += 1) await schicht(abschnittId, `Florian Nord ${i}`, 360);
        } else {
          for (let i = 1; i <= 12; i += 1) await zeitfenster(`Mittag ${i}`, -60, 180);
          for (let i = 1; i <= 3; i += 1) await zeitfenster(`Frühstück ${i}`, -300, -240);
        }

        await page.goto(`/einsaetze/${einsatzId}/${modul}`);
        await page.evaluate((d) => window.localStorage.setItem('lifeline-hub.dichte', d), dichte);
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
        const karten = page.locator(`[data-lfh="${modul}-karte"]`);
        const zeile = page.locator(`[data-lfh="${modul}-werkzeugzeile"]`);
        const banner = zeile.locator('[data-lfh="sammelbanner"]');
        await expect(karten).toHaveCount(12);
        await expect(banner).toHaveCount(0);
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        const vorher = {
          zeile: (await zeile.boundingBox())!.height,
          oben: (await karten.first().boundingBox())!.y,
        };

        // Fremd angelegt (am Frontend vorbei), vor den gezeigten einsortiert.
        if (modul === 'abloesung') await schicht(abschnittId, 'Florian Süd 9', 30);
        else await zeitfenster('Imbiss', -120, 60);

        await expect(banner).toBeVisible();
        const knopf = banner.getByRole('button', { name: '1 neu anzeigen' });
        await expect(knopf).toHaveText('1 neu');
        const mass = await page.evaluate(() => {
          const kurz = document.querySelector<HTMLElement>('[data-lfh="sammelbanner-kurz"]')!;
          const knopf = kurz.closest('button')!;
          const k = knopf.getBoundingClientRect();
          return {
            // Der Text selbst kürzt nicht; zu eng wird es, wenn Icon und Text über die
            // Polsterung des Knopfes hinausragen.
            gekuerzt: kurz.scrollWidth > kurz.clientWidth || knopf.scrollWidth > knopf.clientWidth,
            knopfLinks: k.left,
            knopfRechts: k.right,
            dokument: document.documentElement.scrollWidth,
          };
        });
        const nachher = {
          zeile: (await zeile.boundingBox())!.height,
          oben: (await karten.first().boundingBox())!.y,
        };
        expect(mass.gekuerzt, '„1 neu“ steht ungekürzt').toBe(false);
        expect(mass.knopfLinks, 'Knopf links im Fenster').toBeGreaterThanOrEqual(0);
        expect(mass.knopfRechts, 'Knopf rechts im Fenster').toBeLessThanOrEqual(390);
        expect(mass.dokument, 'kein waagerechter Überlauf').toBeLessThanOrEqual(390);
        expect(
          Math.abs(nachher.zeile - vorher.zeile),
          `Werkzeugzeile ${vorher.zeile} → ${nachher.zeile} px`,
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(nachher.oben - vorher.oben),
          `oberste Karte y ${vorher.oben} → ${nachher.oben}`,
        ).toBeLessThanOrEqual(0.5);

        await knopf.click();
        await expect(karten).toHaveCount(13);
        await expect(banner).toHaveCount(0);
        test.info().annotations.push({
          type: 'messwert',
          description: `${modul}/${dichte}: Knopf ${mass.knopfLinks.toFixed(1)}–${mass.knopfRechts.toFixed(1)} px, Zeile ${vorher.zeile} → ${nachher.zeile} px`,
        });
      });
    }
  }
});
