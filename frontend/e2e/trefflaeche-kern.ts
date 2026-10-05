import { expect, type Locator, type Page } from '@playwright/test';
import { ADMIN, ADMIN_PW } from './rollen-kern';

/**
 * Messhelfer der Trefflächen-Gates (Bedien-Leitlinie, Gate 3 und Prüflistenzeile 2), geteilt
 * von `gate3-trefflaeche.spec.ts` und `trefflaeche-pruefflaechen.spec.ts` (LFH-724). Verschoben,
 * nicht neu geschrieben: die Begründungen der Messregeln stehen im Kopf von
 * `gate3-trefflaeche.spec.ts` (Mengen statt Einzelknoten, Untergrenze statt Gleichheit, Böden
 * als Literale, Stufe gespeichert statt per `hasTouch`). Wer einen Helfer braucht, nimmt ihn
 * von hier statt einer Kopie — Muster `rollen-kern.ts`.
 */

/** Die Dichte-Staffel als handgeschriebene Zahlen — siehe Kopfkommentar. */
export const STAFFEL = [
  { dichte: 'kompakt', soll: 30 },
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

/**
 * Subpixel-Spielraum: `boundingBox()` liefert Fließkomma, und Chromium rundet unter Last
 * anders (47,99999809 gegen 48). Ein halbes Pixel trennt die Stufen weiterhin klar.
 */
export const SUBPIXEL = 0.5;

/** Fükw-Maß aus der Bedien-Leitlinie (A1, Gate 1). */
export const FUEKW = { width: 1366, height: 768 };

/** Handschirm-Maß aus A1 — unter antds `lg`, also der Drawer-Zweig des Navigationsrahmens. */
export const HANDSCHIRM = { width: 390, height: 844 };

/** Schlüssel aus `theme/ThemeModeProvider.tsx`. Bewusst literal — Vertrag, kein Import. */
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

export async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(ADMIN_PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Einsatz per API: acht Einsätze über die UI wären 32 Formularaktionen ohne Erkenntnisgewinn. */
export async function einsatzAnlegen(page: Page, bezeichnung: string): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(
    antwort.ok(),
    `Seeding Einsatz „${bezeichnung}": ${antwort.status()} ${await antwort.text()}`,
  ).toBeTruthy();
  const { id } = (await antwort.json()) as { id: number };
  return String(id);
}

export async function anlegen(
  page: Page,
  einsatzId: string,
  pfad: string,
  data: unknown,
  was: string,
) {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
  expect(antwort.ok(), `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
}

/**
 * Stellt die Bediendichte und lädt neu — `ThemeModeProvider` liest den Speicher nur beim
 * Montieren. Die `data-dichte`-Wache trennt „Ziel zu klein" von „Stufe nicht angekommen".
 */
export async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
    DICHTE_SCHLUESSEL,
    dichte,
  ] as const);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

/** Höhe GENAU EINES Knotens, subpixel-tolerant gegen die Sollstufe (Untergrenze). */
export async function haeltStufe(ziel: Locator, soll: number, name: string): Promise<number> {
  await expect(ziel, `${name}: genau ein Knoten muss gemessen werden`).toHaveCount(1);
  const kasten = await ziel.boundingBox();
  expect(kasten, `${name}: kein Kasten messbar`).not.toBeNull();
  expect(
    kasten!.height,
    `${name} (gemessen ${kasten!.height}px hoch, Soll ≥ ${soll})`,
  ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
  return kasten!.height;
}

/**
 * Wartet, bis eine Menge mindestens `mindestens` Knoten trägt, und liefert dann ihre Zahl.
 * Gezählt wird wiederholt, nicht einmal (LFH-885): `stelleDichte` lädt die Seite neu, und eine
 * Liste aus einer Query steht danach noch im Ladezustand (0 statt 9 Knöpfe). Weniger als
 * `mindestens` bleibt bis zum Expect-Timeout rot — ein echter Leerzustand fällt weiter auf.
 */
export async function mindestensKnoten(
  ziele: Locator,
  mindestens: number,
  name: string,
): Promise<number> {
  await expect
    .poll(() => ziele.count(), { message: `${name}: mindestens ${mindestens} Knoten erwartet` })
    .toBeGreaterThanOrEqual(mindestens);
  return ziele.count();
}

/**
 * Höhe JEDES Knotens einer Menge. `mindestens` ist die Zahl, die das Seeding garantiert —
 * trifft der Locator weniger, misst er einen Leer- oder Ladezustand. Zurück kommt das
 * kleinste Maß für die Anmerkung am Test.
 */
export async function alleHaltenStufe(
  ziele: Locator,
  soll: number,
  name: string,
  mindestens: number,
): Promise<number> {
  const anzahl = await mindestensKnoten(ziele, mindestens, name);
  let kleinstes = Number.POSITIVE_INFINITY;
  for (let i = 0; i < anzahl; i += 1) {
    const kasten = await ziele.nth(i).boundingBox();
    expect(kasten, `${name} #${i + 1}: kein Kasten messbar`).not.toBeNull();
    expect(
      kasten!.height,
      `${name} #${i + 1} (gemessen ${kasten!.height}px hoch, Soll ≥ ${soll})`,
    ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
    kleinstes = Math.min(kleinstes, kasten!.height);
  }
  return kleinstes;
}

/** Wortanfang aller Rechtehinweise der Einsatzmodule (aktiver Einsatz, ohne Schreibrecht). */
export const NUR_SCHREIBENDE = /^Nur Einsatzleitung und Führungspersonal/;

/** Der Rechtehinweis des Nur-Lese-Zweigs (`RechteHinweis`, antd `Alert` mit `role="alert"`). */
export async function rechteHinweisSteht(page: Page) {
  await expect(
    page.getByRole('alert').filter({ hasText: NUR_SCHREIBENDE }),
    'Vorbedingung: der Rechtehinweis des Nur-Lese-Zweigs steht',
  ).toBeVisible();
}

/**
 * Eine gesperrte Primäraktion im Seitenkopf: gesperrt statt versteckt, also MUSS sie da und
 * gesperrt sein — und hält trotzdem die Stufe (ein gesperrtes Ziel ist ein sichtbares Ziel).
 */
export async function gesperrtHaeltStufe(
  ziel: Locator,
  soll: number,
  name: string,
): Promise<number> {
  await expect(ziel, `Vorbedingung: ${name} steht gesperrt`).toBeDisabled();
  return haeltStufe(ziel, soll, name);
}

/**
 * Abstand zwischen zwei Treffflächen nach der Bedien-Leitlinie (Kriterium 2): komfortabel
 * ≥ 8 px (Material), handschuh ≥ 16 px (MIL-STD-1472F Fig. 24, abgeleitet), kompakt die
 * Spacing-Ausnahme. Literale aus demselben Grund wie die Staffel oben.
 */
export const ZIELABSTAND = { kompakt: null, komfortabel: 8, handschuh: 16 } as const;

/** Boden der Menüeinträge eines `Dropdown`: antd gibt ihnen `controlHeightSM` (24 / 48 / 72). */
export const BODEN_MENUE = { kompakt: 24, komfortabel: 48, handschuh: 72 } as const;

/** Boden der Kartenknöpfe: `kartenKnopfKante = max(32, controlHeight)` in
 *  `KartenUeberlagerung.tsx` — in `kompakt` also 32, nicht 30. Literal, kein Import. */
export const BODEN_KARTE = { kompakt: 32, komfortabel: 48, handschuh: 72 } as const;

/**
 * Kurze Achse JEDES Knotens einer Menge: `min(Breite, Höhe) ≥ soll`. Zurück kommen das
 * kleinste Maß (für die Anmerkung und die Gegenprobe) und das größte Maß der LANGEN Achse
 * (für eine Obergrenze in `kompakt`).
 */
export async function kurzeAchseHaelt(
  ziele: Locator,
  soll: number,
  name: string,
  mindestens: number,
): Promise<{ kleinstes: number; groesstes: number }> {
  const anzahl = await mindestensKnoten(ziele, mindestens, name);
  let kleinstes = Number.POSITIVE_INFINITY;
  let groesstes = 0;
  for (let i = 0; i < anzahl; i += 1) {
    const kasten = await ziele.nth(i).boundingBox();
    expect(kasten, `${name} #${i + 1}: kein Kasten messbar`).not.toBeNull();
    const kurz = Math.min(kasten!.width, kasten!.height);
    expect(
      kurz,
      `${name} #${i + 1} (gemessen ${kasten!.width}×${kasten!.height}px, kurze Achse Soll ≥ ${soll})`,
    ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
    kleinstes = Math.min(kleinstes, kurz);
    groesstes = Math.max(groesstes, kasten!.width, kasten!.height);
  }
  return { kleinstes, groesstes };
}

/**
 * Höhe eines animiert aufklappenden Menüeintrags, erst wenn der Kasten STEHT (zwei gleiche
 * Lesungen). Mitten in der `scaleY`-Animation gelesen wäre er in `kompakt` zu klein, und die
 * Gegenprobe „kompakt < handschuh" grün durch zu frühes Hinsehen.
 */
export async function ruhigeHoehe(ziel: Locator, name: string): Promise<number> {
  let vorher = -1;
  let jetzt = 0;
  await expect
    .poll(
      async () => {
        vorher = jetzt;
        jetzt = (await ziel.boundingBox())?.height ?? 0;
        return jetzt > 0 && jetzt === vorher;
      },
      { message: `${name}: der Kasten kommt nicht zur Ruhe`, intervals: [100, 150, 200] },
    )
    .toBe(true);
  return jetzt;
}

/** Legt die Gegenprobe für eine Zielsorte fest: kompakt STRENG kleiner als handschuh. */
export function gegenprobe(je: Map<string, number>, sorte: string) {
  const k = je.get(`kompakt ${sorte}`);
  const h = je.get(`handschuh ${sorte}`);
  expect(k, `${sorte}: kompakt nicht gemessen`).toBeDefined();
  expect(h, `${sorte}: handschuh nicht gemessen`).toBeDefined();
  expect(
    k!,
    `${sorte}: die Stufe muss durchschlagen — kompakt ${k} px, handschuh ${h} px`,
  ).toBeLessThan(h!);
}
