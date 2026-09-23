import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Layoutstabilität der Betroffenen-Flächen (LFH-650, Nachzug zur LFH-613-Prüfliste,
 * Kriterium 12 „kein Sprung unter dem Cursor", Tabellen 1, 2, 4 und 5).
 *
 * ZWEI MESSARTEN, bewusst getrennt:
 *  - **Geometrie**, wo die Verschiebung auf eine EIGENE Eingabe folgt (Zustand speichern,
 *    Tippen in der Schnellerfassung). Die CLS-Definition nimmt solche Verschiebungen aus
 *    (`hadRecentInput`, 500 ms) — sie wäre dort blind und bliebe trivial bei 0. Gemessen wird
 *    deshalb, um wie viele Pixel die Zeile bzw. der Inhalt darunter wandert.
 *  - **CLS-Beitrag**, wo die Änderung von AUSSEN kommt (Live-Ereignis, Nachladen). Muster
 *    aus `pegel-pruefliste.spec.ts` (LFH-606 [M5]): Marke setzen, wenn die Seite ruhig steht,
 *    dann nur zählen, was danach und ohne Eingabe verschiebt. Die Aufbau-Einträge davor
 *    werden nicht dem Messobjekt angelastet (dort Kopfzeilen-Umbruch unter Linux, CI-Befund).
 *
 * Seeding per `page.request`: die Session ist Cookie-basiert und teilt den Cookie-Jar. Ein
 * Schreibzugriff darüber ist für die Seite ein FREMDER — er kommt über den Live-Strom
 * (`person`-Ereignis → Invalidierung), genau wie von einer zweiten Stelle.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const FUEKW = { width: 1366, height: 768 };
const RUHE_MS = 700;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const a = await page.request.post(pfad, { data });
  expect(a.ok(), `${pfad}: ${a.status()} ${await a.text()}`).toBeTruthy();
  return ((await a.json()) as { id: number }).id;
}

async function patch(page: Page, pfad: string, data: unknown) {
  const a = await page.request.patch(pfad, { data });
  expect(a.ok(), `${pfad}: ${a.status()} ${await a.text()}`).toBeTruthy();
}

async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate((d) => localStorage.setItem('lifeline-hub.dichte', d), dichte);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

interface Verschiebung {
  v: number;
  t: number;
  eingabe: boolean;
  quellen: string[];
}

async function verschiebungenAufzeichnen(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __verschiebungen: unknown[] };
    w.__verschiebungen = [];
    new PerformanceObserver((liste) => {
      for (const e of liste.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
        startTime: number;
        sources: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[];
      }[]) {
        w.__verschiebungen.push({
          v: e.value,
          t: e.startTime,
          eingabe: e.hadRecentInput,
          quellen: e.sources.map((q) => {
            const k = q.node instanceof Element ? q.node : null;
            const name = k
              ? `${k.tagName.toLowerCase()}${k.getAttribute('data-lfh') ? `[${k.getAttribute('data-lfh')}]` : ''}`
              : String(q.node?.nodeName);
            return `${name} y ${Math.round(q.previousRect.y)}→${Math.round(q.currentRect.y)}`;
          }),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

const verschiebungen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __verschiebungen: Verschiebung[] }).__verschiebungen);

async function wartenBisRuhig(page: Page) {
  let anzahl = -1;
  let seit = Date.now();
  const ende = Date.now() + 20_000;
  while (Date.now() < ende) {
    const jetzt = (await verschiebungen(page)).length;
    if (jetzt !== anzahl) {
      anzahl = jetzt;
      seit = Date.now();
    } else if (Date.now() - seit >= RUHE_MS) return;
    await page.waitForTimeout(100);
  }
  throw new Error('Die Seite kommt nicht zur Ruhe');
}

async function beitragAb(page: Page, marke: number) {
  const nach = (await verschiebungen(page)).filter((e) => e.t >= marke && !e.eingabe);
  return {
    summe: nach.reduce((a, e) => a + e.v, 0),
    quellen:
      nach
        .flatMap((e) => e.quellen)
        .slice(0, 3)
        .join(', ') || '—',
  };
}

const marke = (page: Page) => page.evaluate(() => performance.now());
const kasten = async (l: Locator) => (await l.boundingBox())!;

test('Liste: Zustand speichern ändert die Zeilenhöhe in KEINER Stufe, eine live eintreffende Koordinate trägt ≤ 0,1 zur CLS bei', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize(FUEKW);
  await verschiebungenAufzeichnen(page);
  await anmelden(page);
  const einsatzId = await post(page, '/api/einsaetze', { bezeichnung: `E2E Layout ${Date.now()}` });
  const werte: string[] = [];

  for (const dichte of ['kompakt', 'komfortabel', 'handschuh'] as const) {
    // Je Stufe drei frische Personen: die erste bekommt ihren Zustand, die zweite ihre
    // Koordinate, die dritte ist die Folgezeile, deren Lage gemessen wird.
    const erste = await post(page, `/api/einsaetze/${einsatzId}/personen`, {
      name: `Zustand ${dichte}`,
    });
    const zweite = await post(page, `/api/einsaetze/${einsatzId}/personen`, {
      name: `Fundort ${dichte}`,
      antreff_ort: 'Deich am Pumpwerk',
    });
    await page.goto(`/einsaetze/${einsatzId}/personen`);
    await stelleDichte(page, dichte);
    const zeile = (id: number) => page.locator(`tr.ant-table-row[data-row-key="${id}"]`);
    await expect(zeile(erste)).toBeVisible();
    // Alle Zeilen der Tabelle in DOM-Reihenfolge; gemessen wird die, die auf die jeweilige
    // Zeile folgt — egal, wie die Tabelle sortiert.
    const folgeZeile = (id: number) =>
      page.locator(`tr.ant-table-row[data-row-key="${id}"] + tr.ant-table-row`);

    // ── Zustand speichern: eigene Eingabe → Geometrie ──
    const vorher = await kasten(zeile(erste));
    const folge = (await folgeZeile(erste).count()) ? folgeZeile(erste) : null;
    const folgeVorher = folge ? await kasten(folge) : null;
    const reg = (await zeile(erste).locator('td').first().innerText()).trim();
    await page.getByRole('button', { name: `Zustand zu ${reg} hinzufügen` }).click();
    await page.keyboard.type('gehfähig');
    await page.keyboard.press('Tab');
    const knopf = page.getByRole('button', { name: `Zustand zu ${reg} bearbeiten` });
    await expect(knopf).toHaveText(/gehfähig/);
    await expect(knopf).not.toHaveClass(/ant-btn-loading/);
    const nachher = await kasten(zeile(erste));
    const dh = nachher.height - vorher.height;
    // RELATIV zur eigenen Zeile: `Tab` schiebt den Fokus weiter, und in `handschuh` scrollt
    // der Browser ihn dabei ins Bild — die absolute Lage wanderte gemessen um 40 px, ohne
    // dass die Tabelle ihre Form änderte.
    const dFolge =
      folge && folgeVorher ? (await kasten(folge)).y - nachher.y - (folgeVorher.y - vorher.y) : 0;
    expect(
      Math.abs(dh),
      `Zeilenhöhe nach dem Speichern (${dichte}): ${vorher.height} → ${nachher.height}`,
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(dFolge), `Folgezeile (${dichte}) wandert ${dFolge}px`).toBeLessThanOrEqual(1);

    // ── Koordinate von AUSSEN: Live-Ereignis → CLS-Beitrag ──
    await page.mouse.move(0, 0);
    await wartenBisRuhig(page);
    const hoeheVorher = (await kasten(zeile(zweite))).height;
    const m = await marke(page);
    await patch(page, `/api/einsaetze/${einsatzId}/personen/${zweite}`, {
      antreff_lat: 52.2691,
      antreff_lon: 9.1342,
    });
    await expect(zeile(zweite).locator('[data-lfh="koordinate"]')).toBeVisible({ timeout: 15_000 });
    await wartenBisRuhig(page);
    const b = await beitragAb(page, m);
    const hoeheNachher = (await kasten(zeile(zweite))).height;
    expect
      .soft(b.summe, `CLS-Beitrag der Live-Koordinate (${dichte}) [${b.quellen}]`)
      .toBeLessThanOrEqual(0.1);
    werte.push(
      `${dichte}: Zustand Δh ${dh.toFixed(2)} / Folgezeile ${dFolge.toFixed(2)} · Live-Koordinate Zeile ${hoeheVorher.toFixed(1)}→${hoeheNachher.toFixed(1)}, CLS ${b.summe.toFixed(4)} [${b.quellen}]`,
    );
  }
  test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
});

test('Schnellerfassung bei 390 px: die Hinweiszeile beim Tippen von „Name sk2 @UHS #lat/lon"', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await anmelden(page);
  const einsatzId = await post(page, '/api/einsaetze', { bezeichnung: `E2E Zeile ${Date.now()}` });
  await post(page, `/api/einsaetze/${einsatzId}/personen`, { name: 'Anker' });
  await page.goto(`/einsaetze/${einsatzId}/personen`);
  const feld = page.getByRole('textbox', { name: 'Kurzeingabe Person' });
  await expect(feld).toBeVisible();
  // Was UNTER der Zeile steht: der erste Inhalt nach der Erfassungszeile — gemessen wird der
  // Filterreiter „Alle", der auf jeder Breite über der Liste steht.
  const darunter = page
    .getByRole('tab', { name: 'Alle', exact: true })
    .or(page.getByRole('radio', { name: 'Alle', exact: true }))
    .first();
  const vorher = await kasten(darunter);
  const werte: string[] = [];
  let groesste = 0;
  for (const teil of ['Name', ' sk2', ' @UHS', ' #52.2691/9.1342']) {
    await feld.pressSequentially(teil);
    const jetzt = await kasten(darunter);
    groesste = Math.max(groesste, Math.abs(jetzt.y - vorher.y));
    werte.push(`„…${teil.trim()}": ${(jetzt.y - vorher.y).toFixed(1)}px`);
  }
  test.info().annotations.push({
    type: 'messwert',
    description: `390 px, Verschiebung des Inhalts darunter je Schritt: ${werte.join(' · ')} — größte ${groesste.toFixed(1)}px`,
  });
  // Eine eigene Eingabe darf den Inhalt darunter nicht um mehr als eine Zeile schieben
  // (Kürzel-Hinweis 11 px Mono ≈ 16 px Zeilenhöhe); gemessen wird, ob es mehr ist.
  expect(groesste, 'Verschiebung des Inhalts unter der Erfassungszeile').toBeLessThanOrEqual(16);
});

interface KartenHaken {
  loaded(): boolean;
}

test('Karte: die Hinweiszeile springt nicht, wenn die letzte Lücke live geschlossen wird', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await verschiebungenAufzeichnen(page);
  await anmelden(page);
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `E2E Hinweis ${Date.now()}`,
  });
  await post(page, `/api/einsaetze/${einsatzId}/personen`, {
    name: 'Verortet',
    antreff_lat: 53.0,
    antreff_lon: 8.8,
  });
  const luecke = await post(page, `/api/einsaetze/${einsatzId}/personen`, { name: 'Lücke' });
  await page.goto(`/einsaetze/${einsatzId}/personen?ansicht=karte`);
  await page.waitForFunction(
    () => Boolean((window as unknown as { __lfhKarte?: KartenHaken }).__lfhKarte?.loaded()),
    undefined,
    { timeout: 60_000 },
  );
  const hinweis = page.locator('[data-lfh="betroffene-karte-ohne-koordinate"]');
  await expect(hinweis).toHaveText('1 Person ohne Koordinate — nicht auf der Karte');
  // Kriterium 9: die Lücke steht im ERSTEN Bild (1366 × 768, Modul-Panel offen).
  await expect(hinweis).toBeInViewport();
  const karte = page.locator('[data-lfh="betroffene-karte"] canvas');
  await page.mouse.move(0, 0);
  await wartenBisRuhig(page);
  const vorher = await kasten(karte);
  const m = await marke(page);
  await patch(page, `/api/einsaetze/${einsatzId}/personen/${luecke}`, {
    antreff_lat: 53.1,
    antreff_lon: 8.9,
  });
  await expect(hinweis).toHaveText('Alle angetroffenen Personen stehen auf der Karte', {
    timeout: 15_000,
  });
  await wartenBisRuhig(page);
  const nachher = await kasten(karte);
  const b = await beitragAb(page, m);
  test.info().annotations.push({
    type: 'messwert',
    description: `Karte y ${vorher.y.toFixed(1)} → ${nachher.y.toFixed(1)}, CLS-Beitrag ${b.summe.toFixed(4)} [${b.quellen}]`,
  });
  expect(Math.abs(nachher.y - vorher.y), 'Karte wandert').toBeLessThanOrEqual(1);
  expect(b.summe).toBeLessThanOrEqual(0.1);
});

test('Lage-Dashboard: Sichtungspaneel beim ersten Laden und beim Wechsel „Ohne Sichtung" 0 → 1', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await verschiebungenAufzeichnen(page);
  await anmelden(page);
  const einsatzId = await post(page, '/api/einsaetze', { bezeichnung: `E2E Fuss ${Date.now()}` });
  await post(page, `/api/einsaetze/${einsatzId}/personen`, { name: 'Gesichtet', sichtung: 'sk2' });
  const werte: string[] = [];
  for (const breite of [1366, 1024, 390]) {
    await page.setViewportSize({ width: breite, height: 844 });
    // Erstes Laden: die Personen-Antwort wird zurückgehalten, bis die Seite ruhig steht.
    let loslassen!: () => void;
    const tor = new Promise<void>((f) => (loslassen = f));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route(`**/api/einsaetze/${einsatzId}/personen`, async (r) => {
      if (r.request().method() !== 'GET') return r.continue();
      await tor;
      await r.continue();
    });
    await page.goto(`/einsaetze/${einsatzId}/lage-dashboard`);
    await expect(page.getByRole('group', { name: 'Lage in Zahlen' })).toBeVisible();
    await wartenBisRuhig(page);
    const m1 = await marke(page);
    loslassen();
    await expect(page.locator('[data-lfh="transport-bilanz"]')).toBeVisible({ timeout: 15_000 });
    await wartenBisRuhig(page);
    const laden = await beitragAb(page, m1);
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // Wechsel 0 → 1 von außen: eine ungesichtete Person kommt dazu.
    await page.mouse.move(0, 0);
    const m2 = await marke(page);
    await post(page, `/api/einsaetze/${einsatzId}/personen`, { name: `Neu ${breite}` });
    await expect(page.locator('[data-lfh="ohne-sichtung"]')).not.toHaveText(/Ohne Sichtung0$/, {
      timeout: 15_000,
    });
    await wartenBisRuhig(page);
    const wechsel = await beitragAb(page, m2);
    werte.push(
      `${breite}: erstes Laden ${laden.summe.toFixed(4)} [${laden.quellen}] · Wechsel ${wechsel.summe.toFixed(4)} [${wechsel.quellen}]`,
    );
    expect.soft(laden.summe, `CLS erstes Laden ${breite}px`).toBeLessThanOrEqual(0.1);
    expect.soft(wechsel.summe, `CLS Wechsel ${breite}px`).toBeLessThanOrEqual(0.1);
  }
  test.info().annotations.push({ type: 'messwert', description: werte.join(' | ') });
});
