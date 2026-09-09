import { expect, test, type Page } from '@playwright/test';
import { pruefeFokusVerdeckung } from './fokus-kern';

/**
 * LFH-465 — verankerte Aktionsleiste am Befehlsentwurf, Prüflisten-Zeile 13 der
 * Bedien-Leitlinie (WCAG 2.4.11 „Focus Not Obscured (Minimum)").
 *
 * ── WARUM ES DIESE DATEI GIBT ───────────────────────────────────────────────────────────
 * LFH-343 · C8 hat den Halbsatz „unterhalb des Tablet-Breakpoints die Aktionsleiste am
 * unteren Rand verankern" AUSDRÜCKLICH offen gelassen, mit dieser Begründung: eine sticky
 * Leiste über einem langen Markdown-Formular ist genau die Konstruktion, auf die 2.4.11
 * zielt — das unterste fokussierte Feld läge dahinter. Sie einzubauen, ohne das zu messen,
 * hieße einen Befund gegen einen anderen zu tauschen. Diese Datei ist die Messung.
 *
 * ── WARUM NICHT IN VITEST ───────────────────────────────────────────────────────────────
 * jsdom rechnet kein Layout: `position: sticky` hat dort keine geometrische Wirkung, jedes
 * Rechteck ist 0×0. Die STRUKTUR (ein Aktionsblock, zwei Orte, Autosave-Beleg geht mit)
 * fällt in `src/pages/BefehlDetailPage.test.tsx`; hier fällt, was nur ein echter Browser
 * beantwortet.
 *
 * ── DIE UNGLEICHHEIT TRÄGT, NICHT DER 390-ER LAUF ALLEIN ────────────────────────────────
 * Bei 1024 px gibt es keine verankerte Leiste, „kein Ziel verdeckt" ist dort also trivial
 * wahr — und `fixierteKandidaten > 0` fängt das nicht ab, weil die App-Kopfzeile ohnehin
 * fixiert ist. Der 1024-Lauf behauptet deshalb ausdrücklich die ABWESENHEIT der Verankerung
 * (`position: static` am Aktionsblock). Ein Bau, der in jeder Breite verankert, wird daran
 * rot; ohne diese Zeile bliebe er grün.
 *
 * ── SELBSTBEWEIS GEGEN DIE ECHTE LEISTE ─────────────────────────────────────────────────
 * Der Messkern bringt seinen eigenen Positivnachweis mit (`fokus-verdeckung.spec.ts`, erster
 * Test, mit einem erfundenen Vollbild-Verdecker). Der reicht hier nicht: er belegt, dass der
 * Kern rechnen kann, nicht dass DIESE Leiste verdecken würde, wenn der Fokus-Scroll sie
 * ignorierte. Der letzte Test setzt eine Sonde als GESCHWISTER hinter die echte Leiste
 * (Vorfahren sind im Kern ausgenommen) und prüft die Gegenprobe am selben Ziel gleich mit.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Die fünf Abschnitte der Vorlage `befehl_ladef` (`src/befehle/vorlagen.ts`). */
const ABSCHNITTE = ['Lage', 'Auftrag', 'Durchführung', 'Einsatzunterstützung', 'Führung und Kommunikation'];
const AKTIONEN = ['Drucken / als PDF', 'Entwurf speichern', 'Freigeben'];

async function entwurfBereit(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);

  // Seeding per `page.request` (Cookie-Jar geteilt) statt über die Oberfläche — dieselbe
  // Begründung wie in `fokus-verdeckung.spec.ts`.
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

  await page.goto(`/einsaetze/${einsatzId}/auftraege/befehle/${befehlId}`);
  const seite = page.locator('.befehl-print-root');
  await expect(seite.getByLabel('Titel')).toBeVisible();

  // Benannte Fokusziele: ohne sie wäre ein Durchlauf grün, der das letzte Abschnittsfeld
  // nie erreicht — und genau dort steht der Cursor, wenn die Leiste stört.
  //
  // AUF DIE SEITE GESCOPT, und das ist gemessen: ab `lg` steht das Modul-Akkordeon des
  // Einsatzrahmens inline im Baum und trägt einen zweiten Treffer für „Lage" (das
  // Lage-Modul). Ungescopt scheiterte der 1024-Lauf an der Fixture statt an der Sache.
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

test('390 px: die Leiste ist verankert, „Freigeben" bleibt im Bild und verdeckt kein Fokusziel', async ({ page }) => {
  test.setTimeout(90_000);
  const { block, seite, zielnamen, letzterAbschnitt } = await entwurfBereit(page, { width: 390, height: 844 });

  await expect(block, 'unterhalb von `lg` gehören die Aktionen an den unteren Rand').toHaveCSS(
    'position',
    'sticky',
  );

  // Vorbedingung: ohne Bildlaufreserve klebt die Leiste am Seitenende statt über dem
  // Inhalt, und jede Aussage darunter wäre trivial wahr.
  const reserve = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
  expect(reserve, 'Vorbedingung: die Seite muss überhaupt scrollen').toBeGreaterThan(0);

  // Das Akzeptanzkriterium wörtlich: Cursor im letzten Abschnittsfeld, „Freigeben"
  // erreichbar ohne zu scrollen. `toBeInViewport`, nicht `toBeVisible` — ein Element
  // unterhalb des sichtbaren Bereichs ist im Sinne von `toBeVisible` sichtbar.
  await letzterAbschnitt.focus();
  await expect(seite.getByRole('button', { name: 'Freigeben', exact: true })).toBeInViewport();

  // Und das Feld selbst darf dabei nicht hinter die Leiste gerutscht sein.
  await expect(letzterAbschnitt).toBeInViewport();

  /**
   * DER FOKUS-SCROLL RECHNET DIE LEISTE AB — und diese Zusicherung steht hier, weil der
   * Messkern sie NICHT trägt: er meldet nur VOLLSTÄNDIGE Verdeckung (WCAG 2.4.11 Minimum),
   * und ein 164 px hohes Abschnittsfeld ist von einer 78 px hohen Leiste nie vollständig
   * verdeckt. Gemessen ohne den Abzug: Chromium scrollt beim Tabulatorwechsel mit
   * „nearest" und ließ `einsatzunterstuetzung` auf `top: 764` stehen, während die Leiste
   * bei 766 begann — zwei Pixel frei. Mit dem Abzug sind es 45.
   *
   * Geprüft wird die KOPPLUNG, nicht ein Pixelwert: `scroll-padding-block-end` am
   * Scrollport trägt die gemessene Leistenhöhe. Fällt die CSS-Regel weg oder setzt der
   * ResizeObserver die Eigenschaft nicht, wird diese Zeile rot — beides per Mutationsprobe
   * belegt. Was hier NICHT behauptet wird: vollständige Freistellung (2.4.12 Enhanced) —
   * ein Feld, das höher ist als der Restraum, lässt sich nicht freistellen.
   */
  const abzug = await page.evaluate(
    () => Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingBlockEnd),
  );
  const leistenhoehe = (await block.boundingBox())!.height;
  expect(abzug, `Fokus-Scroll-Abzug ${abzug}px gegen Leistenhöhe ${leistenhoehe}px`)
    .toBeGreaterThanOrEqual(leistenhoehe);

  await seite.getByRole('link', { name: 'Aufträge/Befehle' }).focus();
  const befund = await pruefeFokusVerdeckung(page, 60);
  expect(
    befund.besuchteZiele.sort(),
    'Vorbedingung: jedes Feld und jede Aktion muss per Tabulator besucht werden',
  ).toEqual([...zielnamen].sort());
  expect(befund.fixierteKandidaten, 'Vorbedingung: fixierte Knoten vorhanden').toBeGreaterThan(0);
  expect(befund.verdeckt, befund.verdeckt.join('\n')).toEqual([]);

  test.info().annotations.push({
    type: 'messwert',
    description: `390×844: ${befund.besuchteZiele.length} Routenziele, ${befund.stoppsGesamt} Stopps, Reserve ${reserve}px, ${befund.verdeckt.length} Verdeckungen`,
  });
});

test('1024 px: oberhalb der Schwelle ist NICHTS verankert, die Aktionen stehen im Kopf', async ({ page }) => {
  test.setTimeout(90_000);
  const { block, seite, zielnamen } = await entwurfBereit(page, { width: 1024, height: 768 });

  // DIE TRAGENDE AUSSAGE DIESES LAUFS. „Keine Verdeckung" allein wäre hier ohne Leiste
  // trivial wahr; erst diese Zeile macht einen immer-verankerten Bau rot.
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

  // Die zweite Hälfte der Ungleichheit: ohne verankerte Leiste gibt es auch nichts
  // abzuziehen. Ein Bau, der den Abzug fest verdrahtet, verschöbe hier jeden Fokus-Scroll
  // um eine Leistenhöhe, die es nicht gibt.
  expect(
    await page.evaluate(
      () => Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingBlockEnd),
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

test('Selbstbeweis: ein Fokusziel hinter der echten Aktionsleiste wird erkannt', async ({ page }) => {
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
      position: 'fixed', left: `${r.left + 10}px`, top: `${r.top + 10}px`,
      width: '40px', height: '20px', zIndex: '0',
    });
    // GESCHWISTER, kein Kind: ein `sticky` Vorfahr trägt sein Ziel, er verdeckt es nicht —
    // der Messkern nimmt Vorfahren ausdrücklich aus.
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

  // Gegenprobe am SELBEN Ziel: außerhalb der Leistengeometrie muss es frei sein. Ohne sie
  // bliebe offen, ob der Kern nicht jedes Ziel meldet.
  await page.locator('#e2e-leistenprobe').evaluate((el) => { el.style.top = '100px'; });
  await page.locator('#e2e-probenstart').focus();
  expect((await pruefeFokusVerdeckung(page, 1)).verdeckt).toEqual([]);
});
