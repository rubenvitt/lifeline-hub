import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmelden, einsatzAnlegen } from './trefflaeche-kern';

/**
 * Abstände der `InlineAngabe` je Dichtestufe (LLH-1271, Bedien-Leitlinie Kriterium 2, „Abstand
 * zwischen Zielen“: komfortabel ≥ 8, handschuh ≥ 16, kompakt Spacing-Ausnahme am Fükw).
 *
 * Zwei Fugen in der Personalkarte, dazu der Tabellenzweig am Fükw:
 *  - **Kartenfelder:** Der gefüllte Wert („Position zu … bearbeiten“) rückt am Anfang um
 *    `paddingSM` vor, damit sein Text unter der Augenbraue steht; die leere Aufforderung („Fahrzeug
 *    zu … eintragen“) rückt nicht vor. Steht ein gefüllter Wert hinter einer Aufforderung, blieben
 *    zwischen beiden nur `padding − paddingSM` = 7 / 10 px. Gesät ist genau diese Folge (Einheit
 *    gefüllt, Fahrzeug leer, Position gefüllt), gemessen bei 720 px, wo alle drei Felder in einer
 *    Reihe stehen, und bei 390 px; jedes Paar von Zielen in den Feldern zählt.
 *  - **Speichern ↔ Abbrechen** der offenen Angabe: `size="middle"` (11 / 18 / 26). Die Klasse
 *    prüft `InlineAngabe.test.tsx`; ob die Fuge im Browser ankommt, belegt nur dieser Lauf.
 *  - **Kein Querlauf** mit offener Angabe, bei 390 px und am Fükw (1366 × 768).
 *  - **Kein Umbruch des Werts** bei 720 px: der Wertknopf steht um `paddingSM` vor und durfte
 *    trotzdem nur 100 % des Kartenfelds breit sein, „Rettungsstaffel Süd“ brach zweizeilig um.
 *
 * Mutationsproben (von Hand, je rot gesehen, dann zurückgedreht):
 *  - alte Fuge `gap: token.padding` in `kartenFelderStil` (`Datensicht.tsx`): rot in
 *    „Kartenfelder“ (komfortabel 7, handschuh 10).
 *  - `size="middle"` am `<Space>` der Angabe entfernt: rot in „Speichern ↔ Abbrechen“.
 *  - `maxWidth: '100%'` statt `calc(100% + paddingSM)` in `wertAngabeStil`: rot in „Kartenfeld“
 *    (der Wert bricht um).
 *
 * Seeding per API als Admin; die Fugen hängen an keiner Rolle, nur am Schreibrecht, ohne das
 * es keine Angabe zum Bearbeiten gibt.
 */

const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const SUBPIXEL = 0.5;
const HANDSCHIRM = { width: 390, height: 844 };
/** Noch Kartenzweig (unter `md`), aber breit genug für drei Felder in einer Reihe. */
const KARTE_BREIT = { width: 720, height: 900 };
const FUEKW = { width: 1366, height: 768 };

/** Böden als Literale, nicht aus `theme/tokens` — sonst prüfte der Test den Token gegen sich. */
const STAFFEL = [
  { dichte: 'kompakt', soll: 30, ziel: 0 },
  { dichte: 'komfortabel', soll: 48, ziel: 8 },
  { dichte: 'handschuh', soll: 72, ziel: 16 },
] as const;

const KRAFT = 'Abstandsprobe, Henrike';
const EINHEIT = 'Rettungsstaffel Süd';

async function post(page: Page, pfad: string, data: unknown) {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as { id: number };
}

/** Stellt die Stufe und lädt neu: `ThemeModeProvider` liest den Speicher nur beim Montieren. */
async function setDichte(page: Page, dichte: string) {
  await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
    DICHTE_SCHLUESSEL,
    dichte,
  ] as const);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

type Kasten = { x: number; y: number; width: number; height: number };

async function kasten(ziel: Locator): Promise<Kasten> {
  await expect(ziel).toHaveCount(1);
  const k = await ziel.boundingBox();
  expect(k, 'kein Kasten messbar').not.toBeNull();
  return k!;
}

/** Lücke zwischen zwei Kästen: die größte Trennung auf einer Achse (negativ = Überlappung). */
function luecke(a: Kasten, b: Kasten): number {
  return Math.max(
    b.x - (a.x + a.width),
    a.x - (b.x + b.width),
    b.y - (a.y + a.height),
    a.y - (b.y + b.height),
  );
}

async function ohneQuerlauf(page: Page, lauf: string) {
  const { breit, sicht } = await page.evaluate(() => ({
    breit: document.documentElement.scrollWidth,
    sicht: document.documentElement.clientWidth,
  }));
  expect(breit, `Querlauf ${lauf}: ${breit}px Inhalt bei ${sicht}px Breite`).toBeLessThanOrEqual(
    sicht,
  );
}

/** Öffnet die Einheitsangabe und misst die Fuge zwischen Speichern und Abbrechen. */
async function knopffuge(page: Page, bereich: Locator, ziel: number, lauf: string) {
  await bereich
    .getByRole('button', { name: `Einheit zu ${KRAFT} bearbeiten`, exact: true })
    .click();
  const speichern = await kasten(
    bereich.getByRole('button', { name: `Einheit zu ${KRAFT} speichern`, exact: true }),
  );
  const abbrechen = await kasten(
    bereich.getByRole('button', {
      name: `Bearbeitung von Einheit zu ${KRAFT} abbrechen`,
      exact: true,
    }),
  );
  const fuge = luecke(speichern, abbrechen);
  expect(fuge, `Speichern ↔ Abbrechen ${lauf}: ${fuge.toFixed(1)}px`).toBeGreaterThanOrEqual(
    ziel - SUBPIXEL,
  );
  await ohneQuerlauf(page, `${lauf}, Angabe offen`);
  return fuge;
}

/**
 * Kleinste Lücke zwischen zwei Zielen in den Feldern der einen Personalkarte. Vorbedingung ist die
 * gesäte Folge: gefüllt, Aufforderung, gefüllt — sonst mäße der Lauf den Fall nicht, um den es geht.
 * Bei 720 px ist Platz genug: dort steht jeder Wert einzeilig, also genau in der Stufenhöhe.
 */
async function kartenfelder(
  page: Page,
  soll: number,
  ziel: number,
  lauf: string,
  einzeilig: boolean,
) {
  const karte = page.locator('[data-lfh="datensicht-karte"]');
  await expect(karte).toHaveCount(1);
  await expect(
    karte.getByRole('button', { name: `Einheit zu ${KRAFT} bearbeiten`, exact: true }),
  ).toHaveText(new RegExp(EINHEIT));
  await expect(
    karte.getByRole('button', { name: `Fahrzeug zu ${KRAFT} eintragen`, exact: true }),
  ).toHaveCount(1);
  await expect(
    karte.getByRole('button', { name: `Position zu ${KRAFT} bearbeiten`, exact: true }),
  ).toHaveCount(1);

  const ziele = karte.locator('[data-lfh="datensicht-feld"]').getByRole('button');
  await expect(ziele).toHaveCount(3);
  const kaesten = await Promise.all([0, 1, 2].map((i) => kasten(ziele.nth(i))));
  let kleinste = Infinity;
  for (let i = 0; i < kaesten.length; i += 1) {
    for (let j = i + 1; j < kaesten.length; j += 1) {
      kleinste = Math.min(kleinste, luecke(kaesten[i], kaesten[j]));
    }
  }
  expect(
    kleinste,
    `Kartenfelder (${lauf}): kleinste Lücke zwischen Zielen ${kleinste.toFixed(1)}px`,
  ).toBeGreaterThanOrEqual(ziel - SUBPIXEL);
  if (einzeilig) {
    for (const [i, k] of kaesten.entries()) {
      expect(
        k.height,
        `Kartenfeld ${i + 1} (${lauf}): ${k.height}px hoch, Soll ${soll} — der Wert bricht um`,
      ).toBeLessThanOrEqual(soll + SUBPIXEL);
    }
  }
  return kleinste;
}

test('InlineAngabe hält die Dichte-Staffel: Kartenfelder, Speichern ↔ Abbrechen, kein Querlauf', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await anmelden(page);
  // Per API: der Spec prüft den Anlegedialog nicht (frontend/e2e/AGENTS.md, LFH-1114).
  const einsatzId = await einsatzAnlegen(page, `E2E InlineAngabe Abstände ${Date.now()}`);
  const basis = `/api/einsaetze/${einsatzId}`;
  const einheit = await post(page, `${basis}/einheiten`, { name: EINHEIT });
  const kraft = await post(page, `${basis}/personal`, {
    adhoc: { name: KRAFT, traegerorganisation: 'DRK Kreisverband' },
  });
  const zuordnung = await page.request.put(`${basis}/einheiten/${einheit.id}/personal/${kraft.id}`);
  expect(zuordnung.ok(), await zuordnung.text()).toBeTruthy();
  const position = await page.request.patch(`${basis}/personal/${kraft.id}`, {
    data: { staerke_position: 'fuehrer' },
  });
  expect(position.ok(), await position.text()).toBeTruthy();

  const gemessen: string[] = [];
  for (const { dichte, soll, ziel } of STAFFEL) {
    // ── Kartenzweig: Felder bei 720 und 390 px, Knöpfe und Querlauf bei 390 px
    await page.setViewportSize(KARTE_BREIT);
    await page.goto(`/einsaetze/${einsatzId}/personal`);
    await setDichte(page, dichte);
    const breit = await kartenfelder(page, soll, ziel, `720 px, ${dichte}`, true);
    await page.setViewportSize(HANDSCHIRM);
    const schmal = await kartenfelder(page, soll, ziel, `390 px, ${dichte}`, false);
    gemessen.push(`${dichte}: Kartenfelder ${breit.toFixed(1)} / ${schmal.toFixed(1)}px`);
    await ohneQuerlauf(page, `390 px, ${dichte}`);
    const karte = page.locator('[data-lfh="datensicht-karte"]');
    const karteFuge = await knopffuge(page, karte, ziel, `(390 px, ${dichte})`);
    gemessen.push(`${dichte}: Knöpfe Karte ${karteFuge.toFixed(1)}px`);

    // ── Tabellenzweig, Fükw
    await page.setViewportSize(FUEKW);
    await page.goto(`/einsaetze/${einsatzId}/personal`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
    const zeile = page.locator('tr.ant-table-row', { hasText: KRAFT });
    await expect(zeile).toHaveCount(1);
    await ohneQuerlauf(page, `Fükw, ${dichte}`);
    const tabelleFuge = await knopffuge(page, zeile, ziel, `(Fükw, ${dichte})`);
    gemessen.push(`${dichte}: Knöpfe Tabelle ${tabelleFuge.toFixed(1)}px`);
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});
