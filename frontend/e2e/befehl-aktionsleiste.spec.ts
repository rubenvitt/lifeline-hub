import { expect, test, type Page } from '@playwright/test';
import { pruefeFokusVerdeckung } from './fokus-kern';

/**
 * Verankerte Aktionsleiste am Befehlsentwurf, Prüflisten-Zeile 13 der Bedien-Leitlinie
 * (WCAG 2.4.11 „Focus Not Obscured (Minimum)"): eine sticky Leiste über einem langen
 * Markdown-Formular ist genau die Konstruktion, auf die 2.4.11 zielt. Die Struktur prüft
 * `src/pages/BefehlDetailPage.test.tsx`.
 *
 * DIE UNGLEICHHEIT TRÄGT: bei 1024 px gibt es keine verankerte Leiste, „kein Ziel verdeckt"
 * ist dort trivial wahr. Der 1024-Lauf behauptet deshalb die ABWESENHEIT der Verankerung
 * (`position: static`) — ein Bau, der in jeder Breite verankert, wird daran rot.
 *
 * SELBSTBEWEIS GEGEN DIE ECHTE LEISTE: der letzte Test setzt eine Sonde als GESCHWISTER hinter
 * die echte Leiste (Vorfahren nimmt der Kern aus) und prüft die Gegenprobe am selben Ziel.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Die fünf Abschnitte der Vorlage `befehl_ladef` (`src/befehle/vorlagen.ts`). */
const ABSCHNITTE = [
  'Lage',
  'Auftrag',
  'Durchführung',
  'Einsatzunterstützung',
  'Führung und Kommunikation',
];
const AKTIONEN = ['Drucken / als PDF', 'Entwurf speichern', 'Freigeben'];

/**
 * Kleinster freier Streifen zwischen der Oberkante eines per Tabulator angesteuerten
 * Formularfelds und der Oberkante der verankerten Leiste.
 *
 * `toBeInViewport()` (ratio 0) wäre auch bei einem Feld zu 99 % hinter der Leiste grün, und
 * der Messkern meldet nur VOLLSTÄNDIGE Verdeckung — ein hohes Abschnittsfeld ist von der
 * Leiste nie vollständig verdeckt. Dazwischen liegt der Fehlerfall: ohne Fokus-Scroll-Abzug
 * stand ein Feld einen Pixel unter der Leistenoberkante.
 *
 * Gemessen im Durchlauf, nicht an einem per `.focus()` angesprungenen Feld: ein gezielter
 * Fokus scrollt anders, und die Zusicherung wäre auch ohne Abzug grün. Die Knöpfe IN der
 * Leiste sind ausgenommen.
 */
async function kleinsterFreiraum(page: Page, schritte: number): Promise<number> {
  let kleinster = Number.POSITIVE_INFINITY;
  for (let i = 0; i < schritte; i += 1) {
    await page.keyboard.press('Tab');
    const wert = await page.evaluate(() => {
      const fokus = document.activeElement;
      const leiste = document.querySelector('[data-lfh="befehl-aktionen"]');
      if (fokus == null || leiste == null || leiste.contains(fokus)) return null;
      if (fokus.closest('.befehl-print-root') == null) return null;
      if (fokus.tagName !== 'TEXTAREA' && fokus.tagName !== 'INPUT') return null;
      return leiste.getBoundingClientRect().top - fokus.getBoundingClientRect().top;
    });
    if (wert != null) kleinster = Math.min(kleinster, wert);
  }
  return kleinster;
}

async function entwurfBereit(
  page: Page,
  viewport: { width: number; height: number },
  dichte: 'kompakt' | 'komfortabel' | 'handschuh' = 'kompakt',
) {
  await page.setViewportSize(viewport);
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);

  // Seeding per `page.request` (Cookie-Jar geteilt).
  const einsatz = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Befehlsleiste ${Date.now()}` },
  });
  expect(einsatz.ok(), await einsatz.text()).toBe(true);
  const einsatzId = (await einsatz.json()).id as number;
  const befehl = await page.request.post(`/api/einsaetze/${einsatzId}/befehle`, {
    data: { vorlage: 'befehl_ladef', titel: 'Einsatzbefehl Übung' },
  });
  expect(befehl.ok(), await befehl.text()).toBe(true);
  const befehlId = (await befehl.json()).id as number;

  /**
   * DIE DICHTESTUFE IST TEIL DER MESSUNG: die Leistenknöpfe folgen der Staffel, die Leiste ist
   * in `handschuh` mehr als doppelt so hoch wie in `kompakt`. Einen Treffer des Messkerns
   * liefert auch `handschuh` nicht — die scharfe Zusicherung dort ist die Kopplung.
   */
  await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);
  await page.goto(`/einsaetze/${einsatzId}/auftraege/befehle/${befehlId}`);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
  const seite = page.locator('.befehl-print-root');
  await expect(seite.getByLabel('Titel')).toBeVisible();

  // Benannte Fokusziele: ohne sie wäre ein Durchlauf grün, der das letzte Abschnittsfeld nie
  // erreicht. Auf die Seite gescopt: ab `lg` trägt das Modul-Akkordeon einen zweiten Treffer
  // für „Lage".
  const ziele: { name: string; ort: ReturnType<Page['getByLabel']> }[] = [
    { name: 'Titel', ort: seite.getByLabel('Titel') },
    ...ABSCHNITTE.map((name) => ({ name, ort: seite.getByLabel(name, { exact: true }) })),
    ...AKTIONEN.map((name) => ({ name, ort: seite.getByRole('button', { name, exact: true }) })),
  ];
  for (const { name, ort } of ziele) {
    await expect(ort, name).toHaveCount(1);
    await ort.evaluate((el, kennung) => el.setAttribute('data-e2e-fokus', kennung), name);
  }

  const block = seite.locator('[data-lfh="befehl-aktionen"]');
  await expect(block).toHaveCount(1);
  return {
    block,
    seite,
    zielnamen: ziele.map(({ name }) => name),
    letzterAbschnitt: seite.getByLabel(ABSCHNITTE[ABSCHNITTE.length - 1], { exact: true }),
  };
}

for (const dichte of ['kompakt', 'handschuh'] as const) {
  test(`390 px, ${dichte}: die Leiste ist verankert, „Freigeben" bleibt im Bild und verdeckt kein Fokusziel`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const { block, seite, zielnamen, letzterAbschnitt } = await entwurfBereit(
      page,
      { width: 390, height: 844 },
      dichte,
    );

    await expect(block, 'unterhalb von `lg` gehören die Aktionen an den unteren Rand').toHaveCSS(
      'position',
      'sticky',
    );

    // Vorbedingung: ohne Bildlaufreserve klebt die Leiste am Seitenende statt über dem Inhalt.
    const reserve = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    expect(reserve, 'Vorbedingung: die Seite muss überhaupt scrollen').toBeGreaterThan(0);

    // Cursor im letzten Abschnittsfeld, „Freigeben" erreichbar ohne zu scrollen —
    // `toBeInViewport`, weil `toBeVisible` auch unterhalb des sichtbaren Bereichs besteht.
    await letzterAbschnitt.focus();
    await expect(seite.getByRole('button', { name: 'Freigeben', exact: true })).toBeInViewport();

    // Und das Feld selbst darf dabei nicht hinter die Leiste gerutscht sein.
    await expect(letzterAbschnitt).toBeInViewport();

    /**
     * Der Streifen, den `toBeInViewport()` und der Messkern nicht sehen (s. `kleinsterFreiraum`).
     * Die einzige Zeile, die den Abzug auch prüft, wenn er am falschen Scrollport hinge.
     */
    await seite.getByRole('link', { name: 'Aufträge/Befehle' }).focus();
    const freiraum = await kleinsterFreiraum(page, 30);
    expect(
      freiraum,
      `kleinster freier Streifen eines Formularfelds über der Leiste (${Math.round(freiraum)}px)`,
    ).toBeGreaterThan(20);

    /**
     * DER FOKUS-SCROLL RECHNET DIE LEISTE AB — der MECHANISMUS, der auch in `handschuh` greift,
     * wo die Geometrie allein nicht mehr scharf stellt. Geprüft wird die KOPPLUNG:
     * `scroll-padding-block-end` am Scrollport trägt die gemessene Leistenhöhe. Nicht
     * behauptet ist vollständige Freistellung (2.4.12) — ein Feld, höher als der Restraum,
     * lässt sich nicht freistellen.
     */
    const abzug = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingBlockEnd),
    );
    const leistenhoehe = (await block.boundingBox())!.height;
    expect(
      abzug,
      `Fokus-Scroll-Abzug ${abzug}px gegen Leistenhöhe ${leistenhoehe}px`,
    ).toBeGreaterThanOrEqual(leistenhoehe);

    await seite.getByRole('link', { name: 'Aufträge/Befehle' }).focus();
    const befund = await pruefeFokusVerdeckung(page, 60);
    expect(
      befund.besuchteZiele.sort(),
      'Vorbedingung: jedes Feld und jede Aktion muss per Tabulator besucht werden',
    ).toEqual([...zielnamen].sort());
    expect(befund.fixierteKandidaten, 'Vorbedingung: fixierte Knoten vorhanden').toBeGreaterThan(0);
    expect(befund.verdeckt, befund.verdeckt.join('\n')).toEqual([]);

    /**
     * Die globale Eigenschaft wird beim Verlassen wieder weggenommen: sie hängt am
     * Wurzelelement und überlebte sonst die Route, jeder folgende Fokus-Scroll verschöbe sich
     * still um eine Leistenhöhe. Belegt zugleich, dass React die Aufräumfunktion des
     * Callback-Refs ruft.
     */
    await seite.getByRole('link', { name: 'Aufträge/Befehle' }).click();
    // Auf den ABGEHÄNGTEN Baum warten, nicht auf die URL: React räumt eine Runde später auf,
    // als der Router navigiert.
    await expect(page).toHaveURL(/\/auftraege$/);
    await expect(page.locator('.befehl-print-root')).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingBlockEnd),
      ),
      'nach dem Verlassen der Seite darf kein Abzug stehenbleiben',
    ).toBe(0);

    test.info().annotations.push({
      type: 'messwert',
      description: `390×844 ${dichte}: Leiste ${Math.round(leistenhoehe)}px, Abzug ${abzug}px, frei ${Math.round(freiraum)}px, ${befund.besuchteZiele.length} Routenziele, ${befund.stoppsGesamt} Stopps, Reserve ${reserve}px, ${befund.verdeckt.length} Verdeckungen`,
    });
  });
}

test('1024 px: oberhalb der Schwelle ist NICHTS verankert, die Aktionen stehen im Kopf', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { block, seite, zielnamen } = await entwurfBereit(page, { width: 1024, height: 768 });

  // DIE TRAGENDE AUSSAGE DIESES LAUFS: erst sie macht einen immer-verankerten Bau rot.
  await expect(
    block,
    'ab `lg` (992) gehören die Aktionen in den Kopf — 1024 ist die Probe knapp oberhalb',
  ).toHaveCSS('position', 'static');
  // Der Block steht VOR dem Formular, also im Kopfbereich.
  expect(
    await block.evaluate((el) => {
      const titel = document.querySelector('[data-e2e-fokus="Titel"]')!;
      return el.compareDocumentPosition(titel) & Node.DOCUMENT_POSITION_FOLLOWING;
    }),
    'im Kopfzweig steht der Aktionsblock vor dem Titelfeld',
  ).toBeTruthy();

  // Die zweite Hälfte der Ungleichheit: ohne verankerte Leiste gibt es nichts abzuziehen.
  expect(
    await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingBlockEnd),
    ),
    'ohne verankerte Leiste kein Fokus-Scroll-Abzug',
  ).toBe(0);

  await seite.getByRole('link', { name: 'Aufträge/Befehle' }).focus();
  const befund = await pruefeFokusVerdeckung(page, 60);
  expect(befund.besuchteZiele.sort()).toEqual([...zielnamen].sort());
  expect(befund.verdeckt, befund.verdeckt.join('\n')).toEqual([]);

  test.info().annotations.push({
    type: 'messwert',
    description: `1024×768: ${befund.besuchteZiele.length} Routenziele, ${befund.stoppsGesamt} Stopps, ${befund.verdeckt.length} Verdeckungen`,
  });
});

test('Selbstbeweis: ein Fokusziel hinter der echten Aktionsleiste wird erkannt', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { block, seite } = await entwurfBereit(page, { width: 390, height: 844 });
  await block.evaluate((el) => el.classList.add('e2e-befehl-leiste'));
  await seite.getByLabel('Titel').focus();
  await expect(block).toBeInViewport();

  await block.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const probe = document.createElement('button');
    probe.id = 'e2e-leistenprobe';
    probe.textContent = 'Leistenprobe';
    probe.setAttribute('data-e2e-fokus', 'Leistenprobe');
    Object.assign(probe.style, {
      position: 'fixed',
      left: `${r.left + 10}px`,
      top: `${r.top + 10}px`,
      width: '40px',
      height: '20px',
      zIndex: '0',
    });
    // GESCHWISTER, kein Kind: der Messkern nimmt Vorfahren aus.
    el.before(probe);
    const start = document.createElement('button');
    start.id = 'e2e-probenstart';
    start.style.position = 'fixed';
    probe.before(start);
    start.focus({ preventScroll: true });
  });

  const verdeckt = await pruefeFokusVerdeckung(page, 1);
  expect(verdeckt.besuchteZiele).toEqual(['Leistenprobe']);
  expect(verdeckt.verdeckt).toHaveLength(1);
  expect(verdeckt.verdeckt[0]).toContain('e2e-befehl-leiste');

  // Gegenprobe am SELBEN Ziel: außerhalb der Leistengeometrie muss es frei sein.
  await page.locator('#e2e-leistenprobe').evaluate((el) => {
    el.style.top = '100px';
  });
  await page.locator('#e2e-probenstart').focus();
  expect((await pruefeFokusVerdeckung(page, 1)).verdeckt).toEqual([]);
});
