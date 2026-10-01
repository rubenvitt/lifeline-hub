import { expect, test, type Locator, type Page } from '@playwright/test';
import { pruefe } from './kontrast-kern';

/*
 * Deeplink-Hervorhebung an einer echten Tabellenzeile (LFH-696, Spec `farbrollen-kontrast`,
 * „Angesteuerte Zeile trägt eine eigene Zeilentönung“). jsdom rechnet antds CSS nicht: ob die
 * Tönung gegen antds Zellregel als Grund der `td` steht, zeigt nur der Browser.
 *
 * Literale statt Produktimporte (`kontrast-kern.ts`): eine schlechte Palette muss rot werden.
 * Böden aus Kriterium 5: Tag ≥ 7, Nacht ≥ 5.
 */
const ZIEL = { light: 7, dark: 5 } as const;
const TOENUNG = { light: 'rgb(255, 251, 230)', dark: 'rgb(28, 25, 11)' } as const;
/* Zweiter Kanal (WCAG 1.4.1): 3-px-Kante links in `achtung`. Nachts hebt sich die Tönung in der
   Helligkeit kaum ab (gegen den Hover 1,00), die Kante trägt das Auffinden. */
const KANTE = { light: 'rgb(122, 82, 0)', dark: 'rgb(232, 204, 58)' } as const;

/** Die Kante: ein `inset`-Schatten von 3 px links in der Farbe des Modus. */
async function pruefeKante(traeger: Locator, modus: 'light' | 'dark', name: string) {
  const schatten = await traeger.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(schatten, `${modus}/${name}: Kante`).toContain(KANTE[modus]);
  expect(schatten, `${modus}/${name}: Kante`).toMatch(/3px 0px 0px 0px inset/);
}

async function anmelden(page: Page, modus: 'light' | 'dark') {
  await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return ((await r.json()) as { id: number }).id;
}

/** Hintergrund jeder Zelle der Zeile, nach Ende laufender Übergänge (`transition` 0,4 s). */
async function zellgruende(zeile: Locator): Promise<string[]> {
  await zeile.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  return zeile.evaluate((tr) =>
    [...tr.querySelectorAll(':scope > td')].map((td) => getComputedStyle(td).backgroundColor),
  );
}

/**
 * Misst jedes Element mit eigenem Text, das AUF der Tönung steht: zwischen ihm und dem nächsten
 * Vorfahren mit dem Tönungsgrund (die `td`, die Karte) liegt keine eigene Fläche. Dazu zählt der
 * getönte Träger selbst (antd schreibt einen reinen Textwert direkt in die `td`). Text auf eigener
 * Fläche (Tag, Chip) steht NICHT auf der Tönung; seinen Boden misst die Spec seiner Fläche
 * (Folgetask LFH-891 für die blauen Tags).
 */
async function pruefeTextAufToenung(traeger: Locator, modus: 'light' | 'dark', name: string) {
  const anzahl = await traeger.evaluate((wurzel, toenung) => {
    let n = 0;
    for (const el of [wurzel, ...wurzel.querySelectorAll('*')]) {
      const eigenerText = [...el.childNodes].some(
        (k) => k.nodeType === Node.TEXT_NODE && k.textContent!.trim() !== '',
      );
      if (!eigenerText || (el as HTMLElement).offsetParent === null) continue;
      let aufToenung = false;
      for (let e: Element | null = el; e; e = e.parentElement) {
        const grund = getComputedStyle(e).backgroundColor;
        if (grund === toenung) {
          aufToenung = true;
          break;
        }
        if (grund !== 'rgba(0, 0, 0, 0)') break; // eigene Fläche vor der Tönung
        if (e === wurzel) break;
      }
      if (aufToenung) el.setAttribute('data-lfh-messung', String(n++));
    }
    return n;
  }, TOENUNG[modus]);
  expect(anzahl, `${name}: der Träger zeigt messbaren Text auf der Tönung`).toBeGreaterThan(0);
  for (let i = 0; i < anzahl; i++) {
    // Seitenweit gesucht: der Träger selbst kann markiert sein. Ein Aufruf je Test.
    const text = traeger.page().locator(`[data-lfh-messung="${i}"]`);
    await pruefe(text, ZIEL[modus], `${modus}/${name}/hervorgehoben/${await text.innerText()}`);
  }
}

for (const modus of ['light', 'dark'] as const) {
  test(`${modus}: angesteuerte Fahrzeugzeile trägt die Hervorhebungstönung und hält den Boden`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    // Ab `md` rendert `Datensicht` die Fahrzeuge als Tabelle.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 696 ${modus} ${Date.now()}`,
    });
    const basis = `/api/einsaetze/${einsatzId}`;
    const ziel = await post(page, `${basis}/fahrzeuge`, {
      adhoc: { funkrufname: 'Florian 696 A' },
    });
    await post(page, `${basis}/fahrzeuge`, { adhoc: { funkrufname: 'Florian 696 B' } });

    await page.goto(`/einsaetze/${einsatzId}/fahrzeuge?fahrzeug=${ziel}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    await page.mouse.move(0, 0);

    const zeile = page.locator('tr.zeile-hervorgehoben');
    await expect(zeile).toHaveCount(1);
    await expect(zeile).toContainText('Florian 696 A');
    const andere = page.locator('tr[data-row-key]').filter({ hasText: 'Florian 696 B' });
    await expect(andere).toHaveCount(1);
    await expect(andere).not.toHaveClass(/zeile-hervorgehoben/);

    // Szenario „Angesteuerte Tabellenzeile ohne Zeiger“: JEDE Zelle trägt die Tönung, auch die
    // fixierte Kennungsspalte mit ihrem eigenen deckenden Grund.
    const gruende = await zellgruende(zeile);
    expect(gruende.length).toBeGreaterThan(1);
    expect(gruende, `${modus}: Grund der Zellen`).toEqual(gruende.map(() => TOENUNG[modus]));

    // Szenario „Zweiter Kanal“: die erste Zelle trägt die Kante, die anderen nicht.
    await pruefeKante(zeile.locator('td').first(), modus, 'Fahrzeuge');
    expect(
      await zeile
        .locator('td')
        .last()
        .evaluate((el) => getComputedStyle(el).boxShadow),
    ).toBe('none');

    // Szenario „Zeilentext hält den Textboden“.
    await pruefeTextAufToenung(zeile, modus, 'Fahrzeuge');

    // Szenario „Unterscheidbar vom Zeiger“: eine NICHT angesteuerte Zeile unter dem Zeiger.
    await andere.locator('td').last().hover();
    const hover = await zellgruende(andere);
    expect(hover.length).toBeGreaterThan(0);
    for (const grund of hover) {
      expect(grund, `${modus}: Hover-Grund gleicht der Hervorhebung`).not.toBe(TOENUNG[modus]);
    }
  });
}

for (const modus of ['light', 'dark'] as const) {
  test(`${modus}: angesteuerte ETB-Karte trägt die Hervorhebungstönung und hält den Boden`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 696 ETB ${modus} ${Date.now()}`,
    });
    const basis = `/api/einsaetze/${einsatzId}`;
    const ziel = await post(page, `${basis}/etb`, { typ: 'meldung', inhalt: 'Ziel 696' });
    await post(page, `${basis}/etb`, { typ: 'meldung', inhalt: 'Nachbar 696' });

    // Szenario „Angesteuerte Karte einer Zeitachse“: der Baustein setzt seinen Grund inline,
    // die Klasse allein färbte hier nichts (LFH-696, Entscheidung 5 in
    // `openspec/changes/archive/2026-10-01-lfh-696-deeplink-hervorhebung-rolle/design.md`).
    await page.goto(`/einsaetze/${einsatzId}/etb?eintrag=${ziel}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    await page.mouse.move(0, 0);
    const karte = page.locator('[data-testid="etb-ereigniszeile"].zeile-hervorgehoben');
    await expect(karte).toHaveCount(1);
    await expect(karte).toContainText('Ziel 696');
    await expect
      .poll(() => karte.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe(TOENUNG[modus]);
    const nachbar = page
      .locator('[data-testid="etb-ereigniszeile"]')
      .filter({ hasText: 'Nachbar 696' });
    expect(await nachbar.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
      TOENUNG[modus],
    );

    await pruefeKante(karte, modus, 'ETB');
    expect(await nachbar.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');

    await pruefeTextAufToenung(karte, modus, 'ETB');
  });
}
