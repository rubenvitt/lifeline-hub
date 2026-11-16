import { expect, request, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, benutzerAnlegen, mitgliedEintragen } from './rollen-kern';

/**
 * Kein Textknoten rechnet auf Times oder Arial (LLH-1772, Schrift-Reset in `index.css`).
 *
 * Die App setzte ihre Textschrift nur über antd auf `.ant-app`. Alles daneben fiel auf die
 * Vorgabe des Browsers: Portale an `document.body` (das Eingangsband) in Times New Roman, native
 * Bedienelemente (das Suchfeld der Betroffenen) in Arial bzw. der Systemschrift. Was der Browser
 * tatsächlich wählt, zeigt nur der Browser, deshalb e2e (`e2e/AGENTS.md`, Zuschnitt).
 *
 * GEPRÜFT: auf Überblick, Betroffenen (mit Suchfeld) und ETB (mit Eingangsband) beginnt die
 * berechnete `font-family` jedes sichtbaren Textknotens und jedes Eingabefelds mit einer der
 * App-Schriften (`LFH Archivo`, `LFH Archivo Narrow`, `LFH JetBrains Mono`).
 *
 * Mutationsprobe: `font-family` aus `html, body` in `index.css` entfernt → rot am Eingangsband;
 * `font: inherit` für `input` entfernt → rot am Suchfeld der Betroffenen.
 */

const APP_SCHRIFTEN = ['LFH Archivo', 'LFH Archivo Narrow', 'LFH JetBrains Mono'];

/** Sichtbare Textknoten und Eingabefelder, deren erste Schrift keine App-Schrift ist. */
async function fremdeSchriften(page: Page, wurzel = 'body') {
  return page.evaluate(
    ({ wurzel, erlaubt }) => {
      const erste = (el: Element) =>
        getComputedStyle(el)
          .fontFamily.split(',')[0]
          .trim()
          .replace(/^["']|["']$/g, '');
      const sichtbar = (el: Element) => {
        const k = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return k.width > 0 && k.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      // Nicht Teil der App: die Devtools von TanStack Query (nur im Dev-Server) und Grafik.
      const FREMD = 'script, style, noscript, svg, .tsqd-parent-container, [class*="tsqd-"]';
      const fehler = new Set<string>();
      const start = document.querySelector(wurzel);
      if (!start) return [`Wurzel ${wurzel} fehlt`];
      const gang = document.createTreeWalker(start, NodeFilter.SHOW_TEXT);
      for (let knoten = gang.nextNode(); knoten; knoten = gang.nextNode()) {
        const text = knoten.textContent?.trim();
        const el = knoten.parentElement;
        if (!text || !el || !sichtbar(el)) continue;
        if (el.closest(FREMD)) continue;
        const familie = erste(el);
        if (!erlaubt.includes(familie)) fehler.add(`${familie}: „${text.slice(0, 40)}“`);
      }
      for (const feld of start.querySelectorAll('input, textarea, select, button')) {
        if (!sichtbar(feld) || feld.closest(FREMD)) continue;
        const familie = erste(feld);
        if (!erlaubt.includes(familie)) {
          fehler.add(
            `${familie}: <${feld.tagName.toLowerCase()} ${feld.getAttribute('aria-label') ?? ''}>`,
          );
        }
      }
      return [...fehler];
    },
    { wurzel, erlaubt: APP_SCHRIFTEN },
  );
}

test('kein Textknoten rechnet auf Times oder Arial: Überblick, Betroffene, Eingangsband', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmeldenAlsAdmin(page, { startseite: false });
  const angelegt = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Schrift ${Date.now()}` },
  });
  expect(angelegt.ok(), `POST /api/einsaetze: ${angelegt.status()}`).toBe(true);
  const einsatzId = ((await angelegt.json()) as { id: number }).id;

  // ── Überblick ─────────────────────────────────────────────────────────────────────────
  await page.goto(`/einsaetze/${einsatzId}`);
  await expect(page.locator('[data-lfh="kopf-uhr"]')).toBeVisible();
  await expect.poll(() => fremdeSchriften(page)).toEqual([]);

  // ── Betroffene: das nackte Suchfeld der Datensicht ────────────────────────────────────
  await page.goto(`/einsaetze/${einsatzId}/personen`);
  const suche = page.locator('input[type="search"]').first();
  await expect(suche).toBeVisible();
  await suche.fill('Muster');
  await expect.poll(() => fremdeSchriften(page)).toEqual([]);

  // ── ETB mit Eingangsband (Portal an document.body) ────────────────────────────────────
  const konto = await benutzerAnlegen(page, 'fuehrungspersonal', 'E2E Schrift Zweiter');
  await mitgliedEintragen(page, String(einsatzId), konto.id, 'fuehrungspersonal');
  const zweiter = await request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const login = await zweiter.post('/api/auth/login', {
      data: { benutzername: konto.benutzername, passwort: konto.passwort },
    });
    expect(login.ok(), `Anmelden zweiter Schirm: ${login.status()}`).toBe(true);
    const strom = page.waitForResponse(
      (r) => r.url().endsWith(`/api/einsaetze/${einsatzId}/live`) && r.status() === 200,
    );
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await strom;
    // Erst wenn die Erfassung steht, den Fokus lösen: steht er in einem Feld, hält der
    // Eingangshinweis an (Spec `benachrichtigungen`), und das ETB fokussiert beim Aufbau.
    await expect(
      page.locator('.etb-erfassung-sticky').getByRole('button', { name: 'Erfassen', exact: true }),
    ).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const meldung = await zweiter.post(`/api/einsaetze/${einsatzId}/meldungen`, {
      data: {
        absender: 'Abschnitt Deich Ost',
        meldeweg: 'funk',
        inhalt: 'Pegel am Deichtor 2,40 m, steigend.',
        meldungsart: 'lagemeldung',
        ereigniszeit: '2026-10-01 09:30:00',
      },
    });
    expect(meldung.ok(), `Lagemeldung: ${meldung.status()}`).toBe(true);
    const band = page.locator('[data-lfh="eingangsband"]');
    await expect(band).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => fremdeSchriften(page, '[data-lfh="eingangsband"]')).toEqual([]);
    await expect.poll(() => fremdeSchriften(page)).toEqual([]);
  } finally {
    await zweiter.dispose();
  }
});
