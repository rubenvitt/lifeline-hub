import { expect, test, type Browser, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { kontrast, randKontrast } from './kontrast-kern';

/**
 * Aufbewahrung in der Verwaltung (LFH-23, tasks.md 6.11 und 8.2).
 *
 * ── WARUM EIN DIREKTER DATENBANKGRIFF ───────────────────────────────────────────────────
 *
 * Vormerkung und Schwärzung setzt ausschließlich der Purge-Lauf (Takt 600 s, kein
 * Sofort-Auslöser — das ist Spec: „Einen manuellen Sofort-Auslöser … MUST es nicht geben").
 * Ein Endpunkt nur für den Test wäre genau so ein Auslöser, in Produktion erreichbar oder
 * hinter einem Flag, das die Suite anders fährt als den Betrieb. Die Suite läuft dagegen auf
 * einer eigenen Temp-Datenbank je Lauf (`playwright.config.ts`, `LIFELINE_E2E_LAUF`); die
 * Tombstones werden dort per `node:sqlite` gesetzt, genau wie die Integrationstests es mit
 * `sqlx` tun. Alles andere — Anlegen, Abschließen, Frist — läuft über die API.
 *
 * ── WAS GEKLICKT WIRD ───────────────────────────────────────────────────────────────────
 *
 * Menüeintrag, Tabellenzeile, Kopfaktion „Wiederherstellen", Absenden im Dialog: jeder Schritt
 * ist ein Klick bzw. ein Enter, kein `toBeVisible()` als Ersatz (CLAUDE.md, LFH-355).
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const TEXT = { light: 7, dark: 5 } as const;
const RAND = 3;

function datenbank(): string {
  const lauf = process.env.LIFELINE_E2E_LAUF;
  if (!lauf) throw new Error('LIFELINE_E2E_LAUF fehlt — läuft der Test außerhalb der Suite?');
  return (JSON.parse(lauf) as { datenbank: string }).datenbank;
}

/** UTC im DB-Format, `tage` relativ zu jetzt. */
function utc(tage: number): string {
  return new Date(Date.now() + tage * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
}

/** Setzt Frist und Tombstones eines Einsatzes direkt in der Lauf-Datenbank. */
function tombstones(
  einsatzId: number,
  werte: { frist: string | null; geloescht: string | null; geschwaerzt: string | null },
) {
  const db = new DatabaseSync(datenbank());
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare(
      'UPDATE einsatz SET retention_bis = ?, geloescht_at = ?, geschwaerzt_at = ? WHERE id = ?',
    ).run(werte.frist, werte.geloescht, werte.geschwaerzt, einsatzId);
  } finally {
    db.close();
  }
}

async function anmelden(page: Page, benutzer = 'admin', passwort = PW) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(benutzer);
  await page.getByLabel('Passwort').fill(passwort);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

interface Angelegt {
  id: number;
  nummer: string;
}

/** Legt einen Einsatz an und schließt ihn ab; optional mit Frist über die API. */
async function abgeschlossen(page: Page, name: string, frist?: string): Promise<Angelegt> {
  const r = await page.request.post('/api/einsaetze', { data: { bezeichnung: name } });
  expect(r.ok(), await r.text()).toBeTruthy();
  const e = (await r.json()) as { id: number; einsatznummer_intern: string };
  const z = await page.request.post(`/api/einsaetze/${e.id}/abschliessen`);
  expect(z.ok(), await z.text()).toBeTruthy();
  if (frist) {
    const f = await page.request.put(`/api/einsaetze/${e.id}/aufbewahrungsfrist`, {
      data: { retention_bis: frist, bestaetigt: true },
    });
    expect(f.ok(), await f.text()).toBeTruthy();
  }
  return { id: e.id, nummer: e.einsatznummer_intern };
}

const zeile = (page: Page, nummer: string) =>
  page.locator('.ant-table-tbody tr').filter({ hasText: nummer });

test.describe('Aufbewahrung (LFH-23)', () => {
  test('Admin: Verwaltung → Aufbewahrung → Akte → Wiederherstellen mit neuer Frist', async ({
    page,
  }) => {
    await anmelden(page);
    const e = await abgeschlossen(page, `E2E Aufbewahrung ${Date.now()}`, utc(-6));
    tombstones(e.id, { frist: utc(-6), geloescht: utc(-5), geschwaerzt: null });

    await page.goto('/admin');
    await page.getByRole('menuitem', { name: 'Aufbewahrung' }).click();
    await expect(page).toHaveURL(/\/admin\/aufbewahrung$/);
    const z = zeile(page, e.nummer);
    await expect(z).toContainText('zur Löschung vorgemerkt');
    await z.getByText('E2E Aufbewahrung').click();
    await expect(page).toHaveURL(new RegExp(`/admin/aufbewahrung/${e.id}$`));

    const kopf = page.locator('[data-lfh="adminpage-aktionen"]');
    await kopf.getByRole('button', { name: 'Wiederherstellen' }).click();
    const dialog = page.getByRole('dialog', { name: `${e.nummer} wiederherstellen` });
    const eingabe = dialog.getByRole('textbox');
    await eingabe.click();
    const ziel = new Date(Date.now() + 90 * 86_400_000);
    const lokal = `${ziel.getFullYear()}-${String(ziel.getMonth() + 1).padStart(2, '0')}-${String(ziel.getDate()).padStart(2, '0')} 12:00`;
    await eingabe.fill(lokal);
    // Enter im Feld übernimmt den Wert UND übermittelt das Formular (Erfassungs-Norm: der
    // Knopf liegt im `<form>`) — ein zusätzlicher Klick träfe den schon schließenden Dialog.
    await eingabe.press('Enter');

    await expect(page.getByText('Einsatz wiederhergestellt')).toBeVisible();
    const paneel = page.locator('[data-lfh="paneel"]').filter({
      has: page.getByRole('heading', { name: 'Aufbewahrung', exact: true }),
    });
    await expect(paneel).toContainText('Frist läuft');
    await expect(kopf.getByRole('button', { name: 'Frist ändern' })).toBeVisible();

    // Zurück in der Übersicht steht der Einsatz im neuen Zustand, und die Einsatzleitung
    // (hier der Admin als Ersteller) liest ihn wieder über die reguläre Route.
    await page.getByRole('menuitem', { name: 'Aufbewahrung' }).click();
    await expect(zeile(page, e.nummer)).toContainText('Frist läuft');
    const detail = await page.request.get(`/api/einsaetze/${e.id}`);
    expect(detail.status()).toBe(200);
  });

  test('Führungskraft: kein Eintrag „Aufbewahrung“ in der Verwaltung', async ({
    page,
    browser,
  }) => {
    await anmelden(page);
    const name = `fk${Date.now()}`;
    const r = await page.request.post('/api/benutzer', {
      data: {
        anzeigename: name,
        benutzername: name,
        passwort: `${name}pw1`,
        org_rolle: 'fuehrungskraft',
      },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    const fk = await (browser as Browser).newPage();
    try {
      await anmelden(fk, name, `${name}pw1`);
      await fk.goto('/admin');
      await expect(fk.getByRole('menuitem', { name: 'Fahrzeuge' })).toBeVisible();
      await expect(fk.getByRole('menuitem', { name: 'Aufbewahrung' })).toHaveCount(0);
      // Direkt angesteuert leitet die Seite zurück in die Verwaltung.
      await fk.goto('/admin/aufbewahrung');
      await expect(fk).toHaveURL(/\/admin\/stammdaten\//);
    } finally {
      await fk.close();
    }
  });

  for (const modus of ['dark', 'light'] as const) {
    test(`Kontrast der Zustandsetiketten und Durchstich (${modus})`, async ({ page }, testInfo) => {
      await anmelden(page);
      const stempel = Date.now();
      const faelle = {
        ohne_frist: await abgeschlossen(page, `Kontrast ohne ${stempel}`),
        frist_laeuft: await abgeschlossen(page, `Kontrast läuft ${stempel}`, utc(30)),
        faellig: await abgeschlossen(page, `Kontrast fällig ${stempel}`, utc(-1)),
        vorgemerkt: await abgeschlossen(page, `Kontrast vorgemerkt ${stempel}`, utc(-6)),
        schwaerzung_ausstehend: await abgeschlossen(page, `Kontrast aus ${stempel}`, utc(-40)),
        geschwaerzt: await abgeschlossen(page, `Kontrast schwarz ${stempel}`, utc(-70)),
      };
      tombstones(faelle.vorgemerkt.id, { frist: utc(-6), geloescht: utc(-5), geschwaerzt: null });
      tombstones(faelle.schwaerzung_ausstehend.id, {
        frist: utc(-40),
        geloescht: utc(-35),
        geschwaerzt: null,
      });
      tombstones(faelle.geschwaerzt.id, {
        frist: utc(-70),
        geloescht: utc(-65),
        geschwaerzt: utc(-30),
      });
      const woerter = {
        ohne_frist: 'ohne Frist',
        frist_laeuft: 'Frist läuft',
        faellig: 'fällig',
        vorgemerkt: 'zur Löschung vorgemerkt',
        schwaerzung_ausstehend: 'Schwärzung steht aus',
        geschwaerzt: 'geschwärzt',
      } as const;

      await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/admin/aufbewahrung');
      await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
      const messwerte: Record<string, unknown> = {};
      for (const [zustand, f] of Object.entries(faelle) as [keyof typeof woerter, Angelegt][]) {
        const etikett = zeile(page, f.nummer).locator('.ant-tag');
        await expect(etikett).toHaveText(woerter[zustand]);
        // Erst den eingeschwungenen Stand messen: während eines Nachladens liegt die Tabelle
        // unter antds Lade-Schleier (Opacity-Gruppe), die der Messkern bewusst ablehnt.
        await expect(async () => {
          const text = await kontrast(etikett);
          messwerte[zustand] = text;
          expect(text.verhaeltnis, `${zustand} Text ${modus}`).toBeGreaterThanOrEqual(TEXT[modus]);
        }).toPass({ timeout: 10_000 });
        // Der Rand trägt die Rolle (WCAG 1.4.11) — gegen die eigene Tönung UND die Zeile.
        if (
          zustand === 'faellig' ||
          zustand === 'vorgemerkt' ||
          zustand === 'schwaerzung_ausstehend'
        ) {
          const rand = await randKontrast(etikett);
          messwerte[`${zustand}-rand`] = rand;
          expect(
            Math.min(rand.gegenInnen, rand.gegenAussen),
            `${zustand} Rand ${modus}`,
          ).toBeGreaterThanOrEqual(RAND);
        }
      }
      await testInfo.attach(`kontrast-${modus}.json`, {
        body: JSON.stringify(messwerte, null, 2),
        contentType: 'application/json',
      });

      // Durchstich 1280 und 390: Übersicht und Akte, ohne waagerechten Seitenüberlauf.
      for (const breite of [1280, 390]) {
        await page.setViewportSize({ width: breite, height: breite === 390 ? 844 : 800 });
        await page.goto('/admin/aufbewahrung');
        await expect(zeile(page, faelle.vorgemerkt.nummer)).toBeVisible();
        // Der Zustand steht neben der fixierten Nummer und ist auch am Handschirm ohne
        // Querscrollen im Blick (Kriterium 9) — `toBeInViewport`, nicht `toBeVisible`.
        await expect(zeile(page, faelle.vorgemerkt.nummer).locator('.ant-tag')).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          breite,
        );
        await testInfo.attach(`uebersicht-${modus}-${breite}.png`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
        await page.goto(`/admin/aufbewahrung/${faelle.vorgemerkt.id}`);
        await expect(page.getByRole('button', { name: 'Wiederherstellen' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          breite,
        );
        await testInfo.attach(`akte-${modus}-${breite}.png`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
      }
    });
  }
});
