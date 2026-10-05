import { expect, test, type Page } from '@playwright/test';
import { flaeche, pruefe, ruheUndZeiger } from './kontrast-kern';

/**
 * Blauer Text auf der Hervorhebungsfläche `flaeche3` (LFH-879, Kriterium 5: Tag ≥ 7 : 1, Nacht
 * ≥ 5 : 1). `flaeche3` ist die dunkelste Flächenstufe des Tages; `bedien` (6,71) und
 * `bedienHover` (5,74) hielten darauf den Textboden nicht. Gemessen im Browser, weil die
 * Kachelfläche unter dem Zeiger aus `:hover` kommt, das jsdom nicht rechnet.
 *
 * GEMESSEN:
 *  · Titel-Link einer Einsatzkachel in Ruhe und unter dem Zeiger: die Kachel trägt dann
 *    `flaeche3`, und der Link wechselte nach `bedienHover`.
 *  · Ungelesen-Zahl des aktiven Chat-Kanals: die aktive Zeile trägt `flaeche3`. Die Zahl steht dort,
 *    solange das Gelesen-Markieren scheitert (`ChatPage`, Fehlschlag bleibt sichtbar) oder der Tab
 *    verborgen ist; der Test stellt diesen Zustand über die Antworten des Servers her.
 *
 * Böden als Literale, keine Farbwerte aus dem Produkt: eine schlechte Palette muss rot werden.
 * Dass wirklich gegen `flaeche3` gemessen wird, sichert der Abgleich mit der Rolle, die die
 * laufende Seite selbst auflöst (`rolle`); sonst bestünde die Messung auch auf hellerem Grund.
 */
const TEXT = { light: 7, dark: 5 } as const;

async function anmelden(page: Page, modus: 'light' | 'dark') {
  await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatz(page: Page, bezeichnung: string): Promise<number> {
  const r = await page.request.post('/api/einsaetze', { data: { bezeichnung } });
  expect(r.ok(), `Einsatz: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()).id;
}

/** Eine Rollen-Property (`--lfh-…`), vom Browser aufgelöst, als `r,g,b`. */
async function rolle(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const wert = getComputedStyle(probe).color;
    probe.remove();
    return (wert.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).join();
  }, name);
}

const rgb = (f: number[]) => f.slice(0, 3).map(Math.round).join();

for (const modus of ['light', 'dark'] as const) {
  test(`${modus}: Titel-Link der Einsatzkachel in Ruhe und unter dem Zeiger`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await anmelden(page, modus);
    const bezeichnung = `E2E 879 Kachel ${modus} ${Date.now()}`;
    await einsatz(page, bezeichnung);
    await page.goto('/einsaetze');

    const kachel = page.locator('[data-lfh="einsatzkachel"]', { hasText: bezeichnung });
    const link = kachel.getByRole('link', { name: bezeichnung });
    const linie = () => link.evaluate((el) => getComputedStyle(el).textDecorationLine);
    const { ruhe, zeiger } = await ruheUndZeiger(page, link, TEXT[modus], `${modus}/Kachellink`);

    // Gemessen gegen die Hervorhebung, nicht gegen eine hellere Stufe.
    expect(rgb(zeiger.grund), 'Kachel unter dem Zeiger').toBe(await rolle(page, '--lfh-flaeche-3'));
    // Unter dem Zeiger unterscheidet die Unterstreichung, nicht ein zweiter Blauton.
    expect(await linie(), 'Unterstreichung unter dem Zeiger').toBe('underline');
    expect(rgb(zeiger.text), 'Schrift unter dem Zeiger').toBe(rgb(ruhe.text));
    await page.mouse.move(0, 0);
    await expect.poll(linie, { message: 'keine Unterstreichung in Ruhe' }).toBe('none');
  });

  test(`${modus}: Ungelesen-Zahl des aktiven Chat-Kanals`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await anmelden(page, modus);
    const einsatzId = await einsatz(page, `E2E 879 Chat ${modus} ${Date.now()}`);

    // Das Markieren scheitert, die Kanalliste behält ihren ungelesenen Stand (`ChatPage`).
    await page.route(`**/api/einsaetze/${einsatzId}/chat/kanaele/*/gelesen`, (route) =>
      route.fulfill({ status: 500, body: '' }),
    );
    await page.route(`**/api/einsaetze/${einsatzId}/chat/kanaele`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const antwort = await route.fetch();
      const kanaele = (await antwort.json()) as { ungelesen_anzahl: number }[];
      await route.fulfill({
        response: antwort,
        json: kanaele.map((k) => ({ ...k, ungelesen_anzahl: 3 })),
      });
    });
    await page.goto(`/einsaetze/${einsatzId}/chat`);

    const aktiv = page.locator('[aria-current="true"]', {
      has: page.locator('[data-lfh="kanal-zeile"]'),
    });
    const zahl = aktiv.locator('[data-lfh="kanal-ungelesen"]');
    await expect(zahl).toContainText('3');
    await page.mouse.move(0, 0);
    await pruefe(zahl, TEXT[modus], `${modus}/Ungelesen im aktiven Kanal`);
    expect(rgb(await flaeche(zahl)), 'aktive Kanalzeile').toBe(
      await rolle(page, '--lfh-flaeche-3'),
    );
  });
}
