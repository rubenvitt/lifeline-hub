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
 *
 * Zweiter Fall (LLH-1478): „Nach oben“ und das Sammelbanner schweben im ETB über der Erfassung,
 * keine Fußleisten. Ein nur über die Erfassung gerücktes Band lag genau auf ihnen. Mutationsprobe:
 * `ref={bannerRef}` bzw. `nachObenMelden` in `EtbZeitachse.tsx` entfernt → rot. Dritter Fall: die
 * Bänder des Kartenfußes der Lagekarte.
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
async function etbFuellen(page: Page, einsatzId: number, anzahl = 25) {
  for (let i = 0; i < anzahl; i += 1) {
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

const NACH_OBEN = '[data-lfh="etb-nach-oben"]';
// Das Sammelbanner der Überlagerung, nicht das der Lesemarke im Fluss über der Zeitachse.
const SAMMELBANNER = '[data-lfh="etb-schwebend"] [data-lfh="sammelbanner"]';

/**
 * Verstöße des Bands gegen schwebende Elemente: ihr Kasten schneidet das Band, oder die Mitte ihres
 * Bedienziels trifft nicht das Ziel selbst (dann ginge der Klick ins Band).
 */
async function verdeckungenSchwebend(page: Page) {
  return page.evaluate(
    ({ band, schwebend }) => {
      const b = document.querySelector(band)!.getBoundingClientRect();
      const fehler: string[] = [];
      const ueber = (a: DOMRect, z: DOMRect) =>
        a.left < z.right - 0.5 &&
        a.right > z.left + 0.5 &&
        a.top < z.bottom - 0.5 &&
        a.bottom > z.top + 0.5;
      for (const { name, sel, ziel } of schwebend) {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) {
          fehler.push(`${name} fehlt`);
          continue;
        }
        const k = el.getBoundingClientRect();
        if (ueber(k, b)) {
          fehler.push(
            `Band ${Math.round(b.top)}–${Math.round(b.bottom)} schneidet ${name} ${Math.round(k.top)}–${Math.round(k.bottom)}`,
          );
        }
        const knopf = ziel ? el.querySelector<HTMLElement>(ziel) : el;
        if (!knopf) {
          fehler.push(`Bedienziel von ${name} fehlt`);
          continue;
        }
        const z = knopf.getBoundingClientRect();
        const treffer = document.elementFromPoint(z.left + z.width / 2, z.top + z.height / 2);
        if (!treffer || !knopf.contains(treffer)) fehler.push(`Mitte von ${name} trifft nicht`);
      }
      return fehler;
    },
    {
      band: BAND,
      schwebend: [
        { name: '„Nach oben“', sel: NACH_OBEN, ziel: null },
        { name: 'Sammelbanner', sel: SAMMELBANNER, ziel: 'button' },
      ],
    },
  );
}

/** Ein Eintrag eines fremden Erfassers: hochgerollt wartet er im Sammelbanner. */
async function fremderEintrag(zweiter: APIRequestContext, einsatzId: number) {
  const r = await zweiter.post(`/api/einsaetze/${einsatzId}/etb`, {
    data: { typ: 'meldung', inhalt: 'Fremder Eintrag', von: 'ELW 2', an: 'Leitstelle' },
  });
  expect(r.ok(), `ETB zweiter Schirm: ${r.status()} ${await r.text()}`).toBe(true);
}

/**
 * Rollt so weit hoch, dass die Seite nicht mehr am Ende steht (neue Einträge warten im
 * Sammelbanner), aber noch mehr als eine Fensterhöhe unter dem Anfang (`„Nach oben“` steht).
 */
async function hochrollen(page: Page) {
  // Das Ende der Liste eine halbe Fensterhöhe unter dem Sichtbaren: nicht mehr am Ende, aber weit
  // unter dem Anfang. Gemessen an der Zeitachse, nicht am Dokument: unter `xl` steht die Bilanz
  // darunter, und das Ende der Liste ist ihre Unterkante (`useFunkprotokollLauf`, `ende`). Im
  // Abfragen wiederholt, bis die Lage steht: nach einem Breitenwechsel wachsen die Zeilen noch.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const achse = () =>
          document.querySelector('[data-lfh="etb-zeitachse"]')!.getBoundingClientRect().bottom;
        const versatz = achse() - window.innerHeight * 1.5;
        window.scrollTo({ top: window.scrollY + versatz, behavior: 'instant' });
        const passt = () =>
          achse() - window.innerHeight > 100 && window.scrollY > window.innerHeight;
        // Erst stehend zählt: über 20 Bilder nicht zurück ans Ende gelaufen.
        for (let i = 0; i < 20; i += 1) {
          await new Promise((r) => requestAnimationFrame(r));
          if (!passt()) return false;
        }
        return true;
      }),
    )
    .toBe(true);
  await expect(page.locator(NACH_OBEN)).toBeVisible();
}

test('Eingangsband rückt im ETB auch über „Nach oben“ und das Sammelbanner, breit und schmal', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmeldenAlsAdmin(page);
  const angelegt = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Band schwebend ${Date.now()}` },
  });
  expect(angelegt.ok(), `POST /api/einsaetze: ${angelegt.status()}`).toBe(true);
  const einsatzId = ((await angelegt.json()) as { id: number }).id;
  // Mehr als im ersten Fall: hochgerollt soll noch mehr als eine Fensterhöhe darüber liegen.
  await etbFuellen(page, einsatzId, 40);

  const konto = await benutzerAnlegen(page, 'fuehrungspersonal', 'E2E Zweiter Schirm');
  await mitgliedEintragen(page, String(einsatzId), konto.id, 'fuehrungspersonal');

  const zweiter = await request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const login = await zweiter.post('/api/auth/login', {
      data: { benutzername: konto.benutzername, passwort: konto.passwort },
    });
    expect(login.ok(), `Anmelden zweiter Schirm: ${login.status()}`).toBe(true);

    await oeffnenMitStrom(page, `/einsaetze/${einsatzId}/etb`, einsatzId);
    await expect(page.getByText('Bandprobe 39:', { exact: false })).toBeVisible();
    await expect
      .poll(() => klebtAmFuss(page, ETB_LEISTE), { message: 'Erfassung klebt' })
      .toBe(true);
    await hochrollen(page);
    await fokusLoesen(page);

    // Fremder Eintrag ins ETB: hochgerollt wartet er im Sammelbanner. Die Lagemeldung bringt das Band.
    await fremderEintrag(zweiter, einsatzId);
    await expect(page.locator(SAMMELBANNER)).toBeVisible({ timeout: 20_000 });
    await lagemeldung(zweiter, einsatzId, 'Abschnitt Deich Ost');
    const band = page.locator(BAND);
    await expect(band).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(NACH_OBEN)).toBeVisible();

    // ── breit: Band rechts, „Nach oben“ rechts über dem Banner ───────────────────────────
    await expect.poll(() => verdeckungenSchwebend(page)).toEqual([]);
    await expect
      .poll(() =>
        verdeckungen(
          page,
          ETB_LEISTE,
          page.locator(ETB_LEISTE).getByRole('button', { name: 'Erfassen', exact: true }),
        ),
      )
      .toEqual([]);
    await page.locator(NACH_OBEN).click({ trial: true });
    await page.locator(SAMMELBANNER).getByRole('button').click({ trial: true });

    // ── schmal: Band über die volle Breite ───────────────────────────────────────────────
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => (await band.boundingBox())?.width ?? 0, {
        message: 'unter `md` steht das Band über die volle Breite',
      })
      .toBeGreaterThan(300);
    // Der Breitenwechsel lief ans Ende und taute die Achse auf: hochrollen, neuer fremder Eintrag.
    await hochrollen(page);
    await expect
      .poll(() => klebtAmFuss(page, ETB_LEISTE), { message: 'Erfassung klebt' })
      .toBe(true);
    await fremderEintrag(zweiter, einsatzId);
    await expect(page.locator(SAMMELBANNER)).toBeVisible({ timeout: 20_000 });
    await expect(band).toBeVisible();
    await expect.poll(() => verdeckungenSchwebend(page)).toEqual([]);
    await page.locator(NACH_OBEN).click({ trial: true });
    await page.locator(SAMMELBANNER).getByRole('button').click({ trial: true });
  } finally {
    await zweiter.dispose();
  }
});

const KARTEN_FUSS = '[data-lfh="karten-fuss"]';

/**
 * Verstöße des Bands gegen die Bänder des Kartenfußes: ein Band mit Fläche schneidet es, oder die
 * Mitte eines sichtbaren Knopfs im Fuß trifft nicht den Knopf.
 */
async function verdeckungenKartenfuss(page: Page) {
  return page.evaluate(
    ({ band, fuss }) => {
      const b = document.querySelector(band)!.getBoundingClientRect();
      const fehler: string[] = [];
      const ueber = (a: DOMRect, z: DOMRect) =>
        a.left < z.right - 0.5 &&
        a.right > z.left + 0.5 &&
        a.top < z.bottom - 0.5 &&
        a.bottom > z.top + 0.5;
      const rahmen = document.querySelector(fuss)!;
      for (const kind of rahmen.children) {
        const k = kind.getBoundingClientRect();
        if (k.width === 0 || k.height === 0) continue;
        if (ueber(k, b)) {
          const name = (kind as HTMLElement).dataset.lfh ?? kind.tagName.toLowerCase();
          fehler.push(
            `Band ${Math.round(b.top)}–${Math.round(b.bottom)} schneidet ${name} ${Math.round(k.top)}–${Math.round(k.bottom)}`,
          );
        }
      }
      for (const knopf of rahmen.querySelectorAll<HTMLElement>('button')) {
        const k = knopf.getBoundingClientRect();
        if (k.width === 0 || k.height === 0) continue;
        const treffer = document.elementFromPoint(k.left + k.width / 2, k.top + k.height / 2);
        if (!treffer || !knopf.contains(treffer)) {
          fehler.push(`Mitte von „${knopf.textContent?.trim()}“ trifft nicht den Knopf`);
        }
      }
      return fehler;
    },
    { band: BAND, fuss: KARTEN_FUSS },
  );
}

/**
 * Lagekarte (LLH-1478): die Bänder des Kartenfußes melden sich als untere Leisten. Vorher lag das
 * Band schmal über „Abschließen“ und „Beenden“ der Messung und über „Zeitachse einblenden“, breit
 * über dem rechten Ende der Zeitachse. Mutationsprobe: `ref={meldeKinderAlsUntereLeisten}` in
 * `lagekarte/KartenFuss.tsx` entfernt → rot.
 */
test('Eingangsband rückt auf der Lagekarte über die Bänder des Kartenfußes, breit und schmal', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmeldenAlsAdmin(page);
  const angelegt = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Band Karte ${Date.now()}` },
  });
  expect(angelegt.ok(), `POST /api/einsaetze: ${angelegt.status()}`).toBe(true);
  const einsatzId = ((await angelegt.json()) as { id: number }).id;
  const konto = await benutzerAnlegen(page, 'fuehrungspersonal', 'E2E Zweiter Schirm');
  await mitgliedEintragen(page, String(einsatzId), konto.id, 'fuehrungspersonal');

  const zweiter = await request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const login = await zweiter.post('/api/auth/login', {
      data: { benutzername: konto.benutzername, passwort: konto.passwort },
    });
    expect(login.ok(), `Anmelden zweiter Schirm: ${login.status()}`).toBe(true);

    await oeffnenMitStrom(page, `/einsaetze/${einsatzId}/lagekarte`, einsatzId);
    await expect(page.getByTestId('kartenflaeche')).toBeVisible();
    // Messen bringt ein Band mit zwei Knöpfen in den Fuß.
    await page.getByRole('button', { name: 'Messen' }).click();
    const beenden = page.locator(KARTEN_FUSS).getByRole('button', { name: /Beenden/ });
    await expect(beenden).toBeVisible();
    await fokusLoesen(page);
    await lagemeldung(zweiter, einsatzId, 'Abschnitt Deich Ost');
    const band = page.locator(BAND);
    await expect(band).toBeVisible({ timeout: 20_000 });

    // ── breit: Band rechts, die Zeitachse des Fußes reicht darunter ──────────────────────
    await expect.poll(() => verdeckungenKartenfuss(page)).toEqual([]);

    // ── schmal: Band über die volle Breite, über allen Bändern ───────────────────────────
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => (await band.boundingBox())?.width ?? 0, {
        message: 'unter `md` steht das Band über die volle Breite',
      })
      .toBeGreaterThan(300);
    await expect(beenden).toBeVisible();
    await expect.poll(() => verdeckungenKartenfuss(page)).toEqual([]);
    await beenden.click({ trial: true });
  } finally {
    await zweiter.dispose();
  }
});
