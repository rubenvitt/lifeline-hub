import { expect, test, type Locator, type Page } from '@playwright/test';
import { lagebesprechungPfad } from '../src/routing/deeplinks';
import { kontrast } from './kontrast-kern';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';
import { rechteHinweisSteht } from './trefflaeche-kern';

/**
 * Das Modul Lagebesprechung (LLH-1111) im Browser:
 *
 * - ABLAUF: Termin über „Termin wählen“ und die Schnellwahl („+1 h“, ohne ETB-Eintrag) →
 *   Vorbereitung zeigt den Termin → Abschluss mit Entschluss → der Verlauf zeigt Nr. 1 mit dem
 *   Sprung auf den ETB-Eintrag. Geklickt, nicht nur `toBeVisible` (LFH-355).
 * - EIGENE FREIGABE: die Seite ist voll nutzbar, allein mit der Freigabe der Lagebesprechung (das
 *   Modul Stab gibt es seit i6k6mzed nicht mehr). Gemessen als Führungspersonal; Vorbedingung ist
 *   die Freigabe vom Server.
 * - HANDY (390 px): kein Querlauf auf der Seite Lagebesprechung, als Admin und als Beobachter
 *   (LFH-435). Gemessen gegen die feste Gerätebreite, nicht gegen `innerWidth` (Begründung in
 *   `einsatzdaten-schmal.spec.ts`). Die alte Adresse `…/stab` führt in den Einsatz (i6k6mzed,
 *   design.md D8), ohne Stab-Seite und ohne Zeile zur Lagebesprechung.
 * - KONTRAST des Zeilenziels „ETB-Eintrag“ im Verlauf (`components/linkZeilenziel.ts`, LFH-695;
 *   vorher an der Stab-Seite gemessen): Tag ≥ 7 : 1, Nacht ≥ 5 : 1, in Ruhe und unter dem Zeiger.
 *
 * Kein `networkidle` (SSE-Strom, LFH-385); gewartet wird auf Inhaltsanker.
 */

const BREITE = 390;

async function einsatzAnlegen(page: Page): Promise<number> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Lagebesprechung Modul ${Date.now()}` },
  });
  expect(r.ok(), `Einsatz anlegen: ${r.status()}`).toBeTruthy();
  return ((await r.json()) as { id: number }).id;
}

const paneel = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

/** Die Kennzahl im Paneel „Termin“ mit dem Titel `titel`. */
const kennzahl = (page: Page, titel: string) =>
  paneel(page, 'Termin').locator('[data-lfh="kennzahl"]').filter({ hasText: titel });

/** Eine Zeile der Vorbereitung (`lagebesprechung/VorbereitungPaneel.tsx`). */
const vorbereitungsZeile = (page: Page, schluessel: string) =>
  page.locator(`[data-lfh="vorbereitung-zeile"][data-schluessel="${schluessel}"]`);

/** Wartet auf die Antwort des Termin-Schreibwegs und gibt sie zurück. */
function terminAntwort(page: Page, einsatzId: number) {
  return page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/einsaetze/${einsatzId}/lagebesprechung/termin`) &&
      r.request().method() === 'PUT',
  );
}

async function einsatzKopf(page: Page, einsatzId: number): Promise<Record<string, unknown>> {
  return (await (await page.request.get(`/api/einsaetze/${einsatzId}`)).json()) as Record<
    string,
    unknown
  >;
}

/** Schließt über die Kopfaktion ab und wartet auf das 201. */
async function abschliessen(page: Page, einsatzId: number, entschluss: string) {
  const kopfaktion = page.getByRole('button', { name: 'Lagebesprechung abschließen' });
  await expect(kopfaktion).toBeEnabled();
  await kopfaktion.click();
  const dialog = page.getByRole('dialog', { name: 'Lagebesprechung abschließen' });
  await dialog.getByLabel('Entschluss').fill(entschluss);
  const gespeichert = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/einsaetze/${einsatzId}/lagebesprechungen`) &&
      r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Abschließen', exact: true }).click();
  expect((await gespeichert).status()).toBe(201);
  await expect(dialog).toHaveCount(0);
}

/** Der Verlauf zeigt genau einen Eintrag Nr. 1 mit seinem ETB-Sprung; gibt den Link zurück. */
async function verlaufZeigtNrEins(page: Page, einsatzId: number): Promise<Locator> {
  const verlauf = paneel(page, 'Verlauf');
  await expect(verlauf.getByRole('heading', { level: 3 })).toHaveCount(1);
  await expect(verlauf.getByRole('heading', { level: 3, name: /^Nr\. 1 · / })).toBeVisible();
  const etb = verlauf.getByRole('link', {
    name: 'ETB-Eintrag zu Lagebesprechung Nr. 1',
    exact: true,
  });
  await expect(etb).toHaveAttribute(
    'href',
    new RegExp(`^/einsaetze/${einsatzId}/etb\\?eintrag=\\d+$`),
  );
  return etb;
}

test.describe('LLH-1111: Modul Lagebesprechung', () => {
  test.use({ timezoneId: 'Europe/Berlin', viewport: { width: 1366, height: 900 } });

  test('Termin → Vorbereitung → Abschluss → Verlauf mit ETB-Eintrag', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const id = await einsatzAnlegen(page);
    await page.goto(lagebesprechungPfad(id));

    // ── Termin: erst kein Termin, Verlauf leer.
    await expect(kennzahl(page, 'Nächste Lagebesprechung')).toContainText('kein Termin');
    await expect(paneel(page, 'Verlauf')).toContainText('Noch keine Lagebesprechung abgeschlossen');

    // Freie Wahl: das Feld übernimmt die getippte DTG mit Enter (Wanduhr Europe/Berlin, LLH-1070).
    const feld = paneel(page, 'Termin').getByRole('textbox', { name: 'Termin wählen' });
    await expect(feld).toBeEnabled();
    let antwort = terminAntwort(page, id);
    await feld.fill('091517sep99');
    await feld.press('Enter');
    expect((await antwort).ok()).toBeTruthy();
    expect((await einsatzKopf(page, id)).naechste_lagebesprechung_at).toBe('2099-09-09 13:17:00');

    // Schnellwahl „+1 h“ ab jetzt; kein Abschluss, also kein Verlaufseintrag.
    antwort = terminAntwort(page, id);
    await paneel(page, 'Termin').getByRole('button', { name: '+1 h', exact: true }).click();
    expect((await antwort).ok()).toBeTruthy();
    await expect(kennzahl(page, 'Nächste Lagebesprechung')).toContainText(/in (59 min|1 h 00 min)/);
    await expect(kennzahl(page, 'Abgeschlossen')).toContainText('noch keine');

    // ── Vorbereitung: der Termin steht dort ebenso, die letzte Besprechung fehlt noch.
    await expect(paneel(page, 'Vorbereitung')).toBeVisible();
    await expect(vorbereitungsZeile(page, 'termin').locator('[data-teil="wert"]')).not.toHaveText(
      'kein Termin',
    );
    await expect(vorbereitungsZeile(page, 'besprechung').locator('[data-teil="wert"]')).toHaveText(
      'keine',
    );

    // ── Abschluss mit Entschluss; der Termin bleibt vorbelegt.
    await abschliessen(page, id, 'Lage unverändert, Maßnahmen fortführen');
    await expect(kennzahl(page, 'Abgeschlossen')).toContainText('zuletzt Nr. 1');
    await expect(kennzahl(page, 'Nächste Lagebesprechung')).toContainText(/in \d/);
    await expect(vorbereitungsZeile(page, 'besprechung').locator('[data-teil="wert"]')).toHaveText(
      'Nr. 1',
    );

    // ── Verlauf: Nr. 1 mit Entschluss und ETB-Sprung, der ins ETB führt.
    const etb = await verlaufZeigtNrEins(page, id);
    await expect(paneel(page, 'Verlauf')).toContainText('Lage unverändert, Maßnahmen fortführen');
    await etb.click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${id}/etb\\?eintrag=\\d+$`));
  });

  test('Führungspersonal: die Seite Lagebesprechung ist allein mit ihrer Freigabe voll nutzbar', async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const id = await einsatzAnlegen(page);
    await wechsleZuRolle(page, 'fuehrungspersonal', String(id));

    // Vorbedingung: einen Stab kennen die Freigaben nicht mehr, die Lagebesprechung ist frei.
    const freigaben = (await (
      await page.request.get(`/api/einsaetze/${id}/modul-freigaben`)
    ).json()) as Record<string, { sichtbar: boolean; zugriff: boolean }>;
    expect(freigaben.stab, 'Vorbedingung: kein Modul Stab').toBeUndefined();
    expect(freigaben.lagebesprechung, 'Vorbedingung: Lagebesprechung frei').toEqual({
      sichtbar: true,
      zugriff: true,
    });

    await page.goto(lagebesprechungPfad(id));
    await expect(kennzahl(page, 'Nächste Lagebesprechung')).toContainText('kein Termin');

    const antwort = terminAntwort(page, id);
    await paneel(page, 'Termin').getByRole('button', { name: '+30 min', exact: true }).click();
    expect((await antwort).ok()).toBeTruthy();
    await expect(kennzahl(page, 'Nächste Lagebesprechung')).toContainText(/in (29|30) min/);

    // Die Vorbereitung steht mit ihren Besprechungszeilen.
    await expect(vorbereitungsZeile(page, 'besprechung').locator('[data-teil="wert"]')).toHaveText(
      'keine',
    );

    await abschliessen(page, id, 'Lage unverändert');
    await verlaufZeigtNrEins(page, id);
  });
});

/** Kein Querlauf: Dokument und alle übergebenen Kästen enden bei 390 px. */
async function keinQuerlauf(page: Page, kaesten: Locator[], wo: string) {
  const breite = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(breite, `${wo}: documentElement.scrollWidth`).toBeLessThanOrEqual(BREITE);
  for (const k of kaesten) {
    const b = await k.boundingBox();
    expect(b, `${wo}: ohne Kasten`).not.toBeNull();
    expect(b!.x + b!.width, `${wo}: rechte Kante`).toBeLessThanOrEqual(BREITE);
  }
}

/** Die Seite steht: Termin, Vorbereitung mit geladener Sichtung, Verlauf mit Nr. 1. */
async function seiteSteht(page: Page, einsatzId: number) {
  await expect(kennzahl(page, 'Abgeschlossen')).toContainText('zuletzt Nr. 1');
  await expect(vorbereitungsZeile(page, 'sichtung')).not.toHaveAttribute('data-zustand', 'laden');
  await verlaufZeigtNrEins(page, einsatzId);
}

test.describe('LLH-1111: Lagebesprechung am Handy', () => {
  test.use({ viewport: { width: BREITE, height: 844 } });

  /** Ein Einsatz mit einer abgeschlossenen Besprechung und einem langen Entschluss. */
  async function seede(page: Page): Promise<number> {
    const id = await einsatzAnlegen(page);
    const r = await page.request.post(`/api/einsaetze/${id}/lagebesprechungen`, {
      data: {
        entschluss:
          'Evakuierung Ortsteil Nord fortführen, Sandsackverbau am Nordufer verstärken, ' +
          'Betreuungsstelle Turnhalle Musterstadt-Nordwest auf zweihundert Plätze erweitern',
        naechste_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
    });
    expect(r.status(), `Abschluss säen: ${await r.text()}`).toBe(201);
    return id;
  }

  test('Admin, 390 px: die Seite läuft nicht über, die alte Stab-Adresse führt in den Einsatz', async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const id = await seede(page);
    await page.goto(lagebesprechungPfad(id));
    await seiteSteht(page, id);
    const schnellwahl = paneel(page, 'Termin').getByRole('button');
    await expect(schnellwahl.first()).toBeEnabled();
    await keinQuerlauf(
      page,
      [
        ...['Termin', 'Vorbereitung', 'Verlauf'].map((n) => paneel(page, n)),
        ...(await schnellwahl.all()),
        paneel(page, 'Termin').getByRole('textbox', { name: 'Termin wählen' }),
        page.getByRole('button', { name: 'In Lagebericht übernehmen' }),
      ],
      'Lagebesprechung (Admin)',
    );

    await altadresseFuehrtInDenEinsatz(page, id);
  });

  test('Beobachter, 390 px: gesperrte Bedienung läuft ebenso nicht über', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const id = await seede(page);
    await wechsleZuRolle(page, 'beobachter', String(id));
    await page.goto(lagebesprechungPfad(id));
    await seiteSteht(page, id);

    // Vorbedingung des Rollenzweigs: Hinweis steht, Schnellwahl gesperrt, keine Übernahme.
    await rechteHinweisSteht(page);
    const schnellwahl = paneel(page, 'Termin').getByRole('button');
    for (const k of await schnellwahl.all()) {
      await expect(
        k,
        'Vorbedingung: ohne Schreibrecht ist die Schnellwahl gesperrt',
      ).toBeDisabled();
    }
    await expect(
      page.getByRole('button', { name: 'In Lagebericht übernehmen' }),
      'Vorbedingung: ohne Schreibrecht keine Übernahme',
    ).toHaveCount(0);

    await keinQuerlauf(
      page,
      [
        ...['Termin', 'Vorbereitung', 'Verlauf'].map((n) => paneel(page, n)),
        ...(await schnellwahl.all()),
      ],
      'Lagebesprechung (Beobachter)',
    );
  });
});

/**
 * Die alte Adresse der Stab-Seite (i6k6mzed, design.md D8, Spec `lagebesprechung`, „Stab-Seite“):
 * die App zeigt den Einsatz statt der Einsatzliste, weder eine Stab-Seite noch die Zeile
 * „Nächste Lagebesprechung“.
 */
async function altadresseFuehrtInDenEinsatz(page: Page, einsatzId: number) {
  await page.goto(`/einsaetze/${einsatzId}/stab`);
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/(?!stab)[a-z-]+`));
  await expect(
    page.getByRole('group', { name: 'Nächste Lagebesprechung', exact: true }),
  ).toHaveCount(0);
}

test.describe('LFH-695: Kontrast des Zeilenziels im Verlauf', () => {
  test.use({ viewport: { width: 1366, height: 900 } });
  const TEXT = { light: 7, dark: 5 } as const;

  for (const modus of ['light', 'dark'] as const) {
    test(`ETB-Eintrag im Verlauf hält den Textboden im Modus ${modus}`, async ({ page }) => {
      await anmeldenAlsAdmin(page);
      const id = await einsatzAnlegen(page);
      const r = await page.request.post(`/api/einsaetze/${id}/lagebesprechungen`, {
        data: { entschluss: 'Lage unverändert' },
      });
      expect(r.status(), `Abschluss säen: ${await r.text()}`).toBe(201);
      await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
      await page.goto(lagebesprechungPfad(id));
      await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
      const link = await verlaufZeigtNrEins(page, id);

      for (const zustand of ['ruhe', 'zeiger'] as const) {
        if (zustand === 'zeiger') await link.hover();
        else await page.mouse.move(0, 0);
        // antd blendet die Linkfarbe über `transition: color` über; erst eingeschwungen messen.
        await link.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
        const m = await kontrast(link);
        expect
          .soft(
            m.verhaeltnis,
            `${modus}, ${zustand}: ${m.verhaeltnis.toFixed(2)} : 1 (Soll ≥ ${TEXT[modus]}) ${JSON.stringify(m)}`,
          )
          .toBeGreaterThanOrEqual(TEXT[modus]);
      }
    });
  }
});
