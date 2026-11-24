import { expect, test, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';
import { HANDSCHIRM, STAFFEL, alleHaltenStufe, anmelden, stelleDichte } from './trefflaeche-kern';

/**
 * UHS-Grundriss: Form nach Inhaltsbreite, Überlaufhinweis und Trefffläche der Personenmarke
 * (LFH-970, U71/U72/U73).
 *
 * FORM: Die Drei-Spalten-Form steht erst, wenn die Fläche neben beiden Seitenspalten ganz in den
 * Rahmen passt (`pages/uhs/grundrissLayout.ts`, `dreiSpaltenPassen`). Gemessen wird deshalb bei
 * Tablet quer (1180), Fükw (1366) und Desktop (1440) MIT Rail und Modulpanel: dort stand bis
 * LFH-970 ab `lg` die Drei-Spalten-Form und schnitt Plätze an. Jede Platzkarte muss im sichtbaren
 * Bereich der Fläche liegen, ohne seitlichen Bildlauf. Bei 1920 px ist die Drei-Spalten-Form die
 * Gegenprobe: ohne sie bliebe der Test grün, wenn die Weiche nur noch Reiter kennte.
 *
 * ROLLEN (`e2e/AGENTS.md`, LFH-435): das Layout-Gate läuft auch als Beobachter. Dort fehlt der
 * Verbleib-Knopf, die Marke bleibt Klickziel für die Detailansicht.
 */

/** Plätze im Raster: sechs reichen über die Mindestfläche von 700 px hinaus in die dritte Spalte. */
const PLAETZE = 6;

interface Aufbau {
  einsatzId: string;
  pfad: string;
}

async function seede<T = { id: number }>(page: Page, pfad: string, data: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return (await antwort.json()) as T;
}

/** Einsatz, zwei Personen unter „Noch nicht aufgenommen", eine aktive UHS mit sechs Betten. */
async function aufbauen(page: Page): Promise<Aufbau> {
  const stempel = Date.now();
  const einsatz = await seede(page, '/api/einsaetze', { bezeichnung: `E2E UHS Form ${stempel}` });
  const E = `/api/einsaetze/${einsatz.id}`;
  await seede(page, `${E}/persons`, { name: `FormPat${stempel}` });
  await seede(page, `${E}/persons`, { name: `FormZwei${stempel}` });
  const uhs = await seede(page, `${E}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: `BHP Form ${stempel}`,
  });
  await seede(page, `${E}/uhs/${uhs.id}/seats/bulk`, { typ: 'bett', menge: PLAETZE });
  await seede(page, `${E}/uhs/${uhs.id}/status`, { status: 'aktiv' });
  return {
    einsatzId: String(einsatz.id),
    pfad: `/einsaetze/${einsatz.id}/unfallhilfsstellen/${uhs.id}`,
  };
}

/**
 * Liegt jede Platzkarte ganz im sichtbaren Bereich der Fläche, ohne seitlichen Bildlauf? Gemessen
 * gegen den Innenraum des Bildlauf-Containers (`clientLeft`/`clientWidth`: ohne Rand und ohne
 * senkrechte Bildlaufleiste). Liefert die angeschnittenen Karten, leer heißt: alle sichtbar.
 */
async function angeschnitteneKarten(page: Page): Promise<string[]> {
  return page.getByTestId('grundriss-flaeche-scroll').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const links = r.left + el.clientLeft;
    const rechts = links + el.clientWidth;
    return [...el.querySelectorAll<HTMLElement>('[data-testid="platz-karte"]')]
      .filter((k) => {
        const b = k.getBoundingClientRect();
        return b.left < links - 0.5 || b.right > rechts + 0.5;
      })
      .map((k) => k.textContent?.slice(0, 20) ?? '?');
  });
}

async function seiteSteht(page: Page, pfad: string) {
  await page.goto(pfad);
  await expect(page.locator('[data-testid="platz-karte"]')).toHaveCount(PLAETZE);
}

const FORMEN = [
  { name: 'Tablet quer', groesse: { width: 1180, height: 820 }, form: 'reiter' },
  { name: 'Fükw', groesse: { width: 1366, height: 768 }, form: 'reiter' },
  { name: 'Desktop', groesse: { width: 1440, height: 900 }, form: 'reiter' },
  { name: 'Großbild', groesse: { width: 1920, height: 1080 }, form: 'drei' },
] as const;

for (const rolle of ['admin', 'beobachter'] as const) {
  for (const { name, groesse, form } of FORMEN) {
    test(`${name} (${groesse.width} px, ${rolle}): ${form === 'drei' ? 'drei Spalten' : 'Reiterform'}, keine Platzkarte angeschnitten`, async ({
      page,
    }) => {
      await page.setViewportSize(groesse);
      await anmelden(page);
      const { einsatzId, pfad } = await aufbauen(page);
      if (rolle === 'beobachter') await wechsleZuRolle(page, 'beobachter', einsatzId);
      await seiteSteht(page, pfad);

      // Vorbedingung: Rail und Modulpanel stehen — sie sind der Abzug, um den es geht.
      await expect(
        page.getByRole('navigation').first(),
        'Vorbedingung: die Modulnavigation steht neben dem Grundriss',
      ).toBeVisible();
      // Vorbedingung: der Rollenzweig steht VOR der Messung (`e2e/AGENTS.md`). Die Platzaktionen
      // liegen auf der Fläche, die in beiden Formen montiert ist; beim Admin sind sie die Gegenprobe.
      await expect(
        page.getByRole('button', { name: /^Platzaktionen zu / }),
        `Vorbedingung: Platzaktionen ${rolle === 'admin' ? 'stehen' : 'fehlen ohne Schreibrecht'}`,
      ).toHaveCount(rolle === 'admin' ? PLAETZE : 0);

      const rahmen = page.getByTestId('grundriss-rahmen');
      if (form === 'reiter') {
        await expect(page.getByRole('tab', { name: 'Fläche' })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await expect(rahmen).toHaveCSS('flex-direction', 'column');
      } else {
        await expect(page.getByRole('tab', { name: 'Fläche' })).toHaveCount(0);
        await expect(rahmen).toHaveCSS('flex-direction', 'row');
        await expect(page.getByText('Noch nicht aufgenommen')).toBeVisible();
      }
      expect(await angeschnitteneKarten(page), 'angeschnittene Platzkarten').toEqual([]);
      await expect(page.getByTestId('grundriss-ueberlauf-rechts')).toHaveCount(0);
    });
  }
}

/**
 * Die Weiche misst nach: wird das Fenster nach dem Laden schmaler (Fenster geteilt, Tablet gedreht),
 * kippt die Form ohne Neuladen. Ohne den ResizeObserver bliebe die erste Messung stehen.
 */
test('Fensterwechsel nach dem Laden: 1920 → 1180 → 1920 px schaltet die Form ohne Neuladen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await anmelden(page);
  const { pfad } = await aufbauen(page);
  await seiteSteht(page, pfad);
  const rahmen = page.getByTestId('grundriss-rahmen');
  await expect(rahmen).toHaveCSS('flex-direction', 'row');

  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(page.getByRole('tab', { name: 'Fläche' })).toBeVisible();
  await expect(rahmen).toHaveCSS('flex-direction', 'column');
  expect(await angeschnitteneKarten(page), 'angeschnittene Platzkarten').toEqual([]);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.getByRole('tab', { name: 'Fläche' })).toHaveCount(0);
  await expect(rahmen).toHaveCSS('flex-direction', 'row');
});

test('Handschirm (390 px): die Fläche läuft seitlich über, „weitere Plätze →" sagt es ohne Bedienung', async ({
  page,
}) => {
  await page.setViewportSize(HANDSCHIRM);
  await anmelden(page);
  const { pfad } = await aufbauen(page);
  await seiteSteht(page, pfad);

  const scroll = page.getByTestId('grundriss-flaeche-scroll');
  const masse = await scroll.evaluate((el) => ({ sicht: el.clientWidth, voll: el.scrollWidth }));
  expect(masse.voll, 'Vorbedingung: die Fläche ist breiter als ihr Fenster').toBeGreaterThan(
    masse.sicht,
  );
  const hinweis = page.getByTestId('grundriss-ueberlauf-rechts');
  await expect(hinweis).toBeVisible();
  await expect(hinweis).toHaveText('weitere Plätze →');

  // Ans Ende gewischt: rechts nichts mehr, links der Rückweg.
  await scroll.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(hinweis).toHaveCount(0);
  await expect(page.getByTestId('grundriss-ueberlauf-links')).toHaveText('← weitere Plätze');
});

/**
 * Kein Querlauf der Seite am Handschirm (LLH-1793): mit geöffnetem „Plätze anlegen“ (Typ, Menge,
 * Anlegen, Abbrechen) lief die Werkzeugzeile über der Fläche auf 411 / 416 / 428 px und schob die
 * ganze Seite seitlich. Die Fläche selbst rollt in sich, die Seite nie.
 *
 * Mutationsprobe: `wrap` an der Werkzeugzeile (`Grundriss.tsx`, Kopfzeile der Fläche) entfernen →
 * die Seite ist breiter als 390 px, der Test wird rot.
 */
test('Handschirm (390 px): „Plätze anlegen“ offen, die Seite läuft in keiner Stufe quer', async ({
  page,
}) => {
  await page.setViewportSize(HANDSCHIRM);
  await anmelden(page);
  const { pfad } = await aufbauen(page);
  await seiteSteht(page, pfad);
  for (const { dichte } of STAFFEL) {
    await stelleDichte(page, dichte);
    await page.getByRole('button', { name: 'Plätze bearbeiten', exact: true }).click();
    await page.getByRole('button', { name: 'Plätze anlegen', exact: true }).click();
    await expect(page.locator('[data-lfh="plaetze-anlegen"]')).toBeVisible();
    const masse = await page.evaluate(() => ({
      voll: document.documentElement.scrollWidth,
      sicht: document.documentElement.clientWidth,
    }));
    expect(masse.voll, `Seitenbreite in ${dichte}`).toBeLessThanOrEqual(masse.sicht);
  }
});

/**
 * Trefffläche der Personenmarke in den Listen (U72): die Hülle `PersonenkarteDrag` misst die
 * Steuerhöhe der Stufe. Die Marke allein maß 26 px. `kompakt` misst die Gegenprobe, damit ein
 * Ziel, das in jeder Stufe gleich groß ist, nicht grün bleibt.
 */
for (const rolle of ['admin', 'beobachter'] as const) {
  test(`Personenmarke und Verbleib in „Noch nicht aufgenommen" halten die Stufe (${rolle})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1180, height: 820 });
    await anmelden(page);
    const { einsatzId, pfad } = await aufbauen(page);
    if (rolle === 'beobachter') await wechsleZuRolle(page, 'beobachter', einsatzId);
    await seiteSteht(page, pfad);

    const gemessen = new Map<string, number>();
    for (const { dichte, soll } of STAFFEL) {
      await stelleDichte(page, dichte);
      await page.getByRole('tab', { name: 'Wartebereich' }).click();
      const huellen = page
        .locator('[role="button"]')
        .filter({ has: page.locator('[data-lfh="personenkarte"]') });
      // Vorbedingung VOR der Messung: der Rollenzweig steht, die Liste ist da.
      await expect(huellen).toHaveCount(2);
      const verbleib = page.getByRole('button', { name: /^Verbleib \/ Entlassung erfassen/ });
      if (rolle === 'admin') {
        await expect(verbleib).toHaveCount(2);
        await expect(verbleib.first(), 'das Wort steht sichtbar am Knopf').toHaveText('Verbleib');
      } else {
        await expect(verbleib).toHaveCount(0);
      }

      gemessen.set(
        dichte,
        await alleHaltenStufe(huellen, soll, `Personenmarke (${dichte}, ${rolle})`, 2),
      );
      if (rolle === 'admin') await alleHaltenStufe(verbleib, soll, `Verbleib (${dichte})`, 2);
      // Ein Klick auf die Marke öffnet die Person, nicht den Verbleib-Dialog daneben.
      await huellen.first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog')).not.toContainText('Verbleib erfassen');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    expect(gemessen.get('kompakt')!, 'Gegenprobe: kompakt bleibt kleiner').toBeLessThan(
      gemessen.get('handschuh')!,
    );
  });
}

/**
 * Kacheln wachsen mit der Fläche (LLH-1940, Spec `uhs-grundriss`, „Kartengröße und Layout sind
 * dichteunabhängig“): drei Betten in einer Reihe lassen bei 1920 × 1080 viel Fläche frei, der
 * Grundriss streckt Lage und Größe bis aufs Doppelte. Die Dichtestufe ändert daran nichts, und ein
 * Zug landet dort, wo er losgelassen wurde, obwohl der Server in Grundmaßen speichert.
 *
 * Mutationsprobe: `einpassFaktor` auf 1 festnageln → die Karte bleibt 140 px breit, der erste Test
 * wird rot; die Rückrechnung in `onDragEnd` entfernen → der Server speichert die doppelte Strecke,
 * der Zug-Test wird rot.
 */
async function wenigeBetten(page: Page): Promise<Aufbau & { uhsPfad: string }> {
  const stempel = Date.now();
  const einsatz = await seede(page, '/api/einsaetze', {
    bezeichnung: `E2E UHS Wachsen ${stempel}`,
  });
  const E = `/api/einsaetze/${einsatz.id}`;
  const uhs = await seede(page, `${E}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: `BHP Wachsen ${stempel}`,
  });
  await seede(page, `${E}/uhs/${uhs.id}/seats/bulk`, { typ: 'bett', menge: 3 });
  await seede(page, `${E}/uhs/${uhs.id}/status`, { status: 'aktiv' });
  return {
    einsatzId: String(einsatz.id),
    pfad: `/einsaetze/${einsatz.id}/unfallhilfsstellen/${uhs.id}`,
    uhsPfad: `${E}/uhs/${uhs.id}`,
  };
}

async function kartenLagen(page: Page) {
  await expect(page.locator('[data-testid="platz-karte"]')).toHaveCount(3);
  // Lage in der Fläche, nicht auf der Seite: Kopf und Werkzeugzeile sind je Dichte verschieden hoch.
  return page.getByTestId('grundriss-flaeche-scroll').evaluate((flaeche) => {
    const f = flaeche.getBoundingClientRect();
    return [...flaeche.querySelectorAll<HTMLElement>('[data-testid="platz-karte"]')].map((k) => {
      const b = k.getBoundingClientRect();
      return { x: Math.round(b.x - f.x), y: Math.round(b.y - f.y), w: b.width, h: b.height };
    });
  });
}

test('Großbild mit drei Betten: die Karten wachsen, liegen ganz in der Fläche, ohne Bildlauf', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await anmelden(page);
  const { pfad } = await wenigeBetten(page);
  await page.goto(pfad);
  const [erste] = await kartenLagen(page);
  expect(erste.w, 'gestreckte Kartenbreite').toBeGreaterThan(140);
  expect(erste.w, 'höchstens das Doppelte').toBeLessThanOrEqual(280);
  expect(erste.h / erste.w, 'Seitenverhältnis bleibt').toBeCloseTo(116 / 140, 2);
  expect(await angeschnitteneKarten(page), 'angeschnittene Platzkarten').toEqual([]);
  const scroll = page.getByTestId('grundriss-flaeche-scroll');
  const masse = await scroll.evaluate((el) => ({
    breit: el.scrollWidth - el.clientWidth,
    hoch: el.scrollHeight - el.clientHeight,
  }));
  expect(masse, 'kein Bildlauf in der gestreckten Fläche').toEqual({ breit: 0, hoch: 0 });
});

// Bei 1920 px entscheidet die Breite der Fläche über den Faktor, und die ist in beiden Stufen
// gleich; die Stufe selbst streckt nichts (design.md D7).
test('Dichtestufe „Handschuh“: dieselbe Kartengröße und Lage wie in „kompakt“', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await anmelden(page);
  const { pfad } = await wenigeBetten(page);
  await page.goto(pfad);
  await stelleDichte(page, 'kompakt');
  const kompakt = await kartenLagen(page);
  await stelleDichte(page, 'handschuh');
  expect(await kartenLagen(page)).toEqual(kompakt);
});

test('Zug in der gestreckten Fläche: der Server speichert die Strecke in Grundmaßen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await anmelden(page);
  const { pfad, uhsPfad } = await wenigeBetten(page);
  await page.goto(pfad);
  const startY = await page.request
    .get(uhsPfad)
    .then((a) => a.json())
    .then(
      (u: { plaetze: { bezeichnung: string; pos_y: number }[] }) =>
        u.plaetze.find((p) => p.bezeichnung === 'Bett 1')!.pos_y,
    );

  // Erst in den Bearbeiten-Modus, dann messen: die Werkzeugzeile darf die Sicht verändern.
  await page.getByRole('button', { name: 'Plätze bearbeiten' }).click();
  await expect(page.getByRole('button', { name: 'Bearbeiten beenden' })).toBeVisible();
  const [vorher] = await kartenLagen(page);
  const faktor = vorher.w / 140;
  expect(faktor, 'Vorbedingung: die Fläche ist gestreckt').toBeGreaterThan(1);
  const karte = page.locator('[data-testid="platz-karte"]', { hasText: 'Bett 1' });
  const box = (await karte.boundingBox())!;
  const patch = page.waitForRequest(
    (r) => r.method() === 'PATCH' && /\/uhs\/\d+\/seats\/\d+$/.test(r.url()),
  );
  // Nach unten: in der Reihe stünde der Platz auf seinem Nachbarn.
  const cx = box.x + box.width / 2;
  const cy = box.y + 14;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 120, { steps: 12 });
  await page.mouse.up();

  const body = JSON.parse((await patch).postData() ?? '{}') as { pos_y: number };
  expect(body.pos_y, 'Strecke durch den Faktor').toBe(startY + Math.round(120 / faktor));
});
