import { expect, test, type Page } from '@playwright/test';
import { ADMIN, ADMIN_PW, anmeldenAlsAdmin, wechsleZu, wechsleZuRolle } from './rollen-kern';

/**
 * Verpflegungsplan und Tag aus Vorlage (LLH-1058 Teil II; Spec `kraefte-verpflegung`,
 * „Verpflegungsplan in der Verwaltung“ und „Tag aus der Vorlage in der Oberfläche“, Spec
 * `zeiteingabe`, „Uhrzeit ohne Datum“): der Admin legt eine Mahlzeit in Stab-Schreibweise an; im
 * Einsatz entsteht aus dem Plan der 29.03.2026, der Tag der Umstellung auf Sommerzeit mit 23
 * Stunden — der Server nimmt die Tagesgrenzen nur an, wenn der Client sie in der Anzeigezone
 * richtig gerechnet hat. Danach steht derselbe Tag als „schon angelegt“. Bei 390 px im
 * Handschuh-Betrieb scrollt nichts waagrecht, auch nicht für den Beobachter, dem der Nebenweg
 * gesperrt steht.
 *
 * Der Plan gehört der Organisation und damit allen Specs eines Laufs: die Namen tragen eine
 * Laufkennung, und jede Mahlzeit wird am Ende deaktiviert. Kein `networkidle` (LFH-385).
 */

const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const HANDSCHIRM = { width: 390, height: 844 };
const LAUF = Date.now().toString(36);
const FRUEH = `Frühstück ${LAUF}`;
const NACHT = `Nacht ${LAUF}`;

test.use({ timezoneId: 'Europe/Berlin' });

async function senden<T = { id: number }>(
  page: Page,
  methode: 'post' | 'patch',
  pfad: string,
  data?: unknown,
): Promise<T> {
  const r = await page.request[methode](pfad, data === undefined ? {} : { data });
  expect(r.ok(), `${methode} ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

async function einsatz(page: Page): Promise<number> {
  const { id } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Tag aus Vorlage ${LAUF} ${Date.now()}`,
  });
  return id;
}

/** Deaktiviert jede Mahlzeit dieses Laufs; der Plan anderer Specs bleibt, wie er ist. */
async function planRaeumen(page: Page) {
  const r = await page.request.get('/api/verpflegung-vorlagen');
  const plan = (await r.json()) as { id: number; bezeichnung: string }[];
  for (const m of plan.filter((x) => x.bezeichnung.endsWith(LAUF))) {
    await senden(page, 'patch', `/api/verpflegung-vorlagen/${m.id}`, { aktiv: false });
  }
}

const fenster = (page: Page, name: string) => page.getByRole('region', { name });

test('Mahlzeit in Stab-Schreibweise anlegen und den 29.03. aus dem Plan anlegen', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await anmeldenAlsAdmin(page);
  try {
    // ── Verwaltung: „630“ wird 06:30, die Tabelle zeigt taktisch ────────────────────────
    await page.goto('/admin/stammdaten/verpflegungsplan');
    await page.getByRole('button', { name: 'Mahlzeit anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Mahlzeit anlegen' });
    await dialog.getByLabel('Bezeichnung').fill(FRUEH);
    await dialog.getByLabel('Beginn').fill('630');
    await dialog.getByLabel('Ende').fill('0800');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();
    await expect(dialog).toHaveCount(0);
    const zeile = page.locator('tr', { hasText: FRUEH });
    await expect(zeile).toContainText('0630–0800');
    // Die Nacht über die API: sie endet am Folgetag.
    await senden(page, 'post', '/api/verpflegung-vorlagen', {
      bezeichnung: NACHT,
      beginn: '2300',
      ende: '0100',
      verpflegungsart: 'kalt',
    });
    await expect(page.locator('tr', { hasText: NACHT })).toContainText('+1 Tag');

    // ── Einsatz: Nebenweg, Tag 29.03.2026 (23 Stunden) ───────────────────────────────────
    const e = await einsatz(page);
    await page.goto(`/einsaetze/${e}/verpflegung`);
    await page
      .locator('[data-lfh="seitenkopf-aktionen"]')
      .getByRole('link', { name: 'Tag aus Vorlage anlegen' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${e}/verpflegung/aus-vorlage$`));
    await page.goto(`/einsaetze/${e}/verpflegung/aus-vorlage?tag=2026-03-29`);
    const frueh = fenster(page, FRUEH);
    await expect(frueh).toContainText('29.03. 06:30–08:00');
    await expect(fenster(page, NACHT)).toContainText('29.03. 23:00–30.03. 01:00');
    // Nur die beiden dieses Laufs: andere Mahlzeiten der Organisation abwählen.
    for (const box of await page.getByRole('checkbox', { name: / anlegen$/ }).all()) {
      const name = (await box.getAttribute('aria-label')) ?? '';
      if (!name.includes(LAUF)) await box.uncheck();
    }
    for (const name of [FRUEH, NACHT]) {
      const f = fenster(page, name);
      await f.getByLabel(`Einsatzkräfte (EP) zu ${name}`).fill('12');
      await f.getByLabel(`Betreute (EP) zu ${name}`).fill('0');
    }
    await page.getByRole('button', { name: 'Zeitfenster anlegen' }).click();
    await expect(page.getByText('2 Zeitfenster für den 29.03. angelegt')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${e}/verpflegung$`));

    // Der Server hat die Uhrzeiten in Sommerzeit bekommen: 06:30 MESZ = 04:30 UTC.
    const v = (await (await page.request.get(`/api/einsaetze/${e}/verpflegung`)).json()) as {
      zeitfenster: { bezeichnung: string; von_at: string; bis_at: string }[];
    };
    const zeiten = Object.fromEntries(
      v.zeitfenster.map((z) => [z.bezeichnung, [z.von_at, z.bis_at]]),
    );
    expect(zeiten[FRUEH]).toEqual(['2026-03-29 04:30:00', '2026-03-29 06:00:00']);
    expect(zeiten[NACHT]).toEqual(['2026-03-29 21:00:00', '2026-03-29 23:00:00']);

    // ── Derselbe Tag noch einmal: beide stehen als „schon angelegt“ ──────────────────────
    await page.goto(`/einsaetze/${e}/verpflegung/aus-vorlage?tag=2026-03-29`);
    await expect(fenster(page, FRUEH)).toContainText('schon angelegt');
    await expect(fenster(page, NACHT)).toContainText('schon angelegt');
  } finally {
    await planRaeumen(page);
  }
});

test('390 px im Handschuh-Betrieb: Tag aus Vorlage und Verpflegungsplan ohne waagrechtes Scrollen, auch als Beobachter', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await anmeldenAlsAdmin(page);
  try {
    await senden(page, 'post', '/api/verpflegung-vorlagen', {
      bezeichnung: `Mittagessen mit einem langen Namen ${LAUF}`,
      beginn: '1200',
      ende: '1330',
      verpflegungsart: 'warm',
    });
    const e = await einsatz(page);
    await page.setViewportSize(HANDSCHIRM);
    await page.goto('/admin/stammdaten/verpflegungsplan');
    await page.evaluate(([k, w]) => localStorage.setItem(k, w), [DICHTE_SCHLUESSEL, 'handschuh']);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
    const ueberlauf = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    await expect(page.locator('tr', { hasText: 'Mittagessen mit einem langen' })).toBeVisible();
    expect(await ueberlauf()).toBeLessThanOrEqual(0);

    await page.goto(`/einsaetze/${e}/verpflegung/aus-vorlage?tag=2026-10-11`);
    const f = fenster(page, `Mittagessen mit einem langen Namen ${LAUF}`);
    await expect(f).toContainText('11.10. 12:00–13:30');
    expect(await ueberlauf()).toBeLessThanOrEqual(0);
    // Die Wahl je Fenster hält den Boden der Stufe (Handschuh 72 px).
    const box = await f
      .getByRole('checkbox', { name: / anlegen$/ })
      .locator('xpath=ancestor::label[1]')
      .boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(72);

    // ── Beobachter: Nebenweg gesperrt mit Grund, Seite ohne waagrechtes Scrollen ─────────
    await wechsleZuRolle(page, 'beobachter', String(e));
    await page.goto(`/einsaetze/${e}/verpflegung`);
    await page.getByRole('button', { name: /^Weitere Aktionen zur Verpflegung/ }).click();
    const eintrag = page
      .locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')
      .getByRole('menuitem', { name: /^Tag aus Vorlage anlegen \(/ });
    await expect(eintrag).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await page.goto(`/einsaetze/${e}/verpflegung/aus-vorlage?tag=2026-10-11`);
    await expect(page.getByText('Nur Ansicht')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zeitfenster anlegen' })).toBeDisabled();
    expect(await ueberlauf()).toBeLessThanOrEqual(0);
  } finally {
    await wechsleZu(page, { benutzername: ADMIN, passwort: ADMIN_PW });
    await planRaeumen(page);
  }
});
