import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { anmeldenAlsAdmin, benutzerAnlegen, mitgliedEintragen } from './rollen-kern';

/**
 * Das Eingangsband weicht unteren Leisten aus (LLH-1424, Spec `benachrichtigungen`, „Das
 * Eingangsband verdeckt keine untere Leiste“). Vorher lag es ab `md` rechts unten über
 * „Erfassen“ der ETB-Erfassung und über der verankerten Aktionsleiste des Befehlsentwurfs, bis
 * man es schloss.
 *
 * GESÄT: ein zweites Konto (Führungspersonal) meldet in seinem eigenen API-Kontext eine
 * Lagemeldung, während der Admin die Seite mit Leiste offen hat (eigene Aktionen melden nichts,
 * Muster `eingangshinweis.spec.ts`).
 *
 * GEPRÜFT, je Seite und Breite: das Band steht, sein Kasten endet über der Oberkante der Leiste,
 * kein Bedienelement der Leiste schneidet ihn, und `elementFromPoint` an der Mitte des
 * Hauptknopfs trifft den Knopf (dann geht der Klick dorthin, nicht ins Band). Breit (1366 px,
 * Band rechts) und schmal (390 px, Band über die volle Breite).
 *
 * Vorbedingung je Messung: die Leiste klebt am Fuß (das ETB ist dafür mit Einträgen gefüllt), die
 * Lage, in der das Band früher deckte. Die kurze Seite, auf der die Leiste mitten im Fenster steht
 * (leeres ETB: gemessen bei 501 von 900 px), rechnet `components/untereLeiste.test.tsx` nach.
 *
 * Mutationsprobe: `meldeUntereLeiste` in `beobachteFussleiste` auskommentiert → rot (das Band
 * liegt über der Erfassung).
 */

const BAND = '[data-lfh="eingangsband"]';
const ETB_LEISTE = '.etb-erfassung-sticky';
const BEFEHL_LEISTE = '[data-lfh="befehl-aktionen"]';
const BEDIENELEMENTE = 'button, textarea, input, [role="button"], [role="combobox"], a[href]';

async function oeffnenMitStrom(page: Page, pfad: string, einsatzId: number) {
  const strom = page.waitForResponse(
    (r) => r.url().endsWith(`/api/einsaetze/${einsatzId}/live`) && r.status() === 200,
  );
  await page.goto(pfad);
  await strom;
}

/**
 * Ein Eingang soll gezeigt werden, nicht warten: steht der Fokus in einem Eingabefeld, hält der
 * Hinweis an (Spec `benachrichtigungen`, „Der Eingangshinweis stört keine Eingabe“).
 */
async function fokusLoesen(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** Genug Einträge, dass das ETB weit über das Fenster rollt und die Erfassung am Fuß klebt. */
async function etbFuellen(page: Page, einsatzId: number) {
  for (let i = 0; i < 25; i += 1) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
      data: {
        typ: 'meldung',
        inhalt: `Bandprobe ${i}: Lagemeldung aus dem Abschnitt, Pegel steigt weiter.`,
        von: 'ELW 1',
        an: 'Leitstelle',
      },
    });
    expect(antwort.ok(), `ETB ${i}: ${antwort.status()}`).toBe(true);
  }
}

/** Unterkante der Leiste am Fensterrand: sie klebt, die Lage, in der das Band früher deckte. */
async function klebtAmFuss(page: Page, leiste: string) {
  return page.evaluate((sel) => {
    const l = document.querySelector(sel)!.getBoundingClientRect();
    return Math.abs(l.bottom - document.documentElement.clientHeight) <= 1;
  }, leiste);
}

async function lagemeldung(zweiter: APIRequestContext, einsatzId: number, absender: string) {
  const r = await zweiter.post(`/api/einsaetze/${einsatzId}/meldungen`, {
    data: {
      absender,
      meldeweg: 'funk',
      inhalt: 'Pegel am Deichtor 2,40 m, steigend.',
      meldungsart: 'lagemeldung',
      ereigniszeit: '2026-10-01 09:30:00',
    },
  });
  expect(r.ok(), `Lagemeldung: ${r.status()} ${await r.text()}`).toBe(true);
}

/**
 * Misst Band und Leiste und gibt die Verstöße zurück: das Band schneidet den Kasten der Leiste,
 * ein sichtbares Bedienelement der Leiste schneidet das Band, der Hauptknopf ist an seiner Mitte
 * nicht er selbst.
 */
async function verdeckungen(page: Page, leiste: string, hauptknopf: Locator) {
  // Neu markiert bei jeder Messung: ein Breitenwechsel hängt die Erfassung neu ein.
  await hauptknopf.evaluate((el) => el.setAttribute('data-e2e-hauptknopf', ''));
  return page.evaluate(
    ({ band, leiste, bedienelemente }) => {
      const b = document.querySelector(band)!.getBoundingClientRect();
      const l = document.querySelector(leiste)!;
      const lk = l.getBoundingClientRect();
      const fehler: string[] = [];
      const ueber = (a: DOMRect, z: DOMRect) =>
        a.left < z.right - 0.5 &&
        a.right > z.left + 0.5 &&
        a.top < z.bottom - 0.5 &&
        a.bottom > z.top + 0.5;
      if (ueber(b, lk)) {
        fehler.push(
          `Band ${Math.round(b.top)}–${Math.round(b.bottom)} schneidet die Leiste ${Math.round(lk.top)}–${Math.round(lk.bottom)}`,
        );
      }
      for (const el of l.querySelectorAll<HTMLElement>(bedienelemente)) {
        const k = el.getBoundingClientRect();
        if (k.width === 0 || k.height === 0) continue;
        if (ueber(k, b)) {
          fehler.push(
            `${el.tagName.toLowerCase()} „${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}“ liegt unter dem Band`,
          );
        }
      }
      const knopf = l.querySelector<HTMLElement>('[data-e2e-hauptknopf]');
      if (!knopf) {
        fehler.push('Hauptknopf fehlt in der Leiste');
      } else {
        const k = knopf.getBoundingClientRect();
        const treffer = document.elementFromPoint(k.left + k.width / 2, k.top + k.height / 2);
        if (!treffer || !knopf.contains(treffer)) {
          fehler.push(`Mitte von „${knopf.textContent?.trim()}“ trifft nicht den Knopf`);
        }
      }
      return fehler;
    },
    { band: BAND, leiste, bedienelemente: BEDIENELEMENTE },
  );
}

test('Eingangsband rückt über die ETB-Erfassung und die Aktionsleiste des Befehls, breit und schmal', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmeldenAlsAdmin(page);
  const angelegt = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Band weicht aus ${Date.now()}` },
  });
  expect(angelegt.ok(), `POST /api/einsaetze: ${angelegt.status()}`).toBe(true);
  const einsatzId = ((await angelegt.json()) as { id: number }).id;
  const befehl = await page.request.post(`/api/einsaetze/${einsatzId}/befehle`, {
    data: { vorlage: 'befehl_ladef', titel: 'Einsatzbefehl Übung' },
  });
  expect(befehl.ok(), await befehl.text()).toBe(true);
  const befehlId = ((await befehl.json()) as { id: number }).id;

  await etbFuellen(page, einsatzId);

  const konto = await benutzerAnlegen(page, 'fuehrungspersonal', 'E2E Zweiter Schirm');
  await mitgliedEintragen(page, String(einsatzId), konto.id, 'fuehrungspersonal');

  const zweiter = await request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const login = await zweiter.post('/api/auth/login', {
      data: { benutzername: konto.benutzername, passwort: konto.passwort },
    });
    expect(login.ok(), `Anmelden zweiter Schirm: ${login.status()}`).toBe(true);

    // ── ETB, breit: das Band steht rechts, die Erfassung darunter ─────────────────────────
    await oeffnenMitStrom(page, `/einsaetze/${einsatzId}/etb`, einsatzId);
    const erfassen = page
      .locator(ETB_LEISTE)
      .getByRole('button', { name: 'Erfassen', exact: true });
    await expect(erfassen).toBeVisible();
    await expect(page.getByText('Bandprobe 24:', { exact: false })).toBeVisible();
    await expect
      .poll(() => klebtAmFuss(page, ETB_LEISTE), { message: 'Erfassung klebt' })
      .toBe(true);
    await fokusLoesen(page);
    await lagemeldung(zweiter, einsatzId, 'Abschnitt Deich Ost');
    const band = page.locator(BAND);
    await expect(band).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => verdeckungen(page, ETB_LEISTE, erfassen)).toEqual([]);
    // Der Klick geht an die Leiste, nicht ans Band (`toBeVisible()` ist kein Beleg, e2e/AGENTS.md).
    await erfassen.click({ trial: true });

    // ── ETB, schmal: das Band über die volle Breite ──────────────────────────────────────
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => (await band.boundingBox())?.width ?? 0, {
        message: 'unter `md` steht das Band über die volle Breite',
      })
      .toBeGreaterThan(300);
    await expect
      .poll(() => klebtAmFuss(page, ETB_LEISTE), { message: 'Erfassung klebt' })
      .toBe(true);
    await expect.poll(() => verdeckungen(page, ETB_LEISTE, erfassen)).toEqual([]);

    // ── Befehlsentwurf, schmal: unter `lg` ist die Aktionsleiste unten verankert ─────────
    await oeffnenMitStrom(page, `/einsaetze/${einsatzId}/auftraege/befehle/${befehlId}`, einsatzId);
    const leiste = page.locator(BEFEHL_LEISTE);
    await expect(leiste).toHaveCSS('position', 'sticky');
    const freigeben = leiste.getByRole('button', { name: 'Freigeben', exact: true });
    await expect(freigeben).toBeVisible();
    await expect
      .poll(() => klebtAmFuss(page, BEFEHL_LEISTE), { message: 'Leiste klebt' })
      .toBe(true);
    await fokusLoesen(page);
    await lagemeldung(zweiter, einsatzId, 'Abschnitt Deich West');
    await expect(band).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => verdeckungen(page, BEFEHL_LEISTE, freigeben)).toEqual([]);
  } finally {
    await zweiter.dispose();
  }
});
