import { expect, test, type Page } from '@playwright/test';
import { einsatzDialogOeffnen } from './einsatz-kern';
import { ANSICHT_SCHLUESSEL, BAUM_SCHLUESSEL } from './leisten-kern';

/**
 * Ebenenbaum der Kartenleiste (LLH-1028), gemessen im echten Layout:
 *
 * 1. Bei 1440 × 900 ist die Leiste ohne Rollen bedienbar, wenn alle Gruppen bis auf eine zu sind —
 *    je Gruppe einzeln geprüft, samt Kopf (Kartenansicht, „Ebene suchen“) und „Ausgewählt“. Das
 *    Gegenstück „alle offen rollt“ belegt, dass die Messung eine Rollfläche überhaupt erkennt.
 * 2. Im Handschuh (1280 px, Leiste 300 px) stehen die Segmente „Ebenen · Objekte“ in einer Zeile
 *    und sind ≥ 72 px; Baumzeilen, Gruppenköpfe und Gruppenschalter halten die Stufe.
 *
 * Gesät wird ein Einsatz mit einem Bild-Hintergrund: die Gruppe „Hintergrund“ trägt dann eine
 * Bildzeile mit Deckkraft und Ansichtszuordnung — mehr als der Demo-Einsatz, der keins hat.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const SUBPIXEL = 0.5;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Alle Gruppen des Baums; Untergruppen behalten ihre Vorgabe (Warnungen, Bilder offen). */
const GRUPPEN = ['kraefte', 'lage', 'betroffene', 'fachebenen', 'hintergrund'] as const;
const ALLE_ZU = Object.fromEntries(GRUPPEN.map((g) => [g, false]));

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzMitBild(page: Page): Promise<string> {
  await einsatzDialogOeffnen(page);
  await page.getByLabel('Bezeichnung').fill(`E2E Ebenenbaum ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)/)![1];
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/karte/hintergrundbilder`, {
    multipart: {
      datei: { name: 'plan.png', mimeType: 'image/png', buffer: PNG },
      ecken: JSON.stringify([
        [9.9, 52.3],
        [9.91, 52.3],
        [9.91, 52.29],
        [9.9, 52.29],
      ]),
      name: 'Lageplan Nord',
    },
  });
  expect(antwort.ok(), `Seeding Bild: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return einsatzId;
}

/** Setzt Klappzustand (und Dichte) vor dem Laden und öffnet die Karte. */
async function oeffne(
  page: Page,
  einsatzId: string,
  gruppen: Record<string, boolean>,
  dichte?: string,
) {
  await page.evaluate(
    ([baum, ansicht, wert, dichteSchluessel, dichteWert]) => {
      localStorage.setItem(baum, wert);
      localStorage.setItem(ansicht, 'ebenen');
      if (dichteWert) localStorage.setItem(dichteSchluessel, dichteWert);
    },
    [BAUM_SCHLUESSEL, ANSICHT_SCHLUESSEL, JSON.stringify(gruppen), DICHTE_SCHLUESSEL, dichte ?? ''],
  );
  await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
  await expect(page.getByRole('tabpanel', { name: 'Ebenen' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const rollflaeche = (page: Page) => page.locator('[data-lfh="leisten-rollflaeche"]');

/**
 * `inhalt`: Unterkante des letzten sichtbaren Kinds über der Oberkante der Rollfläche — anders als
 * `scrollHeight` (nie kleiner als die Fläche) zeigt es auch die Reserve.
 */
async function ueberhang(page: Page): Promise<{ inhalt: number; sicht: number; rollt: boolean }> {
  return rollflaeche(page).evaluate((el) => {
    const oben = el.getBoundingClientRect().top - el.scrollTop;
    const unten = Math.max(
      ...Array.from(el.children)
        .filter((k) => !(k as HTMLElement).hidden)
        .map((k) => k.getBoundingClientRect().bottom),
    );
    return {
      inhalt: Math.round(unten - oben),
      sicht: el.clientHeight,
      rollt: el.scrollHeight > el.clientHeight + 1,
    };
  });
}

test('1440 × 900: mit einer offenen Gruppe ist die Leiste ohne Rollen bedienbar', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await anmelden(page);
  const einsatzId = await einsatzMitBild(page);

  // Gegenprobe zuerst: alle Gruppen und Untergruppen offen rollt — sonst misst `ueberhang` nichts.
  const alleOffen = Object.fromEntries(
    [...GRUPPEN, 'warnungen', 'wasser', 'umwelt', 'verkehr', 'bilder'].map((g) => [g, true]),
  );
  await oeffne(page, einsatzId, alleOffen);
  await expect(
    page.locator('section[data-paneel="bilder"]').getByText('Lageplan Nord'),
  ).toBeVisible();
  const voll = await ueberhang(page);
  expect(voll.rollt, 'Vorbedingung: alle Gruppen offen rollt die Leiste').toBe(true);
  expect(voll.inhalt, 'Vorbedingung: die Inhaltsmessung sieht den Überhang').toBeGreaterThan(
    voll.sicht + 1,
  );

  for (const gruppe of GRUPPEN) {
    await oeffne(page, einsatzId, { ...ALLE_ZU, [gruppe]: true });
    const kopf = page.locator(`section[data-paneel="${gruppe}"] button[aria-expanded]`).first();
    await expect(kopf, `${gruppe}: Vorbedingung offen`).toHaveAttribute('aria-expanded', 'true');
    const m = await ueberhang(page);
    test.info().annotations.push({
      type: 'messwert',
      description: `${gruppe} offen: Inhalt ${m.inhalt}px, sichtbar ${m.sicht}px`,
    });
    expect(m.rollt, `${gruppe} offen: Leiste rollt (${m.inhalt} > ${m.sicht})`).toBe(false);
  }
});

test('Handschuh bei 1280 px: Segmente in einer Zeile, Baumziele halten 72 px', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await anmelden(page);
  const einsatzId = await einsatzMitBild(page);
  await oeffne(page, einsatzId, { kraefte: true, lage: false }, 'handschuh');
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');

  const leiste = page.getByRole('complementary', { name: 'Kartenleiste' });
  const leistenBreite = (await leiste.boundingBox())!.width;
  expect(leistenBreite, 'Leiste fest 300 px').toBeCloseTo(300, 0);

  const tabs = page.getByRole('tablist', { name: 'Ansicht der Leiste' }).getByRole('tab');
  await expect(tabs).toHaveCount(2);
  const kaesten = await Promise.all([0, 1].map(async (i) => (await tabs.nth(i).boundingBox())!));
  expect(Math.abs(kaesten[0].y - kaesten[1].y), 'Segmente stehen in einer Zeile').toBeLessThan(1);
  for (const k of kaesten) {
    expect(k.height, `Segment ${k.width}×${k.height}`).toBeGreaterThanOrEqual(72 - SUBPIXEL);
    expect(k.width, `Segment ${k.width}×${k.height}`).toBeGreaterThanOrEqual(72 - SUBPIXEL);
  }

  // Baumzeilen der offenen Gruppe „Kräfte“.
  const kraefte = page.locator('section[data-paneel="kraefte"]');
  const zeilen = kraefte.locator('[data-ebene][role="switch"]');
  await expect(zeilen.first()).toBeVisible();
  for (let i = 0; i < (await zeilen.count()); i++) {
    const k = (await zeilen.nth(i).boundingBox())!;
    expect(k.height, `Baumzeile ${i}: Höhe ${k.height}`).toBeGreaterThanOrEqual(72 - SUBPIXEL);
  }
  // Gruppenschalter und Gruppenköpfe (offen wie zu).
  const schalter = kraefte.getByRole('checkbox', { name: 'Kräfte: alle Ebenen' });
  const s = (await schalter.boundingBox())!;
  expect(s.height, `Gruppenschalter ${s.width}×${s.height}`).toBeGreaterThanOrEqual(72 - SUBPIXEL);
  expect(s.width, `Gruppenschalter ${s.width}×${s.height}`).toBeGreaterThanOrEqual(72 - SUBPIXEL);
  for (const gruppe of GRUPPEN) {
    const kopf = page.locator(`section[data-paneel="${gruppe}"] button[aria-expanded]`).first();
    const k = (await kopf.boundingBox())!;
    expect(k.height, `Kopf ${gruppe}: Höhe ${k.height}`).toBeGreaterThanOrEqual(72 - SUBPIXEL);
  }
});
