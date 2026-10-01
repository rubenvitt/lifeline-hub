import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * LFH-691 — das Band „Lage in Zahlen“ hält ab `md` seine Höhe, wenn sich die Länge einer Notiz
 * ändert (Spec `einsatztauglichkeit-layout`, „Kennzahlenband hält seine Höhe“; Prüfliste
 * Kriterium 12 aus LFH-607). Herleitung und Messwerte vor dem Fix:
 * `openspec/changes/lfh-691-kennzahl-notiz-feste-hoehe/`.
 *
 * Gemessen bei 1200, 1440 und 1920 px (Viewport-Stufe `xl`, Zellbreite 146 / 186 / 266 px):
 *  - STANDMELDUNG: „von ≈ 1 850 geplant · 1 ohne Meldung“ wird mit der ersten Meldung zu
 *    „von 1 850 geplant“. Der Einsatz trägt dafür KEINEN Pegel — sonst bestimmte die Pegel-Notiz
 *    die Reihenhöhe, und der Sprung bliebe auch ohne Fix unsichtbar. Vor dem Fix: 2 → 1 Zeilen
 *    bei 1200 und 1440 px, das Band schrumpfte um 15,4 px.
 *  - PEGEL: dieselbe Breite mit kurzer und mit langer Notiz (Prognose, „+1 weitere“). Vor dem
 *    Fix 2 → 4 Zeilen bei 1200 px.
 *  - KEINE AUSSAGE VERLOREN: die Evakuiert-Notiz ist nie gekürzt, die lange Pegel-Notiz erst
 *    bei 1200 px, und dann tragen `title` und zugänglicher Name den vollen Text.
 *
 * HERMETISCH beim Pegel wie `lagebild-cls-schmal.spec.ts`: die Messung kommt per `page.route`
 * aus einem Literal, der echte Abruf ginge an PEGELONLINE.
 */

const BREITEN = [1200, 1440, 1920] as const;

/** Zeilenhöhe der Notiz als Literal (11 px · 1,4, `Kennzahl.tsx`): drei Zeilen = 46,2 px. */
const DREI_ZEILEN = 3 * 11 * 1.4;

const STATION = '47174d8f-1b8e-4599-8a59-b580dd55bc87';

/** UTC im Wire-Format `YYYY-MM-DD HH:MM:SS`. */
const wire = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

/** Pegel-Antwort: kurz nur der Leitpegel, lang mit offener Prognose und einem zweiten Pegel. */
function pegelAntwort(lang: boolean) {
  const jetzt = new Date();
  const leit = {
    id: 1,
    station_uuid: STATION,
    name: 'HANN. MÜNDEN',
    gewaesser: 'WESER',
    reihenfolge: 0,
    messung: { wasserstand_cm: 684, zeitpunkt: jetzt.toISOString(), trend_cm_pro_h: 9.2 },
    prognose: lang
      ? {
          gesetzt_at: wire(jetzt),
          hoechststand_cm: 710,
          zeitpunkt: wire(new Date(jetzt.getTime() + 5 * 3_600_000)),
        }
      : null,
  };
  const zweiter = {
    id: 2,
    station_uuid: 'b0000000-0000-4000-8000-000000000002',
    name: 'HAMELN',
    gewaesser: 'WESER',
    reihenfolge: 1,
    messung: null,
  };
  return lang ? [leit, zweiter] : [leit];
}

async function senden<T>(page: Page, methode: 'post' | 'put', pfad: string, data: unknown) {
  const r = await page.request[methode](pfad, { data });
  expect(r.ok(), `${methode} ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json().catch(() => null)) as T;
}

async function einsatzAnlegen(page: Page, name: string): Promise<number> {
  const { id } = await senden<{ id: number }>(page, 'post', '/api/einsaetze', {
    bezeichnung: `${name} ${Date.now()}`,
  });
  return id;
}

const band = (page: Page) => page.getByRole('group', { name: 'Lage in Zahlen' });

/** Die Zelle einer Kennzahl über ihre Augenbraue. */
const zelle = (page: Page, etikett: RegExp) =>
  band(page)
    .locator('[data-lfh="kennzahl"]')
    .filter({ has: page.getByText(etikett) });

async function hoehe(l: Locator): Promise<number> {
  const b = await l.boundingBox();
  expect(b, 'ohne Kasten').not.toBeNull();
  return b!.height;
}

/** Ob die Notiz gekürzt ist (der Deckel schneidet Text ab). */
const gekuerzt = (notiz: Locator) => notiz.evaluate((el) => el.scrollHeight > el.clientHeight + 1);

async function geladen(page: Page) {
  await expect(band(page).locator('a[data-lfh="kennzahl"]').first()).toBeVisible();
  await expect(page.locator('[data-lfh="seiten-inhalt"] [aria-busy="true"]')).toHaveCount(0);
}

for (const breite of BREITEN) {
  test(`Lage-Dashboard ${breite} px: eine Standmeldung ändert die Bandhöhe nicht`, async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page, 'E2E Notizhöhe Evakuierung');
    const basis = `/api/einsaetze/${einsatzId}/betreuung`;
    const bezirk = await senden<{ id: number }>(page, 'post', `${basis}/bezirke`, {
      bezeichnung: 'Uferstraße 12–40',
      plan_personen: 1850,
      plan_erhebung: 'geschaetzt',
    });
    await page.setViewportSize({ width: breite, height: 900 });
    await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
    await geladen(page);

    const notiz = zelle(page, /^Evakuiert$/).locator('[data-lfh="kennzahl-notiz"]');
    await expect(notiz).toHaveText('von ≈ 1 850 geplant · 1 ohne Meldung');
    // Keine Aussage verloren: „≈“ und „ohne Meldung“ stehen sichtbar, nicht im `title`.
    expect(await gekuerzt(notiz), 'Evakuiert-Notiz gekürzt').toBe(false);
    const paneele = page.locator('[data-lfh="lagebild-paneele"]');
    const vorher = { band: await hoehe(band(page)), paneele: (await paneele.boundingBox())!.y };

    await senden(page, 'post', `${basis}/bezirke/${bezirk.id}/staende`, {
      evakuiert: 400,
      erhebung: 'geschaetzt',
    });
    await expect(notiz).toHaveText('von 1 850 geplant');
    const nachher = { band: await hoehe(band(page)), paneele: (await paneele.boundingBox())!.y };

    test.info().annotations.push({
      type: 'messwert',
      description: `${breite} px: Band ${vorher.band} → ${nachher.band} px, Paneele y ${vorher.paneele} → ${nachher.paneele}`,
    });
    expect(nachher.band, 'Bandhöhe nach der Standmeldung').toBe(vorher.band);
    expect(nachher.paneele, 'Paneele nach der Standmeldung').toBe(vorher.paneele);
    expect(await hoehe(notiz), 'Notiz drei Zeilen hoch').toBeCloseTo(DREI_ZEILEN, 0);
  });

  test(`Lage-Dashboard ${breite} px: kurze und lange Pegel-Notiz, gleiche Bandhöhe`, async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page, 'E2E Notizhöhe Pegel');
    await senden(page, 'put', `/api/einsaetze/${einsatzId}/pegel`, {
      stationen: [{ station_uuid: STATION, name: 'HANN. MÜNDEN', gewaesser: 'WESER' }],
    });
    await page.setViewportSize({ width: breite, height: 900 });
    const notiz = zelle(page, /^Pegel$/).locator('[data-lfh="kennzahl-notiz"]');

    const messe = async (lang: boolean) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.route(`**/api/einsaetze/${einsatzId}/pegel`, (r) =>
        r.request().method() === 'GET' ? r.fulfill({ json: pegelAntwort(lang) }) : r.continue(),
      );
      await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
      await geladen(page);
      await expect(notiz).toContainText(lang ? '+1 weitere' : 'Stand');
      return hoehe(band(page));
    };

    const kurz = await messe(false);
    expect(await gekuerzt(notiz), 'kurze Pegel-Notiz gekürzt').toBe(false);
    const lang = await messe(true);
    test.info().annotations.push({
      type: 'messwert',
      description: `${breite} px: Band kurz ${kurz} px, lang ${lang} px`,
    });
    expect(lang, 'Bandhöhe mit langer Pegel-Notiz').toBe(kurz);

    // Gekürzt wird nur, was nicht in drei Zeilen passt: gemessen 4 Zeilen bei 1200 px, 3 bei
    // 1440, 2 bei 1920. Der volle Text bleibt im `title` und im zugänglichen Namen des Links.
    const langeNotiz = await notiz.textContent();
    expect(await gekuerzt(notiz), `lange Pegel-Notiz gekürzt bei ${breite} px`).toBe(
      breite === 1200,
    );
    await expect(notiz).toHaveAttribute('title', langeNotiz!);
    await expect(zelle(page, /^Pegel$/)).toHaveAccessibleName(/\+1 weitere/);
  });

  test(`Überblick ${breite} px: jede Notiz im Band ist drei Zeilen hoch`, async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page, 'E2E Notizhöhe Überblick');
    await page.setViewportSize({ width: breite, height: 900 });
    await page.goto(`/einsaetze/${einsatzId}/ueberblick`);
    await geladen(page);
    const notizen = band(page).locator('[data-lfh="kennzahl-notiz"]');
    await expect(notizen).toHaveCount(5);
    const hoehen = await notizen.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height),
    );
    test.info().annotations.push({
      type: 'messwert',
      description: `${breite} px: Notizen ${hoehen.join(' / ')} px`,
    });
    for (const h of hoehen) expect(h, 'Notizhöhe').toBeCloseTo(DREI_ZEILEN, 0);
  });
}
