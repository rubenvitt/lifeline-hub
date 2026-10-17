import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Empfänger einer Ausgabe in der Oberfläche (LLH-1055 Teil II, Spec `kraefte-verpflegung`,
 * „Empfänger wählen“ und „Noch nicht verpflegt“): in der Ausgabeansicht eine Gruppe über „Wählen“
 * aus „Noch nicht verpflegt“ als Empfänger setzen, ihre Stärke mit „+n“ zählen und buchen; danach
 * steht sie unter „Verpflegt“, die Schwestergruppe weiter unter „Noch nicht verpflegt“, die
 * Einheit ohne Eintreffen gesondert. Im Handschuh-Betrieb bei 390 px tragen Empfängerwahl,
 * „+n“ und „Wählen“ die Staffel (72 px), und nichts scrollt waagrecht.
 *
 * Seeding als Admin über die API. Kein `networkidle` (LFH-385).
 *
 * Mutationsprobe: in `empfaengerKern.ts` die Vorfahren-Prüfung von `isErreicht` entfernt → die
 * Untereinheiten des verpflegten Zugs stünden noch unter „Noch nicht verpflegt“; geprüft im
 * Vitest des Kerns, hier nur der Durchstich.
 */

const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const HANDSCHIRM = { width: 390, height: 844 };

const zeit = (minuten: number) => new Date(Date.now() + minuten * 60_000).toISOString();

async function senden<T = { id: number }>(
  page: Page,
  methode: 'post' | 'put',
  pfad: string,
  data?: unknown,
): Promise<T> {
  const r = await page.request[methode](pfad, data === undefined ? {} : { data });
  expect(r.ok(), `${methode} ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  const text = await r.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Einsatz mit „Mittag Empfänger“ (laufend), einem Zug mit zwei Gruppen (je zwei Kräfte, alle
 * eingetroffen) und der „Wasserrettung“ ohne Eintreffen.
 */
async function saeen(page: Page) {
  await anmeldenAlsAdmin(page);
  const { id: e } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Empfänger ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${e}`;
  const { id: zf } = await senden(page, 'post', `${basis}/verpflegung/zeitfenster`, {
    bezeichnung: 'Mittag Empfänger',
    von_at: zeit(-20),
    bis_at: zeit(100),
    bedarf_kraefte: 20,
    bedarf_betreute: 0,
  });
  const { id: zug } = await senden(page, 'post', `${basis}/einheiten`, { name: 'Zug Nord' });
  const gruppe = async (name: string, kraft: string) => {
    const { id } = await senden(page, 'post', `${basis}/einheiten`, {
      name,
      ueber_einheit_id: zug,
    });
    for (const nr of [1, 2]) {
      const { id: p } = await senden(page, 'post', `${basis}/personal`, {
        adhoc: { name: `${kraft} ${nr}`, staerke_position: 'mannschaft' },
      });
      await senden(page, 'put', `${basis}/einheiten/${id}/personal/${p}`);
    }
    return id;
  };
  const eins = await gruppe('Gruppe Eins', 'Kraft Eins');
  const zwei = await gruppe('Gruppe Zwei', 'Kraft Zwei');
  await senden(page, 'post', `${basis}/einheiten`, { name: 'Wasserrettung' });
  for (const id of [zug, eins, zwei]) {
    await senden(page, 'post', `${basis}/einheiten/${id}/zeitachse`, {
      art: 'eintreffen',
      zeitpunkt_at: zeit(-60),
    });
  }
  return { e, zf };
}

async function setzeDichte(page: Page, dichte: 'kompakt' | 'handschuh') {
  await page.evaluate(([k, w]) => localStorage.setItem(k, w), [DICHTE_SCHLUESSEL, dichte]);
}

const offen = (page: Page) => page.locator('[data-lfh="stand-offen"] > li');
const verpflegt = (page: Page) => page.locator('[data-lfh="stand-verpflegt"] > li');

for (const dichte of ['kompakt', 'handschuh'] as const) {
  test(`Gruppe wählen, Stärke zählen, buchen: danach „Verpflegt“ (${dichte})`, async ({ page }) => {
    test.setTimeout(90_000);
    if (dichte === 'handschuh') await page.setViewportSize(HANDSCHIRM);
    const { e, zf } = await saeen(page);
    await page.goto(`/einsaetze/${e}/verpflegung/${zf}/ausgabe`);
    await setzeDichte(page, dichte);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
    await expect(page.getByRole('heading', { level: 1, name: 'Mittag Empfänger' })).toBeVisible();

    // Vorgabe „ohne Empfänger“; alle drei eingetroffenen Einheiten fehlen noch.
    await expect(page.getByRole('combobox', { name: 'Empfänger' })).toBeEnabled();
    await expect(page.locator('[data-lfh="ausgabe-empfaenger"]')).toContainText('ohne Empfänger');
    await expect(offen(page)).toHaveCount(3);
    const ohneEintreffen = page.locator('[data-lfh="stand-ohne-eintreffen"] > li');
    await expect(ohneEintreffen).toHaveCount(1);
    await expect(ohneEintreffen).toContainText('Wasserrettung');

    // „Wählen“ an der Zeile setzt die Gruppe; „+2“ zählt ihre Stärke.
    const waehlen = page.getByRole('button', { name: 'Empfänger wählen: Gruppe Zwei' });
    await waehlen.click();
    await expect(waehlen).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-lfh="ausgabe-empfaenger"]')).toContainText('Gruppe Zwei');
    const staerke = page.getByRole('button', { name: 'Stärke zählen: 2 EP an Gruppe Zwei' });
    await staerke.click();
    await expect(page.locator('[data-lfh="sammlung-menge"]')).toHaveText('2');

    if (dichte === 'handschuh') {
      // Handschuh: die Ziele tragen die Staffel; nichts scrollt waagrecht.
      for (const ziel of [
        staerke,
        page.getByRole('button', { name: /^Empfänger wählen: Zug Nord/ }),
      ]) {
        const box = await ziel.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(72);
      }
      const feld = await page
        .locator('[data-lfh="ausgabe-empfaenger"] .ant-select')
        .first()
        .boundingBox();
      expect(feld?.height ?? 0).toBeGreaterThanOrEqual(72);
      const breite = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        sicht: document.documentElement.clientWidth,
      }));
      expect(breite.scroll).toBeLessThanOrEqual(breite.sicht);
    }

    await page.getByRole('button', { name: 'Buchen' }).click();
    await expect(page.getByText(/^Gebucht: 2 EP zu ‚Mittag Empfänger‘/)).toBeVisible();

    // Die Gruppe steht unter „Verpflegt“, Zug und Schwestergruppe weiter offen.
    await expect(verpflegt(page)).toHaveCount(1);
    await expect(verpflegt(page).first()).toContainText('Gruppe Zwei');
    await expect(verpflegt(page).first()).toContainText('2 EP');
    await expect(offen(page)).toHaveCount(2);
    await expect(page.locator('[data-lfh="ausgabe-zeile"]').first()).toContainText(
      '2 EP · an Gruppe Zwei',
    );
  });
}
