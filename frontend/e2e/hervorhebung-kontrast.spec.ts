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
const TOENUNG = { light: 'rgb(255, 251, 230)', dark: 'rgb(43, 38, 17)' } as const;

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

    // Szenario „Zeilentext hält den Textboden“: jedes Element der Zeile mit eigenem Text, das
    // auf dem Grund der Zelle steht. Text auf eigener Fläche (Tag, Chip) steht NICHT auf der
    // Tönung; seinen Boden misst die Spec seiner Fläche, nicht diese (Grenze, LFH-696).
    const anzahl = await zeile.evaluate((tr) => {
      let n = 0;
      for (const el of tr.querySelectorAll('td *')) {
        const eigenerText = [...el.childNodes].some(
          (k) => k.nodeType === Node.TEXT_NODE && k.textContent!.trim() !== '',
        );
        if (!eigenerText || (el as HTMLElement).offsetParent === null) continue;
        let eigeneFlaeche = false;
        for (let e: Element | null = el; e && e.tagName !== 'TD'; e = e.parentElement) {
          const grund = getComputedStyle(e).backgroundColor;
          if (grund !== 'rgba(0, 0, 0, 0)' && grund !== 'transparent') eigeneFlaeche = true;
        }
        if (!eigeneFlaeche) el.setAttribute('data-lfh-messung', String(n++));
      }
      return n;
    });
    expect(anzahl, 'die Zeile trägt messbaren Text').toBeGreaterThan(0);
    for (let i = 0; i < anzahl; i++) {
      const text = zeile.locator(`[data-lfh-messung="${i}"]`);
      await pruefe(text, ZIEL[modus], `${modus}/Fahrzeuge/hervorgehoben/${await text.innerText()}`);
    }

    // Szenario „Unterscheidbar vom Zeiger“: eine NICHT angesteuerte Zeile unter dem Zeiger.
    await andere.locator('td').last().hover();
    const hover = await zellgruende(andere);
    expect(hover.length).toBeGreaterThan(0);
    for (const grund of hover) {
      expect(grund, `${modus}: Hover-Grund gleicht der Hervorhebung`).not.toBe(TOENUNG[modus]);
    }
  });
}
