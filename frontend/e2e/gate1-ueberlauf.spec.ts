import { expect, test, type Page } from '@playwright/test';

/**
 * Gate 1 der Bedien-Leitlinie: kein waagerechter Überlauf auf den drei
 * Arbeitsbreiten (LFH-329 · B1, Abschlussschritt).
 *
 * WARUM ALS EIGENE SPEC: Die sieben Arbeitspakete von B1 messen jeweils nur
 * ihren eigenen Ausschnitt — die Rinne, die Kopfzeile, den Navigationsrahmen,
 * eine Katalogtabelle. Gate 1 ist aber eine Aussage über die ganze Seite. Ohne
 * diese Spec hätte das erste Akzeptanzkriterium des Tickets keinen Eigentümer:
 * jedes Paket wäre grün und die Seite trotzdem breiter als der Schirm.
 *
 * DIE PRÜFBREITEN stammen aus der Bedien-Leitlinie (A1, Gate 1): 1366 px
 * Führungswagen, 1024 px Führungs-Tablet, 390 px mobil.
 *
 * DIE 1-PX-TOLERANZ ist kein Aufweichen: Chromium rundet `scrollWidth` auf
 * ganze Pixel, während Layoutbreiten gebrochen sein dürfen (die Kopfzeilen-
 * Polsterung rechnet mit 46,875 px). Ohne die Toleranz meldete das Gate einen
 * Rundungsrest als Überlauf.
 *
 * BEI EINEM BRUCH nennt die Diagnose das schuldige Element mit Tag, Klassen und
 * gemessener Breite. Ein nacktes „erwartet 390, war 400" schickt den nächsten
 * Leser sonst auf die Suche.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Führungswagen · Führungs-Tablet · mobil (A1, Gate 1). */
const PRUEFBREITEN = [
  { name: 'Fükw', breite: 1366, hoehe: 768 },
  { name: 'Führungs-Tablet', breite: 1024, hoehe: 768 },
  { name: 'mobil', breite: 390, hoehe: 844 },
] as const;

// Login-/Anlege-Helfer aus `kernfluss.spec.ts` kopiert — es gibt (noch) kein
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
 * Misst das Wurzelelement und benennt bei Überschreitung die Verursacher.
 *
 * WAS DIESES GATE NICHT SIEHT — und das ist seine eigentliche Grenze: jedes
 * `overflow-x: hidden` an IRGENDEINEM Vorfahren nimmt überlaufende Kinder aus
 * der Wurzelmetrik heraus. Ein geklippter Inhalt ist dann abgeschnitten und ohne
 * Bildlauf unerreichbar — und das Gate ist trotzdem grün. Gate 1 wäre also
 * erfüllbar, indem man KLIPPT statt repariert. Wer eine Rotmeldung dieses Gates
 * mit `overflow-x: hidden` „behebt", hat es nicht behoben, sondern versteckt.
 *
 * FRÜHER STAND HIER, `documentElement` werde gemessen, weil ein `body` mit
 * `overflow: hidden` den Überlauf sonst verstecke. Das ist sachlich falsch und
 * beschrieb die Lücke außerdem zu eng: `overflow` am `body` propagiert bei
 * `html: visible` auf den Viewport — `documentElement.scrollWidth` wächst dann
 * gerade NICHT, ein `body`-Klipp bliebe also ohnehin folgenlos für diese
 * Messung. Gemessen wird die Wurzel schlicht deshalb, weil die Bildlaufleiste
 * der Seite dort hängt.
 *
 * GEMESSEN AN HEAD ist das kein Verstoß: im Produktivcode gibt es kein globales
 * `overflow-x: hidden`. Die einzigen Klipp-Stellen sind `.login-seite`
 * (`LoginPage.css`, keine der vier Routen unten), zwei Ellipsen-Regeln in
 * `theme/sprache.css` und antds eigener `.ant-table-sticky-holder`. Alle vier
 * Routen messen auf allen drei Breiten 0 px Überlauf — die Wurzelbreite ist also
 * echt eingehalten und nicht bloß weggeklippt.
 *
 * Elemente in einem eigenen Bildlaufbereich sind KEIN Verstoß — genau dafür
 * trägt die Katalogtabelle ihren waagerechten Bildlauf. Deshalb steigt die
 * Diagnose an jedem Vorfahren mit eigenem `overflow-x` aus, statt dessen Kinder
 * anzuzeigen. `hidden` wird dabei von `auto`/`scroll` GETRENNT ausgewiesen:
 * beides nimmt das Element aus der Wurzelmetrik, aber nur `auto`/`scroll` gibt
 * dem Benutzer den Inhalt zurück. Ein `[GEKLIPPT]` in der Diagnose ist deshalb
 * ein Fund, kein Freispruch.
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

    // FLACH über alle Elemente, nicht als Baumabstieg: ein absolut
    // positioniertes oder aus einem Bildlaufbereich ragendes Element hat
    // Vorfahren, die selbst brav innerhalb liegen — ein Abstieg, der nur
    // überragenden Knoten folgt, findet es nie und meldet „Überlauf ohne
    // Verursacher". Genau das ist beim ersten Lauf passiert.
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

test('Gate 1: keine tragende Route läuft auf 1366, 1024 oder 390 px waagerecht über', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Gate1 ${Date.now()}`);

  // Eine Route je Layoutfamilie: Ebene-1-Shell, Lagebild, Modulseite unter dem
  // Einsatz-Workspace, Verwaltung unter dem Admin-Layout. Die vier hängen an
  // vier verschiedenen Rahmen — eine einzelne Route belegte nur einen davon.
  //
  // JE ROUTE EIN INHALTSANKER, und zwar ein Knoten, den NUR diese Seite hat.
  // Vorher stand hier bloß `.ant-layout-content` — das ist auf JEDER Route der
  // Anwendung wahr und belegte nur, dass irgendein Rahmen steht. Das ist keine
  // theoretische Lücke: die Modulrouten laufen über `modulRegistry` mit
  // `ModulRedirect`/`ModulStub` (`src/App.tsx`), und ein Redirect auf eine leere
  // Seite misst sich überlauffrei und wäre grün gewesen. Ein Gate, das eine
  // verschwundene Seite als „kein Überlauf" liest, misst nichts.
  //
  // Die Anker sind bewusst aus den Nachbar-Specs übernommen, wo sie am
  // Handschirm bereits belegt sind — sie müssen auf ALLEN DREI Breiten stehen,
  // auch auf 390 px:
  //  - `.lfh-kennzahlen .lfh-kz` → `lage-dashboard-schmal.spec.ts`
  //  - `Inhalt …` (ETB-Schnellerfassung) → `nav-schmal.spec.ts`
  //  - `tr.ant-table-row` → `katalogtabelle-schmal.spec.ts`
  // Für `/einsaetze` gibt es keinen Nachbar-Spec; gemessen trägt die Seite auf
  // allen drei Breiten `[data-testid="einsaetze-raster"]`. NICHT genommen wurde
  // „Neuer Einsatz": der Knopf liegt auf 390 px hinter dem Kopfgriff.
  const routen = [
    { pfad: '/einsaetze', anker: (p: Page) => p.locator('[data-testid="einsaetze-raster"]') },
    {
      pfad: `/einsaetze/${einsatzId}/lage-dashboard`,
      anker: (p: Page) => p.locator('.lfh-kennzahlen .lfh-kz').first(),
    },
    {
      pfad: `/einsaetze/${einsatzId}/etb`,
      anker: (p: Page) => p.getByPlaceholder('Inhalt …'),
    },
    { pfad: '/admin/benutzer', anker: (p: Page) => p.locator('tr.ant-table-row').first() },
  ];

  // ALLE Kombinationen messen und gesammelt melden, nicht beim ersten Bruch
  // aussteigen: sonst verdeckt der erste Fund die übrigen elf und man behebt
  // eine Ursache, ohne zu wissen, wie viele es sind.
  const verstoesse: string[] = [];
  for (const { pfad, anker } of routen) {
    for (const { name, breite, hoehe } of PRUEFBREITEN) {
      await page.setViewportSize({ width: breite, height: hoehe });
      await page.goto(pfad);
      // Erst wenn der Rahmen steht, ist die Messung aussagekräftig — sonst
      // misst man eine halb gefüllte Seite und bekommt grün geschenkt.
      // `first()`, weil der Verwaltungsbereich sein eigenes Layout in die
      // Ebene-1-Shell schachtelt und dort zwei Rahmen stehen.
      await expect(page.locator('.ant-layout-content').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      // …und erst der Anker belegt, dass die GEMEINTE Seite steht. Nach
      // `networkidle`, damit ein datenabhängiger Anker nicht gegen seinen
      // eigenen Ladevorgang antritt.
      await expect(
        anker(page),
        `${pfad} bei ${breite}px: die gemeinte Seite ist nicht gerendert`,
      ).toBeVisible();

      const { ueber, schuldige } = await ueberlauf(page);
      if (ueber > 1) {
        verstoesse.push(
          `${pfad} bei ${breite}px (${name}): ${ueber}px über\n  ${schuldige.slice(0, 4).join('\n  ')}`,
        );
      }
    }
  }
  expect(verstoesse, `Gate 1 verletzt:\n${verstoesse.join('\n')}`).toEqual([]);
});
