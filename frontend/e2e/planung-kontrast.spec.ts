import { expect, test, type Locator, type Page } from '@playwright/test';
import { kontrast, randKontrast } from './kontrast-kern';
import { anmeldenAlsAdmin } from './rollen-kern';
import {
  AMPELN,
  BLOECKE_ANZAHL,
  seedAltePlanung,
  seedPlanung,
  waitForPlanung,
  waitForRaster,
} from './planung-kern';

/**
 * Kriterium 5 der Prüfliste für die Vorplanung (LLH-1595, nachgeholt für LLH-1586): Kontrast der
 * ZUSAMMENGESETZTEN Paare in Tag und Nacht, gemessen mit dem geteilten Messkern
 * (`kontrast-kern.ts`), ohne Farbwerte aus dem Produkt.
 *
 * GEMESSEN: die Liste `/planungen` mit Löschhinweis („wird am … gelöscht“) und Kennzahlen, die
 * Planungsseite mit Kopf in Ansicht und im Bearbeiten, die Reiter Posten und Helfer, das Raster
 * mit allen vier Ampelstufen und der Personenleiste, die Dialoge „Posten anlegen“ und „Schichten
 * erzeugen“ und bei 390 px die Handy-Liste mit denselben vier Stufen.
 *
 * SCHRANKEN (Literale): Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1 für JEDEN sichtbaren Text, über den
 * Textbaum gefunden und gegen den Grund gemessen, auf dem er WIRKLICH steht. Text in gesperrten
 * Knöpfen zählt gegen den Gesperrt-Boden 4,5 : 1 (Spec `textstufen-kontrast`). Die Ampelkante
 * (3 px links am Block) trägt den Zustand und hält ≥ 3 : 1 gegen die Blockfläche und gegen die
 * Spur, auf der der Block steht (WCAG 1.4.11), wie der Kartenrand der Ablösung
 * (`abloesung-kontrast.spec.ts`).
 */

const TEXT = { light: 7, dark: 5 } as const;
const GESPERRT_BODEN = 4.5;
const ZUSTAND = 3;

interface Textknoten {
  ziel: Locator;
  text: string;
}

/** Jedes SICHTBARE Element unter `wurzel` mit eigenem Text (Muster `unterkunft-kontrast`). */
async function textknoten(wurzel: Locator): Promise<Textknoten[]> {
  const funde = await wurzel.evaluate((w) => {
    for (const alt of document.querySelectorAll('[data-kontrastprobe]'))
      alt.removeAttribute('data-kontrastprobe');
    const liste: { text: string }[] = [];
    for (const el of [w, ...w.querySelectorAll('*')]) {
      if (el.closest('[aria-hidden="true"]')) continue;
      // Durchsichtiges zählt nicht als Text (antd hält etwa den Platzhalter eines Selects mit
      // Deckkraft 0 bereit); was zu sehen ist, misst der Kern weiter streng.
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const eigen = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!eigen) continue;
      el.setAttribute('data-kontrastprobe', String(liste.length));
      liste.push({ text: eigen });
    }
    return liste;
  });
  return funde.map((f, i) => ({ ...f, ziel: wurzel.locator(`[data-kontrastprobe="${i}"]`) }));
}

type Messwert = Record<string, unknown> & { verhaeltnis: number };

function createMessung(page: Page, modus: 'light' | 'dark') {
  const messwerte: Messwert[] = [];
  const gemessen: [string, string][] = [];
  const measureTexte = async (wurzel: Locator, flaeche: string) => {
    await page.mouse.move(0, 0);
    const knoten = await textknoten(wurzel);
    expect(knoten.length, `${flaeche}: Texte gefunden`).toBeGreaterThan(0);
    // Ein Dialog blendet mit Opacity ein; erst messen, wenn der erste Knoten steht.
    await expect(async () => {
      await kontrast(knoten[0].ziel);
    }).toPass({ timeout: 10_000 });
    for (const { ziel, text } of knoten) {
      const m = await kontrast(ziel);
      const gesperrt = await ziel.evaluate(
        (el) => el.closest('button[disabled], .ant-tabs-tab-disabled') != null,
      );
      const schranke = gesperrt ? GESPERRT_BODEN : TEXT[modus];
      messwerte.push({ modus, flaeche, wortlaut: text, gesperrt, ...m });
      gemessen.push([flaeche, text]);
      expect
        .soft(
          m.verhaeltnis,
          `${modus}, ${flaeche}, „${text}"${gesperrt ? ' (gesperrt)' : ''}: ${m.verhaeltnis.toFixed(2)} : 1 (Schranke ≥ ${schranke}) ${JSON.stringify(m)}`,
        )
        .toBeGreaterThanOrEqual(schranke);
    }
  };
  /** Die Ampelkante eines Blocks gegen Blockfläche und Spur. */
  const measureKante = async (block: Locator, flaeche: string, ampel: string) => {
    const rand = await randKontrast(block, 'left');
    messwerte.push({
      modus,
      flaeche,
      ampel,
      art: 'ampelkante',
      verhaeltnis: rand.gegenAussen,
      ...rand,
    });
    const kontext = `${modus}, ${flaeche}, Ampel ${ampel}, Kante ${JSON.stringify(rand)}`;
    expect.soft(rand.gegenAussen, `${kontext} gegen den Grund`).toBeGreaterThanOrEqual(ZUSTAND);
    expect
      .soft(rand.gegenInnen, `${kontext} gegen die Blockfläche`)
      .toBeGreaterThanOrEqual(ZUSTAND);
  };
  return { messwerte, gemessen, measureTexte, measureKante };
}

function checkPflichtGemessen(
  gemessen: [string, string][],
  pflichten: readonly (readonly [string, string | RegExp])[],
) {
  for (const [flaeche, pflicht] of pflichten) {
    const treffer = gemessen.filter(
      ([f, t]) => f === flaeche && (typeof pflicht === 'string' ? t === pflicht : pflicht.test(t)),
    );
    expect(treffer.length, `Text ${String(pflicht)} in ${flaeche} gemessen`).toBeGreaterThan(0);
  }
}

function minVerhaeltnis(messwerte: Messwert[], f: (w: Messwert) => boolean): string {
  const werte = messwerte.filter(f).map((w) => w.verhaeltnis);
  return werte.length ? Math.min(...werte).toFixed(2) : '—';
}

/**
 * Die Spur des Rasters trägt die Stundenlinien als `linear-gradient` (1 px je Stunde). Der
 * Messkern lehnt Verläufe ab, statt eine Komposition zu raten. Vorbedingung: der Verlauf ist
 * genau das, eine 1-px-Linie in einer Farbe mit Deckkraft ≤ 0,1 vor Durchsichtigem; dann blendet
 * der Test ihn aus und misst gegen den Grund ZWISCHEN den Linien, auf dem Text und Ampelkante
 * stehen. Ein kräftigeres Muster bliebe als Vorbedingung rot.
 */
async function hideStundenlinien(page: Page) {
  const spuren = page.locator('[data-lfh="schichtplan-spur"]');
  await expect(spuren.first()).toBeVisible();
  const verlaeufe = await spuren.evaluateAll((alle) =>
    alle.map((el) => getComputedStyle(el).backgroundImage),
  );
  for (const v of verlaeufe) {
    const m =
      /^linear-gradient\(to right, rgba\(\d+, \d+, \d+, ([\d.]+)\) 1px, rgba\(0, 0, 0, 0\) 1px\)$/.exec(
        v,
      );
    expect(m, `Vorbedingung: Stundenlinie statt Muster (${v})`).not.toBeNull();
    expect(Number(m![1]), `Vorbedingung: Stundenlinie ist zart (${v})`).toBeLessThanOrEqual(0.1);
  }
  await page.addStyleTag({
    content: '[data-lfh="schichtplan-spur"] { background-image: none !important; }',
  });
}

const AMPEL_WORT = new RegExp(`· (${Object.values(AMPELN).join('|')})$`);

for (const modus of ['light', 'dark'] as const) {
  test(`Vorplanung (LLH-1595): Liste, Kopf, Reiter, Raster mit Ampel und Dialoge im Modus ${modus}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await anmeldenAlsAdmin(page);
    const name = `Kontrastplanung ${modus} ${Date.now()}`;
    const alt = `Altplanung ${modus} ${Date.now()}`;
    const { id } = await seedPlanung(page, name);
    await seedAltePlanung(page, alt);
    const { messwerte, gemessen, measureTexte, measureKante } = createMessung(page, modus);

    await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    const kopf = page.locator('[data-lfh="seitenkopf"]');
    // `AdminPage` trägt keinen eigenen Inhaltsanker; `main` misst den Kopf ein zweites Mal mit.
    const inhalt = page.getByRole('main');

    // (1) Liste mit Löschhinweis und Kennzahlen; die Suche filtert auf beide Messplanungen.
    await page.goto('/planungen');
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    await page.getByPlaceholder('Bezeichnung, Ort oder Zeitraum').fill(modus);
    const zeileAlt = page.getByRole('row').filter({ hasText: alt });
    await expect(zeileAlt.locator('[data-lfh="planung-loeschhinweis"]')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
    await measureTexte(kopf, 'liste-kopf');
    await measureTexte(inhalt, 'liste');

    // (2) Planungsseite, Reiter Plan: Kopf in der Ansicht, Raster mit allen Ampelstufen.
    await page.goto(`/planungen/${id}`);
    await waitForPlanung(page, name);
    await waitForRaster(page);
    await measureTexte(kopf, 'seite-kopf');
    await hideStundenlinien(page);
    await measureTexte(inhalt, 'plan');
    for (const ampel of Object.keys(AMPELN)) {
      const block = page.locator(`[data-lfh="schichtplan-block"][data-ampel="${ampel}"]`).first();
      await measureKante(block, 'raster', ampel);
    }

    // (3) Dialog „Schichten erzeugen“.
    await page.getByRole('button', { name: 'Schichten erzeugen', exact: true }).click();
    const erzeugen = page.getByRole('dialog', { name: 'Schichten erzeugen' });
    await expect(erzeugen).toBeVisible();
    await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
    await measureTexte(erzeugen, 'dialog-erzeugen');
    await page.keyboard.press('Escape');
    await expect(erzeugen).toBeHidden();

    // (4) Kopf im Bearbeiten.
    await page.getByRole('button', { name: 'Planung bearbeiten', exact: true }).click();
    await expect(page.getByLabel('Höchstens im Dienst')).toBeVisible();
    await measureTexte(inhalt, 'kopf-bearbeiten');
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(page.getByLabel('Höchstens im Dienst')).toBeHidden();

    // (5) Reiter Posten und Dialog „Posten anlegen“.
    await page.getByRole('tab', { name: /^Posten/ }).click();
    await expect(page.locator('[data-lfh="planung-posten"]').getByText('Fußtrupp')).toBeVisible();
    await measureTexte(inhalt, 'posten');
    await page.getByRole('button', { name: 'Posten anlegen', exact: true }).click();
    const posten = page.getByRole('dialog', { name: 'Posten anlegen' });
    await expect(posten).toBeVisible();
    await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
    await measureTexte(posten, 'dialog-posten');
    await page.keyboard.press('Escape');
    await expect(posten).toBeHidden();

    // (6) Reiter Helfer.
    await page.getByRole('tab', { name: /^Helfer/ }).click();
    await expect(
      page.locator('[data-lfh="planung-helfer"]').getByText('Hanna Messweg'),
    ).toBeVisible();
    await measureTexte(inhalt, 'helfer');

    // (7) Handy: dieselben vier Stufen als Liste.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: 'Plan', exact: true }).click();
    const listenBloecke = page.locator('[data-lfh="schichtplan-listen-block"]');
    await expect(listenBloecke).toHaveCount(BLOECKE_ANZAHL);
    await measureTexte(page.locator('[data-lfh="schichtplan-liste"]'), 'handy-liste');
    for (const [ampel, wort] of Object.entries(AMPELN)) {
      const block = page
        .locator(`[data-lfh="schichtplan-listen-block"][aria-label$=", ${wort}"]`)
        .first();
      await expect(block).toBeVisible();
      await measureKante(block, 'handy-liste', ampel);
    }

    // Die Probe hat die tragenden Texte wirklich gesehen — sonst wäre Grün trivial wahr.
    checkPflichtGemessen(gemessen, [
      ['liste-kopf', 'Planungen'],
      ['liste-kopf', 'Planung anlegen'],
      ['liste', /^wird am .* gelöscht$/],
      ['liste', alt],
      ['seite-kopf', name],
      ['plan', 'Fußtrupp'],
      ['plan', 'Nord'],
      ['plan', /· 2 offen$/],
      ['plan', /· zu lange im Dienst$/],
      ['plan', /· besetzt$/],
      ['plan', /· unbesetzt$/],
      ['plan', 'Hanna Messweg'],
      ['plan', 'Schichten erzeugen'],
      ['dialog-erzeugen', 'Länge je Schicht'],
      ['kopf-bearbeiten', 'Höchstens im Dienst'],
      ['posten', 'Herkunft'],
      ['dialog-posten', 'Qualifikationssoll'],
      ['helfer', 'Helmut Messweg'],
      ['handy-liste', '2 offen'],
      ['handy-liste', 'zu lange im Dienst'],
      ['handy-liste', 'besetzt'],
      ['handy-liste', 'unbesetzt'],
      ['handy-liste', 'Fußtrupp'],
    ]);

    testInfo.annotations.push({
      type: 'messwert',
      description:
        `${modus}: ${messwerte.filter((w) => w.art !== 'ampelkante').length} Texte, ` +
        `kleinster ${minVerhaeltnis(messwerte, (w) => w.art !== 'ampelkante' && !w.gesperrt)} : 1, ` +
        `gesperrt ${minVerhaeltnis(messwerte, (w) => w.gesperrt === true)} : 1, ` +
        `Ampelwort Raster ${minVerhaeltnis(messwerte, (w) => w.flaeche === 'plan' && AMPEL_WORT.test(String(w.wortlaut)))} : 1, ` +
        `Handy-Liste ${minVerhaeltnis(messwerte, (w) => w.flaeche === 'handy-liste' && w.art !== 'ampelkante')} : 1, ` +
        `Löschhinweis ${minVerhaeltnis(messwerte, (w) => /gelöscht$/.test(String(w.wortlaut)))} : 1, ` +
        `Ampelkante ${minVerhaeltnis(messwerte, (w) => w.art === 'ampelkante')} : 1`,
    });
    await testInfo.attach(`kontrastwerte-${modus}.json`, {
      body: JSON.stringify(messwerte, null, 2),
      contentType: 'application/json',
    });
  });
}
