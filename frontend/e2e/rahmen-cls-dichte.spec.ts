import { expect, test, type Page } from '@playwright/test';
import { beobachteShifts, bericht, ruheShifts } from './cls-kern';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Der App-Rahmen springt beim Laden nicht, in keiner Stufe der Dichte-Staffel (LLH-1272, aus den
 * Prüflisten LLH-1060 und LLH-1093 Teil II).
 *
 * DIE URSACHE, die dieser Spec abriegelt: der Kopf (`flexWrap`) bricht seine rechte Zellgruppe in
 * eine zweite Zeile um, sobald sie nicht mehr neben Namens- und Suchzelle passt. Im Einsatzrahmen
 * trug das Benutzermenü zuerst den Anzeigenamen und nach dem Laden des Einsatzes die Funktion
 * („Administrator“ → „Einsatzleitung“, 4 px breiter). Lag der Viewport an der Umbruchkante, stand
 * der Kopf im ersten Bild einzeilig und danach zweizeilig: Rail, Panel und Inhalt sprangen 52 px
 * (`komfortabel`) bzw. 72 px (`handschuh`), Seiten-CLS 0,556. Am 15.10.2026 lag die Kante genau bei
 * 1280 px; seit dem Knopf „Eingänge“ (LLH-1143) lag sie bei 1296–1298 px, der Sprung blieb. Seitdem
 * hat das Etikett eine feste Breite (`hasFixedWidth` in `components/BenutzerMenu.tsx`).
 *
 * ZWEI MESSUNGEN, weil die Kante mit jedem Kopfinhalt wandert:
 *  - am Arbeitsplatzmaß 1280 × 800 (Akzeptanzkriterium) auf drei Stichprobenseiten;
 *  - an der Kante selbst: der Test sucht je Stufe die größte Breite, bei der der fertig geladene
 *    Kopf zweizeilig steht, und die kleinste einzeilige, und lädt dort neu. Nur dort wird ein
 *    Abruf, der eine Kopfzelle verbreitert, zum Sprung; bei 1280 px allein wäre der Spec seit
 *    LLH-1143 grün gewesen, obwohl der Fehler bestand.
 *
 * ROLLEN (LFH-435, `e2e/AGENTS.md`): ohne Funktion trägt das Etikett den Namen, und die
 * Alarmzentrale im Kopf hängt am Schreibrecht. Die Kante wird deshalb auch als Beobachter gesucht.
 *
 * Gemessen wird die SEITE ab der Navigation: die Summe aller `layout-shift`-Einträge ohne
 * Eingabe-Folge (`cls-kern.ts`), nie kleiner als die CLS nach web.dev.
 */

/**
 * Der „gut"-Schwellwert für CLS am 75. Perzentil (https://web.dev/articles/cls), die Grenze aus
 * dem Akzeptanzkriterium. Als Literal: ein aus dem Produktivcode gelesener Wert prüfte sich selbst.
 */
const CLS_GUT = 0.1;

/**
 * Die Grenze an der Kante — strenger als {@link CLS_GUT}. Der Kopfsprung kostete dort 0,555–0,575,
 * nach dem Fix bleiben 0,0001–0,0002 (der Einsatzname ersetzt das Ladezeichen). Die Zahl ist eine
 * Setzung; wer sie anhebt, hebt eine Zusicherung an, keine Toleranz.
 */
const HAUS_GRENZE = 0.01;

/** Arbeitsplatzmaß der Prüflisten LLH-1060/LLH-1093: ab `xl`, Rail und Panel stehen inline. */
const ARBEITSPLATZ = { width: 1280, height: 800 };

/** Suchbereich der Kante: ab `xl` (1200) steht das Etikett im Kopf, bis Full HD. */
const KANTE_VON = 1200;
const KANTE_BIS = 1920;

/** Die Staffel der Bedien-Leitlinie; der Schlüssel ist die gespeicherte Wahl (`theme/dichte.ts`). */
type Dichte = 'kompakt' | 'komfortabel' | 'handschuh';
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

/**
 * Drei Stichprobenseiten aus drei Kategorien der Rail, jede mit `EinsatzSeite`-Kopf. Der Sprung
 * gehörte dem Rahmen, nicht der Seite; drei Seiten belegen das, eine bewiese es nicht.
 */
const SEITEN = ['ueberblick', 'kraefteuebersicht', 'etb'] as const;

const kopf = (page: Page) => page.locator('[data-lfh="rahmen-kopf"]');

async function storeDichte(page: Page, dichte: Dichte) {
  await page.addInitScript(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
    DICHTE_SCHLUESSEL,
    dichte,
  ] as const);
}

async function createEinsatz(page: Page): Promise<string> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Rahmen CLS ${Date.now()}` },
  });
  expect(r.ok(), `Seeding Einsatz: ${r.status()} ${await r.text()}`).toBeTruthy();
  return String(((await r.json()) as { id: number }).id);
}

/**
 * Vorbereitung jedes Tests: als Admin angemeldet, Einsatz gesät, bei Bedarf als Beobachter
 * weiter; Stufe und Shift-Beobachter vor jedem Dokument.
 */
async function prepare(page: Page, dichte: Dichte, rolle: 'admin' | 'beobachter' = 'admin') {
  await anmeldenAlsAdmin(page);
  const einsatzId = await createEinsatz(page);
  if (rolle === 'beobachter') await wechsleZuRolle(page, 'beobachter', einsatzId);
  await storeDichte(page, dichte);
  await beobachteShifts(page);
  return einsatzId;
}

/**
 * Lädt die Seite und misst bis zur Ruhe. Anker des Endzustands: Seitenkopf und Modulpanel
 * stehen, der Einsatzname hat das Ladezeichen im Kopf ersetzt, kein Ladezeichen im Inhalt.
 */
async function measure(page: Page, pfad: string, dichte: Dichte) {
  await page.goto(pfad);
  // Vorbedingung der Zahl: gemessen wird die Stufe, die der Test nennt.
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
  await expect(page.locator('[data-lfh="seitenkopf"]')).toBeVisible();
  await expect(page.locator('[data-lfh="modul-panel"]')).toBeVisible();
  await expect(kopf(page).locator('[data-lfh="kopf-einsatzname"] .ant-spin')).toHaveCount(0);
  await expect(page.locator('[data-lfh="seiten-inhalt"] [aria-busy="true"]')).toHaveCount(0);
  return ruheShifts(page);
}

const kopfHeight = async (page: Page) => (await kopf(page).boundingBox())!.height;

/**
 * Die Umbruchkante des fertig geladenen Kopfs: `twoRows` ist die größte Breite mit mehr als einer
 * Kopfzeile, `oneRow` die kleinste mit einer. Gesucht per Halbierung über `setViewportSize` im
 * selben Dokument; zwischen `xl` und Full HD hängt der Kopf an keiner weiteren Breitenstufe.
 * `boundingBox` liest das Layout nach dem Resize frisch.
 */
async function findWrapEdge(page: Page) {
  await page.setViewportSize({ width: KANTE_BIS, height: ARBEITSPLATZ.height });
  const rowHeight = await kopfHeight(page);
  const isEinzeilig = async (breite: number) => {
    await page.setViewportSize({ width: breite, height: ARBEITSPLATZ.height });
    return (await kopfHeight(page)) <= rowHeight + 1;
  };
  let twoRows = KANTE_VON;
  let oneRow = KANTE_BIS;
  // Vorbedingung: die Kante liegt im Suchbereich; sonst mäße der Test nichts.
  expect(await isEinzeilig(twoRows), `Kopf bei ${KANTE_VON} px zweizeilig`).toBe(false);
  while (oneRow - twoRows > 1) {
    const mitte = Math.floor((twoRows + oneRow) / 2);
    if (await isEinzeilig(mitte)) oneRow = mitte;
    else twoRows = mitte;
  }
  return { twoRows, oneRow, rowHeight };
}

/*
 * `handschuh` steht hier noch nicht: das Meldebild springt dort bei 1280 px im eigenen Seitenkopf
 * (das Meta kommt nach, die Aktionen brechen um; Seiten-CLS 0,28), nicht im Rahmen. Nachzug
 * LLH-1463; den Rahmen in `handschuh` misst der Fall an der Kante unten.
 */
for (const dichte of ['kompakt', 'komfortabel'] as const) {
  test(`Rahmen bei ${ARBEITSPLATZ.width}×${ARBEITSPLATZ.height}, ${dichte}: CLS < ${CLS_GUT} auf ${SEITEN.length} Seiten`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(ARBEITSPLATZ);
    const einsatzId = await prepare(page, dichte);

    const werte: string[] = [];
    for (const seite of SEITEN) {
      const m = await measure(page, `/einsaetze/${einsatzId}/${seite}`, dichte);
      werte.push(`${seite}: ${bericht(m)}`);
      expect.soft(m.summe, `${seite}, ${dichte}: ${bericht(m)}`).toBeLessThan(CLS_GUT);
    }
    test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
  });
}

/*
 * `kompakt` steht hier nicht: dort lag die Kante vor dem Fix unter `xl`, und darunter trägt das
 * Benutzermenü kein Etikett, nur die Initialen; es gab dort nichts, was nach dem Laden wuchs. Mit
 * der festen Breite liegt sie knapp über `xl` und damit zu nah am Rand des Suchbereichs.
 */
for (const dichte of ['komfortabel', 'handschuh'] as const) {
  for (const rolle of ['admin', 'beobachter'] as const) {
    test(`Rahmen an der Umbruchkante des Kopfs, ${dichte}, ${rolle}: kein Sprung beim Laden`, async ({
      page,
    }) => {
      test.setTimeout(150_000);
      const einsatzId = await prepare(page, dichte, rolle);
      const pfad = `/einsaetze/${einsatzId}/ueberblick`;
      await page.setViewportSize(ARBEITSPLATZ);
      await measure(page, pfad, dichte);
      // Der Rollenzweig ist Vorbedingung der Zahl (LFH-435): ohne ihn mäße der Beobachter-Fall
      // den Admin-Zustand.
      await expect(
        page.getByText('nur Einsatzleitung und Führungspersonal', { exact: true }),
      ).toHaveCount(rolle === 'beobachter' ? 1 : 0);
      const kante = await findWrapEdge(page);

      const werte: string[] = [`Kante ${kante.twoRows}/${kante.oneRow} px`];
      for (const [breite, zeilen] of [
        [kante.twoRows, 'zweizeilig'],
        [kante.oneRow, 'einzeilig'],
      ] as const) {
        await page.setViewportSize({ width: breite, height: ARBEITSPLATZ.height });
        const m = await measure(page, pfad, dichte);
        // Vorbedingung: nach dem Neuladen steht der Kopf wie bei der Suche, sonst läge die
        // Messung neben der Kante.
        const hoehe = await kopfHeight(page);
        expect(
          hoehe > kante.rowHeight + 1 ? 'zweizeilig' : 'einzeilig',
          `Kopf bei ${breite} px`,
        ).toBe(zeilen);
        werte.push(`${breite} px (${zeilen}): ${bericht(m)}`);
        expect
          .soft(m.summe, `${dichte}, ${rolle} bei ${breite} px (${zeilen}): ${bericht(m)}`)
          .toBeLessThanOrEqual(HAUS_GRENZE);
      }
      test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
    });
  }
}
