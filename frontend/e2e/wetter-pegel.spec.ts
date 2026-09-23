import { expect, test, type Locator, type Page } from '@playwright/test';
import { pruefe } from './kontrast-kern';

/**
 * Browser-Nachweise für das Fachmodul „Wetter & Pegel" (LFH-633,
 * `docs/superpowers/specs/2026-09-23-lfh-633-pruefliste.md`).
 *
 * Gemessen wird, was jsdom nicht rechnet: dass „Stand unbekannt" wirklich SICHTBAR ist und
 * die Pegelwerte daneben stehen bleiben (AK), kein Querlauf auf 1366/1024/390 px (Gate 1),
 * Trefflächen über die Dichte-Staffel (Gate 3) und der Kontrast der Warnstufen-Chips in
 * beiden Modi (Kriterium 5: Tag ≥ 7 : 1, Nacht ≥ 5 : 1).
 *
 * HERMETISCH: Pegel, Verlauf und Wetter kommen per `page.route` aus Literalen. Ohne das ginge
 * das Backend an PEGELONLINE und Bright Sky — ein Nachweis, der am Netz eines Fremddienstes
 * hängt, misst dessen Erreichbarkeit, nicht die Oberfläche. Die Wire-Form ist dieselbe, die
 * `api/types.generated.ts` beschreibt.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const THEMA_SCHLUESSEL = 'lifeline-hub.theme';
const SUBPIXEL = 0.5;
const MIN = 60_000;

/** Böden als Literale (Muster `gate3-trefflaeche`): `controlHeight` 30 / 48 / 72. */
const STAFFEL = [
  { dichte: 'kompakt', soll: 30 },
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;

const BREITEN = [
  { breite: 1366, hoehe: 768 },
  { breite: 1024, hoehe: 768 },
  { breite: 390, hoehe: 844 },
] as const;

const vor = (ms: number) => new Date(Date.now() - ms).toISOString();
const nach = (ms: number) => new Date(Date.now() + ms).toISOString();

/** Absichtlich lange Namen: der Querlauf-Nachweis soll am schwierigsten Fall messen. */
const PEGEL = [
  {
    id: 1,
    station_uuid: '47174d8f-1b8e-4599-8a59-b580dd55bc87',
    name: 'HANN. MÜNDEN-LETZTER HELLER UNTERHALB DER VEREINIGUNG',
    gewaesser: 'WESER',
    reihenfolge: 0,
    messung: { wasserstand_cm: 684, zeitpunkt: vor(10 * MIN), trend_cm_pro_h: 9.2 },
    prognose: {
      hoechststand_cm: 710,
      zeitpunkt: nach(4 * 60 * MIN)
        .slice(0, 19)
        .replace('T', ' '),
      gesetzt_at: vor(MIN).slice(0, 19).replace('T', ' '),
    },
  },
  {
    id: 2,
    station_uuid: '5f9c1b54-3c41-4d93-bb48-2b7c7c3f5a61',
    name: 'WAHNHAUSEN',
    gewaesser: 'FULDA',
    reihenfolge: 1,
  },
];

const VERLAUF = [
  {
    pegel_id: 1,
    punkte: Array.from({ length: 96 }, (_, i) => ({
      zeitpunkt: vor((95 - i) * 15 * MIN),
      wasserstand_cm: 560 + i * 1.3,
    })),
  },
  { pegel_id: 2, punkte: [] },
];

const WARNUNG_JETZT = {
  stufe: 'maessig',
  ereignis: 'STURMBÖEN',
  ueberschrift: 'Amtliche WARNUNG vor STURMBÖEN mit ausgesprochen langer Überschrift der Quelle',
  beschreibung: 'Es treten Sturmböen mit Geschwindigkeiten um 70 km/h aus westlicher Richtung auf.',
  handlungsempfehlung:
    'Achten Sie besonders auf herabstürzende Äste und umherfliegende Gegenstände.',
  beginn: vor(60 * MIN),
  ende: nach(120 * MIN),
};
const WARNUNG_ANGEKUENDIGT = {
  stufe: 'schwer',
  ereignis: 'ORKANARTIGE BÖEN',
  ueberschrift: 'Amtliche UNWETTERWARNUNG vor ORKANARTIGEN BÖEN',
  beginn: nach(180 * MIN),
  ende: nach(300 * MIN),
};

const wetter = (warnAlterMin = 2) => ({
  ort: {
    name: 'Samtgemeinde Sottrum-Hellwege-Horstedt-Reeßum',
    kreis: 'Rotenburg (Wümme)',
    land: 'Niedersachsen',
  },
  warnungen: {
    zustand: 'ok',
    abgerufen_at: vor(warnAlterMin * MIN),
    daten: [WARNUNG_ANGEKUENDIGT, WARNUNG_JETZT],
  },
  vorhersage: {
    zustand: 'ok',
    abgerufen_at: vor(5 * MIN),
    daten: {
      station: 'BREMEN',
      entfernung_m: 4200,
      stunden: Array.from({ length: 25 }, (_, i) => ({
        zeitpunkt: new Date(
          Math.floor(Date.now() / 3_600_000) * 3_600_000 + i * 3_600_000,
        ).toISOString(),
        temperatur_c: -12.4,
        niederschlag_mm: 12.6,
        niederschlag_wahrscheinlichkeit: 100,
        wind_kmh: 118,
        boeen_kmh: 142,
        windrichtung_grad: 292,
      })),
    },
  },
});

const AUSFALL = { warnungen: { zustand: 'ausfall' }, vorhersage: { zustand: 'ausfall' } };

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, bezeichnung: string): Promise<string> {
  const r = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(r.ok(), `Seeding Einsatz: ${r.status()} ${await r.text()}`).toBeTruthy();
  return String(((await r.json()) as { id: number }).id);
}

/** Stellt Pegel, Verlauf und Wetter auf Literale. */
async function stelle(page: Page, einsatzId: string, wetterAntwort: unknown) {
  await page.route(`**/api/einsaetze/${einsatzId}/pegel`, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: PEGEL }) : route.continue(),
  );
  await page.route(`**/api/einsaetze/${einsatzId}/pegel/verlauf`, (route) =>
    route.fulfill({ json: VERLAUF }),
  );
  await page.route(`**/api/einsaetze/${einsatzId}/wetter`, (route) =>
    route.fulfill({ json: wetterAntwort }),
  );
}

async function oeffne(page: Page, einsatzId: string) {
  await page.goto(`/einsaetze/${einsatzId}/wetter-pegel`);
  await expect(page.locator('[data-lfh="pegel-zeile"]').first()).toBeVisible();
}

async function haeltStufe(ziel: Locator, soll: number, name: string) {
  await expect(ziel, `${name}: genau ein Knoten`).toHaveCount(1);
  const k = await ziel.boundingBox();
  expect(k, `${name}: kein Kasten`).not.toBeNull();
  expect(k!.height, `${name}: ${k!.height}px, Soll ≥ ${soll}`).toBeGreaterThanOrEqual(
    soll - SUBPIXEL,
  );
  return k!.height;
}

test('Quellausfall: „Stand unbekannt" sichtbar, ohne Liste — die Pegelwerte bleiben stehen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Wetter Ausfall ${Date.now()}`);
  await stelle(page, einsatzId, AUSFALL);
  await oeffne(page, einsatzId);

  const unbekannt = page.locator('[data-lfh="wetter-stand-unbekannt"]');
  await expect(unbekannt).toHaveCount(2);
  for (const u of await unbekannt.all()) {
    await expect(u).toBeInViewport();
    await expect(u).toContainText('Stand unbekannt');
  }
  await expect(page.locator('[data-lfh="wetter-warnung"]')).toHaveCount(0);
  await expect(page.locator('[data-lfh="wetter-stunde"]')).toHaveCount(0);
  // Der Pegel daneben ist unberührt: Wert und Verlauf stehen.
  const leit = page.locator('[data-lfh="pegel-zeile"]').first();
  await expect(leit).toContainText('6,84');
  await expect(leit.getByRole('img', { name: /^Verlauf 24 h:/ })).toBeVisible();
});

test('Alter Warnstand: Liste bleibt, mit „veraltet" und Abrufzeit', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Wetter veraltet ${Date.now()}`);
  await stelle(page, einsatzId, wetter(45));
  await oeffne(page, einsatzId);
  await expect(page.locator('[data-lfh="wetter-veraltet"]')).toContainText('veraltet');
  await expect(page.locator('[data-lfh="wetter-warnung"]')).toHaveCount(2);
});

test('Gate 1: kein waagerechter Querlauf auf 1366, 1024 und 390 px — auch aufgeklappt', async ({
  page,
}) => {
  test.slow();
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Wetter Gate1 ${Date.now()}`);
  await stelle(page, einsatzId, wetter());
  const messwerte: string[] = [];
  for (const { breite, hoehe } of BREITEN) {
    await page.setViewportSize({ width: breite, height: hoehe });
    await oeffne(page, einsatzId);
    await expect(page.locator('[data-lfh="wetter-stunde"]')).toHaveCount(8);
    // Aufgeklappt ist der längste Zustand der Seite.
    await page.getByRole('button', { name: 'Beschreibung und Handlungsempfehlung' }).click();
    const ueber = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    messwerte.push(`${breite}: ${ueber}px`);
    expect(ueber, `Querlauf bei ${breite}px`).toBeLessThanOrEqual(1);
  }
  test.info().annotations.push({ type: 'messwert', description: messwerte.join(' | ') });
});

test('Gate 3: Primäraktion und Beschreibungs-Umschalter folgen der Staffel 30 / 48 / 72 px', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Wetter Gate3 ${Date.now()}`);
  await stelle(page, einsatzId, wetter());
  await oeffne(page, einsatzId);
  const gemessen: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
      DICHTE_SCHLUESSEL,
      dichte,
    ] as const);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
    const primaer = await haeltStufe(
      page
        .locator('[data-lfh="seitenkopf-aktionen"]')
        .getByRole('button', { name: 'Pegel festlegen' }),
      soll,
      `Primäraktion ${dichte}`,
    );
    const umschalter = await haeltStufe(
      page.getByRole('button', { name: 'Beschreibung und Handlungsempfehlung' }),
      soll,
      `Umschalter ${dichte}`,
    );
    gemessen.push(`${dichte}: ${primaer}/${umschalter}`);
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

for (const modus of ['light', 'dark'] as const) {
  test(`Kontrast der Warnstufen-Chips im Modus ${modus}`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Wetter Kontrast ${Date.now()}`);
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEMA_SCHLUESSEL, modus]);
    await stelle(page, einsatzId, wetter());
    await oeffne(page, einsatzId);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    const boden = modus === 'light' ? 7 : 5;
    for (const stufe of ['maessig', 'schwer']) {
      const chip = page
        .locator(`[data-lfh="wetter-warnung"][data-stufe="${stufe}"] [data-lfh="status-chip"] span`)
        .last();
      await pruefe(chip, boden, `${modus} ${stufe}`);
    }
  });
}
