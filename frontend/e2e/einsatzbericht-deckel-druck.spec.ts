import { expect, test, type APIResponse, type Page } from '@playwright/test';

/**
 * Deckel vor einer langen Tabelle im Einsatzbericht (LFH-1124, `druck/einsatzbericht/Bloecke.tsx`,
 * `druck/druck.css`). Firefox ließe den Titel einer langen Tabelle allein oder nur mit dem
 * Spaltenkopf am Seitenende; im Firefox-Druck stehen Titel, Kopf und erste Zeile deshalb in einem
 * Deckel, der nicht bricht, und die echte Tabelle liegt um ihre Kopfhöhe darunter.
 *
 * Geprüft wird die Deckung unter Druckmedium mit ausgelöstem `beforeprint`: in Firefox liegt der
 * erste Kopf der echten Tabelle verdeckt im Deckel, ihre zweite Zeile schließt direkt an die erste
 * Zeile des Deckels an, die Spalten beider Tabellen stehen an denselben Kanten und der Deckel deckt
 * weiß. In Chromium und WebKit ist der Deckel keine Box und die Kopie unsichtbar. Den Umbruch
 * selbst zeigt nur das Blatt: Verschiebeprobe unter
 * `openspec/changes/archive/2026-10-10-lfh-1124-firefox-titel-lange-tabelle/werkzeug/`.
 *
 * Läuft in allen drei Engines (`DRUCK_SPECS` in `playwright.config.ts`).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
/** Länger als `KURZE_TABELLE` (12): erst dann steht der Deckel vor der Tabelle. */
const KOEPFE = 15;

test.setTimeout(120_000);

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Bis zu drei Versuche bei 503 („bitte erneut versuchen", SQLite-Schreibkonflikt). */
async function mitWiederholung(anfrage: () => Promise<APIResponse>): Promise<APIResponse> {
  let antwort = await anfrage();
  for (let versuch = 1; versuch < 4 && antwort.status() === 503; versuch++) {
    await new Promise((fertig) => setTimeout(fertig, 300 * versuch));
    antwort = await anfrage();
  }
  return antwort;
}

async function sende(page: Page, pfad: string, data: unknown) {
  const antwort = await mitWiederholung(() => page.request.post(pfad, { data }));
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return (await antwort.json()) as { id: number };
}

test('Einsatzbericht: Deckel hält Titel, Kopf und erste Zeile einer langen Tabelle (LFH-1124)', async ({
  page,
  browserName,
}) => {
  await anmelden(page);
  const { id: einsatzId } = await sende(page, '/api/einsaetze', {
    bezeichnung: `E2E Einsatzbericht Deckel ${Date.now()}`,
  });
  for (let i = 1; i <= KOEPFE; i++) {
    await sende(page, `/api/einsaetze/${einsatzId}/personal`, {
      adhoc: { name: `Kraft ${String(i).padStart(2, '0')}` },
    });
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/einsatzdaten/bericht?bloecke=personal-kopf`);
  const drucken = page.getByRole('button', { name: 'Drucken / als PDF' });
  await expect(drucken).toBeEnabled({ timeout: 60_000 });
  const anlage = page.locator('[data-lfh="einsatzbericht-block-personal-kopf"]');
  // Die Kopie ist für Hilfstechnik verborgen: genau eine Tabelle mit allen Köpfen.
  await expect(anlage.getByRole('table')).toHaveCount(1);
  await expect(anlage.getByRole('table').locator('tbody tr')).toHaveCount(KOEPFE);

  // `window.print` als Stub, der wie der Browser `beforeprint` feuert (`druck/AGENTS.md`).
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await drucken.click();
  await page.emulateMedia({ media: 'print' });

  const m = await anlage.evaluate((block) => {
    const deckel = block.querySelector('[data-lfh="titelblock-deckel"]') as HTMLElement;
    const kopie = block.querySelector('[data-lfh="deckel-tabelle"]') as HTMLElement;
    const unter = block.querySelector('[data-lfh="unter-deckel"]') as HTMLElement;
    const r = (el: Element) => el.getBoundingClientRect();
    const kanten = (t: Element) =>
      Array.from(t.querySelectorAll('thead th')).map((th) => Math.round(r(th).left * 2) / 2);
    const unterZeilen = unter.querySelectorAll('tbody tr');
    return {
      deckelAnzeige: getComputedStyle(deckel).display,
      deckelGrund: getComputedStyle(deckel).backgroundColor,
      deckelUmbruch: getComputedStyle(deckel).breakInside,
      kopieAnzeige: getComputedStyle(kopie).display,
      unterRand: getComputedStyle(unter).marginTop,
      deckelOben: r(deckel).top,
      deckelUnten: r(deckel).bottom,
      unterKopfOben: r(unter.querySelector('thead')!).top,
      unterKopfUnten: r(unter.querySelector('thead')!).bottom,
      kopieZeile1Unten: r(kopie.querySelector('tbody tr')!).bottom,
      unterZeile1Hoehe: r(unterZeilen[0]).height,
      unterZeile2Oben: r(unterZeilen[1]).top,
      kopieKanten: kanten(kopie),
      unterKanten: kanten(unter),
      titelImDeckel: deckel.querySelector('h3')?.textContent ?? '',
    };
  });

  expect(m.titelImDeckel).toBe('Anlage Personal je Kopf');
  if (browserName === 'firefox') {
    expect(m.deckelAnzeige, 'der Deckel ist im Firefox-Druck eine Box').toBe('block');
    expect(m.deckelUmbruch, 'der Deckel bricht nicht').toBe('avoid');
    expect(m.deckelGrund, 'der Deckel deckt weiß').toBe('rgb(255, 255, 255)');
    expect(m.kopieAnzeige).toBe('table');
    expect(m.kopieKanten, 'beide Tabellen haben dieselben Spalten').toEqual(m.unterKanten);
    // Höchstens die halbe Kopflinie: im border-collapse-Modell liegt sie in der ersten Zeile.
    expect(
      m.unterZeile1Hoehe,
      'die erste Zeile der echten Tabelle ist eine Maßzeile',
    ).toBeLessThanOrEqual(0.5);
    // Der erste Kopf der echten Tabelle liegt ganz im Deckel und ist verdeckt.
    expect(m.unterKopfOben).toBeGreaterThanOrEqual(m.deckelOben - 0.5);
    expect(m.unterKopfUnten).toBeLessThanOrEqual(m.deckelUnten + 0.5);
    // Zeile 2 schließt ohne Spalt und ohne Überdeckung an den Deckel an, dessen unterer Rand
    // die erste Zeile der Kopie ist.
    expect(Math.abs(m.unterZeile2Oben - m.deckelUnten)).toBeLessThanOrEqual(0.5);
    expect(m.kopieZeile1Unten).toBeLessThanOrEqual(m.deckelUnten + 0.5);
  } else {
    expect(m.deckelAnzeige, 'außerhalb von Firefox ist der Deckel keine Box').toBe('contents');
    expect(m.kopieAnzeige).toBe('none');
    expect(m.unterRand).toBe('0px');
    expect(m.unterZeile1Hoehe, 'die erste Zeile steht normal').toBeGreaterThan(0);
  }
});
