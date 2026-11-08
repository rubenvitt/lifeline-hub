import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BLOECKE_ANZAHL,
  seedPlanung,
  waitForPlanung,
  waitForRaster,
  wireZeit,
} from './planung-kern';

/**
 * Vorplanung ohne Einsatz (LLH-1586, Spec `vorplanung`): der ganze Weg über die Oberfläche gegen
 * den echten Server. Planung anlegen, einen Posten mit Schichtlänge und Soll, einen Helfer, dann
 * „Schichten erzeugen“ nach der Schichtlänge, den Helfer per Zug in einen Block, und zuletzt die
 * Höchstdauer im Kopf so kurz, dass der Server „zu lange im Dienst“ meldet.
 *
 * jsdom sieht weder Zeigerzüge noch dnd-kit; deshalb hier.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Ein Tag eine Woche voraus als `TT.MM.JJ`: die Planung liegt in der Zukunft. */
function tagVoraus(tage: number): string {
  const d = new Date(Date.now() + tage * 24 * 3_600_000);
  const zwei = (n: number) => String(n).padStart(2, '0');
  return `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

async function mitte(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

interface PlanungWire {
  posten: { id: number; bezeichnung: string }[];
  bloecke: { id: number; posten_id: number | null; personen: { name: string }[] }[];
}

test('Vorplanung: anlegen, Posten, Helfer, Schichten erzeugen, einteilen, Befund', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmelden(page);
  const tag = tagVoraus(7);
  const name = `E2E Planung ${Date.now()}`;

  // ── Anlegen über die Kopfleiste ────────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Planungen' }).click();
  await expect(page).toHaveURL(/\/planungen$/);
  await page.getByRole('button', { name: 'Planung anlegen' }).click();
  const anlegen = page.getByRole('dialog', { name: 'Planung anlegen' });
  await anlegen.getByLabel('Bezeichnung').fill(name);
  await anlegen.getByPlaceholder('Beginn').fill(`${tag} 06:00`);
  await anlegen.getByPlaceholder('Ende').fill(`${tag} 22:00`);
  await anlegen.getByRole('button', { name: 'Planung anlegen' }).click();
  await expect(page).toHaveURL(/\/planungen\/\d+$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const planungId = Number(/\/planungen\/(\d+)/.exec(page.url())![1]);
  const lade = async () =>
    (await (await page.request.get(`/api/planungen/${planungId}`)).json()) as PlanungWire;

  // ── Posten ─────────────────────────────────────────────────────────────────────────────────
  await page.getByRole('tab', { name: /^Posten/ }).click();
  await expect(page).toHaveURL(/reiter=posten/);
  await page.getByRole('button', { name: 'Posten anlegen' }).click();
  const posten = page.getByRole('dialog', { name: 'Posten anlegen' });
  await posten.getByLabel('Bezeichnung').fill('RTW 1');
  await posten.getByLabel('Schichtlänge').fill('4 h');
  await posten.getByLabel('Soll').fill('2');
  await posten.getByRole('button', { name: 'Posten anlegen' }).click();
  await expect(posten).toBeHidden();
  await expect(page.locator('[data-lfh="planung-posten"]').getByText('RTW 1')).toBeVisible();

  // ── Helfer ─────────────────────────────────────────────────────────────────────────────────
  await page.getByRole('tab', { name: /^Helfer/ }).click();
  await page.getByRole('button', { name: 'Helfer anlegen' }).click();
  const helfer = page.getByRole('dialog', { name: 'Helfer anlegen' });
  await helfer.getByLabel('Name').fill('Hanna Helfer');
  await helfer.getByRole('button', { name: 'Helfer anlegen' }).click();
  await expect(helfer).toBeHidden();

  // ── Schichten erzeugen nach der Schichtlänge des Postens ─────────────────────────────────────
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Schichten erzeugen' }).click();
  const erzeugen = page.getByRole('dialog', { name: 'Schichten erzeugen' });
  await erzeugen.getByRole('combobox', { name: 'Posten' }).click();
  // Die sichtbare Zeile, nicht das versteckte Vorleser-Element mit `role="option"`.
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .filter({ hasText: 'RTW 1' })
    .click();
  await expect(erzeugen.getByPlaceholder('4 h (Vorgabe)')).toBeVisible();
  await erzeugen.getByPlaceholder('Beginn').fill(`${tag} 08:00`);
  await erzeugen.getByPlaceholder('Ende').fill(`${tag} 16:00`);
  await erzeugen.getByRole('button', { name: 'Schichten erzeugen' }).click();
  await expect(erzeugen).toBeHidden();
  const raster = page.getByRole('region', { name: 'Planung' });
  const bloecke = raster.locator('[data-lfh="schichtplan-block"]');
  await expect(bloecke).toHaveCount(2);
  await expect(bloecke.first()).toHaveAttribute('data-ampel', 'luecke');

  // ── Helfer per Zug in den ersten Block ───────────────────────────────────────────────────────
  // Die Liste führt vor den Helfern der Planung den Stamm der Organisation; den füllen andere Specs
  // in derselben Datenbank, bis Hanna unter dem sichtbaren Rand der Liste liegt. Die Suche holt
  // sie nach oben, wie es ein Mensch täte.
  await page.getByRole('textbox', { name: 'Personen suchen' }).fill('Hanna Helfer');
  const hanna = page.locator('[data-lfh="schichtplan-person"]').filter({ hasText: 'Hanna Helfer' });
  await hanna.scrollIntoViewIfNeeded();
  const von = await mitte(hanna);
  const nach = await mitte(bloecke.first());
  await page.mouse.move(von.x, von.y);
  await page.mouse.down();
  await page.mouse.move(nach.x, nach.y, { steps: 16 });
  await page.mouse.up();
  await expect
    .poll(async () => (await lade()).bloecke.flatMap((b) => b.personen.map((p) => p.name)))
    .toEqual(['Hanna Helfer']);
  await expect(bloecke.first()).toContainText('Hanna Helfer');

  // ── Höchstdauer 1 h: der Server meldet den Befund am Block ───────────────────────────────────
  await page.getByRole('button', { name: 'Planung bearbeiten' }).click();
  await page.getByLabel('Höchstens im Dienst').fill('1 h');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(bloecke.first()).toHaveAttribute('data-ampel', 'befund');
  await expect(bloecke.first()).toContainText('zu lange im Dienst');
  await expect(page.locator('[data-lfh="planung-kennzahlen"]')).toContainText('Konflikte 1');

  // ── Die Liste zeigt die Planung mit ihren Kennzahlen ─────────────────────────────────────────
  await page.getByRole('link', { name: 'Planungen' }).first().click();
  const zeile = page.getByRole('row').filter({ hasText: name });
  await expect(zeile).toBeVisible();
  await zeile.getByRole('link', { name }).click();
  await expect(page).toHaveURL(new RegExp(`/planungen/${planungId}$`));
});

/**
 * Kriterium 12 der Prüfliste (LLH-1595, für LLH-1586): Änderungen anderer erscheinen im Raster
 * direkt. Ein fremder Block steht in seiner Zeile an seiner Uhrzeit; nichts unter dem Zeiger
 * verschiebt sich. Gemessen am Block, über dem der Zeiger steht, in der letzten Postenzeile.
 *
 * Bewusst NICHT abgedeckt: ein fremder Posten, der VOR anderen einsortiert wird, und eine fremde
 * Umsortierung schieben die Zeilen darunter um eine Zeilenhöhe. Die Zeilenschleuse mit
 * Sammelbanner für das gemeinsame Raster (Einsatz und Planung) ist eine eigene Aufgabe (LLH-1604).
 */
test('Vorplanung (LLH-1595): ein fremder Block verschiebt im Raster nichts unter dem Zeiger', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmelden(page);
  const planung = await seedPlanung(page, `E2E Planung live ${Date.now()}`);

  // Der Org-Strom abonniert erst mit der Antwort auf `/api/live` (wie LLH-1317 für den Einsatz).
  const strom = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/live');
  await page.goto(`/planungen/${planung.id}`);
  await strom;
  await waitForPlanung(page, planung.bezeichnung);
  await waitForRaster(page);

  const unterZeiger = page.locator('[data-lfh="schichtplan-block"][data-ampel="ohne-soll"]');
  await unterZeiger.hover();
  const vorher = (await unterZeiger.boundingBox())!;

  // Der „andere Schirm“ legt an RTW 1 einen Block 16–18 Uhr an.
  const stand = (await (await page.request.get(`/api/planungen/${planung.id}`)).json()) as {
    posten: { id: number; bezeichnung: string }[];
  };
  const rtw1 = stand.posten.find((p) => p.bezeichnung === 'RTW 1')!.id;
  const um = (stunde: number) => {
    const d = new Date(Date.now() + 7 * 24 * 3_600_000);
    d.setHours(stunde, 0, 0, 0);
    return wireZeit(d);
  };
  const antwort = await page.request.post(`/api/planungen/${planung.id}/bloecke`, {
    data: { posten_id: rtw1, von: um(16), bis: um(18) },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();

  const bloecke = page.locator('[data-lfh="schichtplan-block"]');
  await expect(bloecke, 'der fremde Block erscheint ohne Neuladen').toHaveCount(BLOECKE_ANZAHL + 1);
  const nachher = (await unterZeiger.boundingBox())!;
  expect(
    { x: nachher.x, y: nachher.y, breite: nachher.width, hoehe: nachher.height },
    'der Block unter dem Zeiger bleibt, wo er war',
  ).toEqual({ x: vorher.x, y: vorher.y, breite: vorher.width, hoehe: vorher.height });
  await expect(unterZeiger).toHaveAttribute('data-ampel', 'ohne-soll');
});
