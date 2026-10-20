import { expect, test, type Page } from '@playwright/test';
import { flaeche, kontrast } from './kontrast-kern';

/**
 * Gerendertes Markdown (LFH-889): Code-Grund und Tabellenrahmen kommen aus Rollen, nicht mehr aus
 * `rgba()` über Schwarz/Weiß je Modus. Gemessen am ETB, das denselben Renderer (`.markdown`) trägt
 * wie die Lagebericht-Anzeige.
 *
 * Zitate (LFH-911) stehen in der Textrolle `text2`, nicht mehr in geerbter Farbe mit
 * `opacity: 0.85`: Deckkraft lehnt der Messkern ab, ein gedimmtes Zitat bliebe ungemessen.
 *
 * Boden als Literal: Code- und Zitattext Tag ≥ 7, Nacht ≥ 5. Keine Farbwerte aus dem Produkt
 * importieren: eine schlechte Palette muss rot werden. Dass Grund und Rahmen die Rollen SIND, prüft
 * der Abgleich mit den Rollen-Properties, die die laufende Seite selbst auflöst (`rolle`).
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

async function post(page: Page, pfad: string, data: unknown): Promise<{ id: number }> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return r.json();
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
  test(`${modus}: Markdown im ETB — Code- und Zitattext, Code-Grund und Rahmen aus Rollen`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 889 ${modus} ${Date.now()}`,
    });
    const inhalt = [
      'Zufahrt über `B 12` gesperrt.',
      '',
      '| Ort | Lage |',
      '| --- | --- |',
      '| Nord | ruhig |',
      '',
      '> Deichwache meldet Sickerstelle',
    ].join('\n');
    await post(page, `/api/einsaetze/${einsatzId}/etb`, {
      typ: 'meldung',
      inhalt,
      von: 'ELW 1',
      an: 'Leitstelle',
    });

    await page.goto(`/einsaetze/${einsatzId}/etb`);
    const zeile = page.locator('[data-testid="etb-ereigniszeile"]').filter({ hasText: 'Zufahrt' });
    await expect(zeile).toHaveCount(1);
    // Zeiger aus der Zeitachse, damit kein Hover-Ton die Ruhemessung verfälscht.
    await page.mouse.move(1, 1);

    const code = zeile.locator('.markdown code', { hasText: 'B 12' });
    const zelle = zeile.locator('.markdown td', { hasText: 'Nord' });
    const zitat = zeile.locator('.markdown blockquote p', { hasText: 'Deichwache' });
    await expect(code).toBeVisible();
    await expect(zelle).toBeVisible();
    await expect(zitat).toBeVisible();

    await expect(async () => {
      const m = await kontrast(code);
      expect(m.verhaeltnis, `Code-Text: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(TEXT[modus]);
      expect(rgb(await flaeche(code)), 'Code-Grund').toBe(await rolle(page, '--lfh-flaeche-3'));
      const z = await kontrast(zitat);
      expect(z.verhaeltnis, `Zitattext: ${JSON.stringify(z)}`).toBeGreaterThanOrEqual(TEXT[modus]);
      const rahmen = await zelle.evaluate((el) => getComputedStyle(el).borderTopColor);
      expect(rgb((rahmen.match(/[\d.]+/g) ?? []).map(Number)), 'Tabellenrahmen').toBe(
        await rolle(page, '--lfh-linie'),
      );
    }).toPass({ timeout: 10_000 });
  });
}
