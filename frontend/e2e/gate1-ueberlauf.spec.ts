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
 * Gemessen wird `documentElement`, nicht `body`: die Bildlaufleiste der Seite
 * hängt an der Wurzel, und ein `body` mit `overflow: hidden` verstecke den
 * Überlauf, statt ihn zu beheben.
 *
 * Elemente in einem eigenen Bildlaufbereich sind KEIN Verstoß — genau dafür
 * trägt die Katalogtabelle ihren waagerechten Bildlauf. Deshalb steigt die
 * Diagnose an jedem Vorfahren mit eigenem `overflow-x` aus, statt dessen Kinder
 * anzuzeigen.
 */
async function ueberlauf(page: Page): Promise<{ ueber: number; schuldige: string[] }> {
  return page.evaluate(() => {
    const wurzel = document.documentElement;
    const ueber = wurzel.scrollWidth - wurzel.clientWidth;
    if (ueber <= 1) return { ueber, schuldige: [] };

    const grenze = wurzel.clientWidth;
    const schuldige: string[] = [];
    const eigenerBildlauf = (el: Element) => {
      const ox = getComputedStyle(el).overflowX;
      return ox === 'auto' || ox === 'scroll' || ox === 'hidden';
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
          (eigenerBildlauf(el) ? ' [eigener Bildlauf]' : ''),
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
  const routen = [
    '/einsaetze',
    `/einsaetze/${einsatzId}/lage-dashboard`,
    `/einsaetze/${einsatzId}/etb`,
    '/admin/benutzer',
  ];

  // ALLE Kombinationen messen und gesammelt melden, nicht beim ersten Bruch
  // aussteigen: sonst verdeckt der erste Fund die übrigen elf und man behebt
  // eine Ursache, ohne zu wissen, wie viele es sind.
  const verstoesse: string[] = [];
  for (const route of routen) {
    for (const { name, breite, hoehe } of PRUEFBREITEN) {
      await page.setViewportSize({ width: breite, height: hoehe });
      await page.goto(route);
      // Erst wenn der Rahmen steht, ist die Messung aussagekräftig — sonst
      // misst man eine halb gefüllte Seite und bekommt grün geschenkt.
      // `first()`, weil der Verwaltungsbereich sein eigenes Layout in die
      // Ebene-1-Shell schachtelt und dort zwei Rahmen stehen.
      await expect(page.locator('.ant-layout-content').first()).toBeVisible();
      await page.waitForLoadState('networkidle');

      const { ueber, schuldige } = await ueberlauf(page);
      if (ueber > 1) {
        verstoesse.push(
          `${route} bei ${breite}px (${name}): ${ueber}px über\n  ${schuldige.slice(0, 4).join('\n  ')}`,
        );
      }
    }
  }
  expect(verstoesse, `Gate 1 verletzt:\n${verstoesse.join('\n')}`).toEqual([]);
});
