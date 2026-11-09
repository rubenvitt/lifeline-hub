import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BLOECKE_ANZAHL,
  seedPlanung,
  waitForPlanung,
  waitForRaster,
  wireZeit,
  zeitpunktAm,
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
 * „In Einsatz übernehmen“ (LLH-1587): eine Stadtfest-Planung mit einem Posten, einem Helfer und
 * einem Block per API, dazu ein Programmpunkt über den Reiter „Ablauf“ (LLH-1583), dann über die
 * Oberfläche in einen neuen Einsatz. Danach ist die Planung schreibgeschützt, ein zweiter Aufruf
 * antwortet 409, der Block steht im Schichtplan und der Programmpunkt im Ablauf des neuen
 * Einsatzes. Die Demo-Planung „Stadtfest Musterstadt“ prüft `tests/planung_uebernahme.rs`; das
 * e2e-Backend läuft ohne Demo-Daten.
 */
test('Vorplanung: Stadtfest in einen neuen Einsatz übernehmen, danach schreibgeschützt', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmelden(page);
  const tag = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString().slice(0, 10);
  const name = `E2E Stadtfest ${Date.now()}`;
  const api = async (pfad: string, data: unknown) => {
    const r = await page.request.post(pfad, { data });
    expect(r.ok(), `${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
    return r.json();
  };
  const plan = await api('/api/planungen', {
    bezeichnung: name,
    ort: 'Marktplatz',
    von: `${tag} 06:00:00`,
    bis: `${tag} 22:00:00`,
  });
  const planungId: number = plan.kopf.id;
  const helfer = await api(`/api/planungen/${planungId}/helfer`, {
    name: 'Hanna Stadtfest',
    organisation: 'Helferkreis',
  });
  const mitPosten = await api(`/api/planungen/${planungId}/posten`, {
    bezeichnung: 'Streife Markt',
    art: 'einheit',
    soll_anzahl: 2,
  });
  await api(`/api/planungen/${planungId}/bloecke`, {
    posten_id: mitPosten.posten[0].id,
    von: `${tag} 10:00:00`,
    bis: `${tag} 14:00:00`,
    personen: [{ art: 'helfer', helfer_id: helfer.id }],
  });

  await page.goto(`/planungen/${planungId}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  // ── Programmpunkt im Reiter „Ablauf“ (LLH-1583), 22:30 in der Zone der Organisation ──────────
  await page.getByRole('tab', { name: 'Ablauf · 0' }).click();
  const ablauf = page.getByRole('region', { name: 'Ablauf' });
  await ablauf.getByRole('button', { name: 'Programmpunkt', exact: true }).click();
  const punktDialog = page.getByRole('dialog', { name: 'Programmpunkt anlegen' });
  await punktDialog.getByLabel('Bezeichnung').fill('Feuerwerk');
  const zeit = punktDialog.getByLabel('Zeitpunkt');
  await zeit.fill('122230jun27');
  await zeit.press('Enter');
  await expect(punktDialog).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Ablauf · 1' })).toBeVisible();
  await expect(ablauf.getByText('Feuerwerk')).toBeVisible();

  await page.getByRole('button', { name: 'In Einsatz übernehmen' }).click();
  const dialog = page.getByRole('dialog', { name: 'In Einsatz übernehmen' });
  const zaehlung = dialog.locator('[data-lfh="einlesen-zaehlung"]');
  await expect(zaehlung).toContainText('1 Einheit neu');
  await expect(zaehlung).toContainText('1 Schicht neu');
  await expect(zaehlung).toContainText('1 Helfer neu');
  await expect(zaehlung).toContainText('1 Programmpunkt neu');
  await dialog.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(dialog.locator('[data-lfh="uebernahme-ergebnis"]')).toContainText(
    'Einsatz angelegt, Plan übernommen',
  );
  await dialog.locator('.ant-modal-footer').getByRole('button', { name: 'Schließen' }).click();
  await expect(dialog).toBeHidden();

  // ── Danach schreibgeschützt: Hinweis mit Einsatz, keine Bedienung, zweiter Aufruf 409 ─────────
  const hinweis = page.locator('[data-lfh="planung-uebernommen"]');
  await expect(hinweis).toContainText('übernommen');
  await expect(page.getByRole('button', { name: 'In Einsatz übernehmen' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Planung bearbeiten' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Block anlegen' })).toHaveCount(0);
  await expect(ablauf.getByRole('button', { name: 'Programmpunkt', exact: true })).toHaveCount(0);
  const nochmal = await page.request.post(`/api/planungen/${planungId}/uebernahme`, {
    data: { ziel: { art: 'neu' } },
  });
  expect(nochmal.status()).toBe(409);

  // ── Der Block steht im Schichtplan des neuen Einsatzes ───────────────────────────────────────
  await hinweis.getByRole('link').click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const einsatzId = Number(/\/einsaetze\/(\d+)/.exec(page.url())![1]);
  const schichtplan = await (
    await page.request.get(`/api/einsaetze/${einsatzId}/abloesungen/schichtplan`)
  ).json();
  expect(schichtplan.bloecke).toHaveLength(1);
  expect(schichtplan.bloecke[0].posten.bezeichnung).toBe('Streife Markt');
  expect(schichtplan.helfer.map((h: { name: string }) => h.name)).toEqual(['Hanna Stadtfest']);
  // Derselbe Zeitpunkt wie in der Planung; welche UTC-Zeit 22:30 ist, hängt an der Zone.
  const paar = (punkte: { bezeichnung: string; zeitpunkt_at: string }[]) =>
    punkte.map((p) => [p.bezeichnung, p.zeitpunkt_at]);
  const geplant = await (await page.request.get(`/api/planungen/${planungId}`)).json();
  const programm = await (
    await page.request.get(`/api/einsaetze/${einsatzId}/programmpunkte`)
  ).json();
  expect(paar(geplant.programmpunkte)).toHaveLength(1);
  expect(paar(geplant.programmpunkte)[0][1]).toMatch(/^2027-06-12 2\d:30:00$/);
  expect(paar(programm)).toEqual(paar(geplant.programmpunkte));
});

/**
 * Kriterium 12 der Prüfliste (LLH-1595, für LLH-1586): Änderungen anderer erscheinen im Raster
 * direkt, ohne Neuladen. Der fremde Block landet in DERSELBEN Zeile wie der Block unter dem Zeiger,
 * gleich daneben; der Block unter dem Zeiger behält Lage, Größe und Ampel. Dass andere Zeilen
 * nicht springen, folgt aus der festen Zeilenhöhe und ist hier nicht eigens belegt.
 *
 * Ein fremder Posten, der VOR anderen einsortiert wird, und eine fremde Umsortierung warten hinter
 * der Zeilenschleuse (LLH-1604); das belegt der Test „ein fremder Posten vorn wartet hinter dem
 * Banner“ unten.
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

  // Fußtrupp trägt 08–12 Uhr (`planung-kern.ts`); der Zeiger steht darauf.
  const fussBlock = page.locator('[data-lfh="schichtplan-block"][data-ampel="ohne-soll"]');
  await expect(fussBlock).toHaveCount(1);
  // Über die Kennung gegriffen: der fremde Block trägt dieselbe Ampel.
  const blockId = await fussBlock.getAttribute('data-block-id');
  const unterZeiger = page.locator(`[data-lfh="schichtplan-block"][data-block-id="${blockId}"]`);
  await unterZeiger.hover();
  const vorher = (await unterZeiger.boundingBox())!;

  // Der „andere Schirm“ legt am Fußtrupp gleich anschließend 12–14 Uhr an.
  const stand = (await (await page.request.get(`/api/planungen/${planung.id}`)).json()) as {
    posten: { id: number; bezeichnung: string }[];
  };
  const fusstrupp = stand.posten.find((p) => p.bezeichnung === 'Fußtrupp')!.id;
  const antwort = await page.request.post(`/api/planungen/${planung.id}/bloecke`, {
    data: {
      posten_id: fusstrupp,
      von: wireZeit(zeitpunktAm(planung.tag, 12)),
      bis: wireZeit(zeitpunktAm(planung.tag, 14)),
    },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();

  const zeile = page.locator('[data-lfh="schichtplan-zeile"]').filter({ hasText: 'Fußtrupp' });
  await expect(
    zeile.locator('[data-lfh="schichtplan-block"]'),
    'der fremde Block erscheint ohne Neuladen in der Zeile unter dem Zeiger',
  ).toHaveCount(2);
  await expect(page.locator('[data-lfh="schichtplan-block"]')).toHaveCount(BLOECKE_ANZAHL + 1);
  const nachher = (await unterZeiger.boundingBox())!;
  expect(
    { x: nachher.x, y: nachher.y, breite: nachher.width, hoehe: nachher.height },
    'der Block unter dem Zeiger bleibt, wo er war',
  ).toEqual({ x: vorher.x, y: vorher.y, breite: vorher.width, hoehe: vorher.height });
  await expect(unterZeiger).toHaveAttribute('data-ampel', 'ohne-soll');
});

// ── Zeilenschleuse (LLH-1604) ──────────────────────────────────────────────────────────────────

/** Eine Woche voraus zur lokalen Wanduhr `stunde:00` (Browser und Lauf teilen die Zeitzone). */
function wocheVorausUm(stunde: number): string {
  const d = new Date(Date.now() + 7 * 24 * 3_600_000);
  d.setHours(stunde, 0, 0, 0);
  return wireZeit(d);
}

async function sende<T>(page: Page, methode: 'post' | 'put', pfad: string, data: unknown) {
  const r = await page.request[methode](pfad, { data });
  expect(r.ok(), `${methode} ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

interface PlanungAntwort {
  kopf: { id: number };
  posten: { id: number; bezeichnung: string }[];
}

/**
 * Kriterium 12 der Prüfliste (LLH-1586) für die Zeilen, Spec `vorplanung`, „Raster der Planung
 * ohne Sprung“: ein fremder Posten, der VOR den anderen einsortiert wird, und eine fremde
 * Umsortierung schieben nichts unter dem Zeiger. Beides wartet hinter dem Sammelbanner; „anzeigen“
 * stellt den neuen Posten an die erste Stelle. Die Umsortierung (RTW 2 vor RTW 1) belegt im Banner,
 * dass auch die zweite Schreibung angekommen ist, bevor „anzeigen“ übernimmt: die Live-Abrufe
 * bündeln, und „1 neuer Posten“ allein stünde schon nach der ersten.
 *
 * Gesät per API, eigener Stand statt `seedPlanung` (dort stehen Abschnitte, und hier zählt nur die
 * Folge): zwei Posten ohne Abschnitt mit je einem Block 08–12 Uhr eine Woche voraus. Der Zeiger steht über dem Block der
 * letzten Postenzeile; der „andere Schirm“ ist `page.request` mit demselben Konto.
 */
test('Vorplanung (LLH-1604): ein fremder Posten vorn wartet hinter dem Banner, nichts springt', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmelden(page);
  const bezeichnung = `E2E Planung Schleuse ${Date.now()}`;
  const p = await sende<PlanungAntwort>(page, 'post', '/api/planungen', {
    bezeichnung,
    von: wocheVorausUm(6),
    bis: wocheVorausUm(22),
  });
  const id = p.kopf.id;
  const postenIds: number[] = [];
  for (const name of ['RTW 1', 'RTW 2']) {
    const a = await sende<PlanungAntwort>(page, 'post', `/api/planungen/${id}/posten`, {
      bezeichnung: name,
      art: 'einheit',
    });
    const postenId = a.posten.find((x) => x.bezeichnung === name)!.id;
    postenIds.push(postenId);
    await sende(page, 'post', `/api/planungen/${id}/bloecke`, {
      posten_id: postenId,
      von: wocheVorausUm(8),
      bis: wocheVorausUm(12),
    });
  }

  // Der Org-Strom abonniert erst mit der Antwort auf `/api/live` (wie LLH-1317 für den Einsatz).
  const strom = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/live');
  await page.goto(`/planungen/${id}`);
  await strom;
  await expect(page.getByRole('heading', { level: 1, name: bezeichnung })).toBeVisible();
  const bloecke = page.locator('[data-lfh="schichtplan-block"]');
  await expect(bloecke).toHaveCount(2);

  const zeilen = page.locator('[data-lfh="schichtplan-zeile"]');
  const unterZeiger = page
    .locator(`[data-lfh="schichtplan-zeile"][data-raster-zeile="einheit:${postenIds[1]}"]`)
    .locator('[data-lfh="schichtplan-block"]');
  await unterZeiger.hover();
  const vorher = (await unterZeiger.boundingBox())!;

  // Der andere Schirm legt „KTW 9“ an, setzt ihn an die erste Stelle und RTW 2 vor RTW 1.
  const neu = await sende<PlanungAntwort>(page, 'post', `/api/planungen/${id}/posten`, {
    bezeichnung: 'KTW 9',
    art: 'einheit',
  });
  const ktw = neu.posten.find((x) => x.bezeichnung === 'KTW 9')!.id;
  await sende(page, 'put', `/api/planungen/${id}/posten/reihenfolge`, {
    posten_ids: [ktw, postenIds[1], postenIds[0]],
  });

  const banner = page.locator('[data-lfh="schichtplan-schleuse"] [data-lfh="sammelbanner"]');
  await expect(banner, 'neuer Posten und Umsortierung warten hinter dem Banner').toContainText(
    '1 neuer Posten · Reihenfolge geändert',
  );
  await expect(zeilen.first()).toHaveAttribute('data-raster-zeile', `einheit:${postenIds[0]}`);
  const nachher = (await unterZeiger.boundingBox())!;
  expect(
    { x: nachher.x, y: nachher.y, breite: nachher.width, hoehe: nachher.height },
    'der Block unter dem Zeiger bleibt, wo er war',
  ).toEqual({ x: vorher.x, y: vorher.y, breite: vorher.width, hoehe: vorher.height });

  await banner.getByRole('button', { name: 'anzeigen' }).click();
  await expect(banner).toHaveCount(0);
  const folge = await zeilen.evaluateAll((z) => z.map((e) => e.getAttribute('data-raster-zeile')));
  expect(folge, 'nach „anzeigen“ stehen die Zeilen in der neuen Folge').toEqual([
    `einheit:${ktw}`,
    `einheit:${postenIds[1]}`,
    `einheit:${postenIds[0]}`,
    'pause',
  ]);
});
