import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { wechsleZu, wechsleZuRolle } from './rollen-kern';

/**
 * Einsatzbericht (LFH-726) gegen einen echten Server: Einstieg über die Einsatzdaten, sieben
 * Blöcke in fester Reihenfolge, „In diesem Einsatz nicht genutzt“ für ein ausgeblendetes Modul,
 * kein Name einer betroffenen Person auf dem Blatt, Vorläufig-Vermerk im Kopf und das Druckbild.
 *
 * Der zweite Fall läuft als Beobachter (nicht privilegiert, `e2e/rollen-kern.ts`; ein Admin
 * übergeht Modul-Gates am Server wie im Client): Sind ALLE Module des Berichts im Einsatz
 * ausgeblendet, muss er druckbar sein und überall „nicht genutzt“ sagen. Bildete
 * `druck/einsatzbericht/quellen.ts` eine Quelle auf den falschen Modul-Key ab, riefe der Client sie
 * ab und der Server antwortete 403 — der Fall würde rot. Danach führt eine Rollensperre in die
 * Sackgasse. Die Seitenlogik decken `EinsatzberichtDruckPage.test.tsx` und
 * `druck/einsatzbericht/*.test.ts`.
 *
 * Druckbild mit ausgelöstem `beforeprint` (`window.print` als Stub, `druck/AGENTS.md`), nicht nur
 * `emulateMedia`.
 *
 * Der dritte Fall wählt Blöcke ab und die Personal-Anlage an (LFH-902): ein abgewählter Block fehlt
 * im Blatt, die Auswahl übersteht ein Neuladen, ein unbekannter Schlüssel erscheint nirgends, die
 * Auswahlleiste steht nicht auf dem Papier.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const NAME = 'Quastenflosser';
const VORNAME = 'Wendelin';

test.setTimeout(120_000);

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
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

async function sende(page: Page, methode: 'POST' | 'PUT', pfad: string, data?: unknown) {
  const antwort = await mitWiederholung(() =>
    methode === 'POST' ? page.request.post(pfad, { data }) : page.request.put(pfad, { data }),
  );
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return antwort.text().then((t) => (t ? JSON.parse(t) : null));
}

/** UTC 'YYYY-MM-DD HH:mm:ss', eine Stunde zurück (die Zeitachse lehnt Zukunft ab). */
function vorEinerStunde(): string {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

async function saeen(page: Page, einsatzId: string) {
  const basis = `/api/einsaetze/${einsatzId}`;
  const bericht = await sende(page, 'POST', `${basis}/lageberichte`, {
    vorlage: 'lagebericht',
    titel: 'Erstlage Halle 3',
    abschnitte: [{ schluessel: 'eigene_lage', text: 'Zwei Züge im Einsatz.' }],
  });
  await sende(page, 'POST', `${basis}/lageberichte/${bericht.id}/freigeben`);
  await sende(page, 'POST', `${basis}/etb`, {
    typ: 'entscheidung',
    von: 'ELW 1',
    an: 'Leitstelle',
    inhalt: 'Bereitstellungsraum Nord einrichten',
  });
  await sende(page, 'POST', `${basis}/personen`, {
    name: NAME,
    vorname: VORNAME,
    status: 'betroffen',
    sichtung: 'sk2',
  });
  const einheit = await sende(page, 'POST', `${basis}/einheiten`, { name: 'Zug Nord' });
  await sende(page, 'POST', `${basis}/einheiten/${einheit.id}/zeitachse`, {
    art: 'alarmierung',
    zeitpunkt_at: vorEinerStunde(),
  });
  await sende(page, 'PUT', `${basis}/modul-overrides/betreuung`, {
    sichtbar: false,
    benoetigte_rolle: null,
  });
}

test('Einsatzbericht: Einstieg, sieben Blöcke, nicht genutztes Modul, kein Personenbezug, Druckbild', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Einsatzbericht ${Date.now()}`);
  await saeen(page, einsatzId);

  // ── Einstieg über die Einsatzdaten.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/einsatzdaten`);
  await page.getByRole('link', { name: 'Einsatzbericht drucken' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/einsatzdaten/bericht$`));
  const drucken = page.getByRole('button', { name: 'Drucken / als PDF' });
  await expect(drucken).toBeEnabled({ timeout: 60_000 });

  const wurzel = page.locator('[data-lfh="druckwurzel"]');
  await expect(wurzel).toHaveCount(1);
  await expect(wurzel.getByRole('heading', { level: 3 })).toHaveText([
    'Stammdaten',
    'Zeiten',
    'Führung',
    'Kräfte',
    'Lage',
    'Bilanz',
    'ETB-Auszug',
  ]);

  const kopf = page.locator('[data-lfh="druckkopf"]');
  await expect(kopf).toContainText('Einsatzbericht');
  await expect(kopf).toContainText('Vorläufig – Einsatz läuft');

  // Die Quellen kamen wirklich vom Server (sonst stünde „keine Einträge“).
  await expect(page.locator('[data-lfh="einsatzbericht-block-lage"]')).toContainText(
    'Erstlage Halle 3',
  );
  await expect(page.locator('[data-lfh="einsatzbericht-block-lage"]')).toContainText(
    'Zwei Züge im Einsatz.',
  );
  await expect(page.locator('[data-lfh="einsatzbericht-block-etb"]')).toContainText(
    'Bereitstellungsraum Nord einrichten',
  );
  const kraefte = page.locator('[data-lfh="einsatzbericht-block-kraefte"]');
  await expect(kraefte.locator('dt', { hasText: 'Einheiten' }).last()).toBeVisible();
  const bilanz = page.locator('[data-lfh="einsatzbericht-block-bilanz"]');
  // Die Zahl, nicht das Etikett: jede Sichtungsklasse steht immer da, auch mit 0.
  await expect(
    bilanz.locator('dt', { hasText: /^SK II$/ }).locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('1');
  await expect(bilanz.getByText('In diesem Einsatz nicht genutzt')).toHaveCount(1);

  // Kein Personenbezug Betroffener auf dem Blatt.
  const text = await wurzel.innerText();
  expect(text).not.toContain(NAME);
  expect(text).not.toContain(VORNAME);

  // ── Schmaler Schirm (390 px, mobil): nichts ragt seitlich aus der Wurzel.
  await page.setViewportSize({ width: 390, height: 844 });
  const schmal = await wurzel.evaluate((w) => ({
    breite: w.clientWidth,
    inhalt: w.scrollWidth,
    rechts: Math.max(
      ...Array.from(w.querySelectorAll('*')).map((el) => el.getBoundingClientRect().right),
    ),
    wurzelRechts: w.getBoundingClientRect().right,
  }));
  expect(schmal.inhalt, 'kein Überlauf bei 390 px').toBeLessThanOrEqual(schmal.breite + 1);
  expect(schmal.rechts, 'kein Element ragt bei 390 px rechts heraus').toBeLessThanOrEqual(
    schmal.wurzelRechts + 1,
  );
  await page.setViewportSize({ width: 1280, height: 900 });

  // ── Druckbild: `window.print` als Stub, der wie der Browser `beforeprint` feuert.
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await drucken.click();
  await page.emulateMedia({ media: 'print' });
  const druck = await page.evaluate(() => {
    const w = document.querySelector('[data-lfh="druckwurzel"]') as HTMLElement;
    const anzeige = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : 'fehlt';
    };
    return {
      position: getComputedStyle(w).position,
      oben: w.getBoundingClientRect().top + window.scrollY,
      rechts: Math.max(
        ...Array.from(w.querySelectorAll('*')).map((el) => el.getBoundingClientRect().right),
      ),
      wurzelRechts: w.getBoundingClientRect().right,
      kopfleiste: anzeige('.ant-layout-header'),
      rail: anzeige('nav[aria-label="Kategorien"]'),
      seitenkopf: anzeige('[data-lfh="seitenkopf"]'),
      tabellenkopf: anzeige('[data-lfh="druckwurzel"] thead'),
    };
  });
  expect(druck.position).toBe('static');
  expect(druck.oben).toBeLessThanOrEqual(1);
  expect(druck.kopfleiste).toBe('none');
  expect(druck.rail).toBe('none');
  expect(druck.seitenkopf, 'Bedienung der Druckansicht steht nicht auf dem Papier').toBe('none');
  expect(druck.tabellenkopf, 'Tabellenkopf wiederholt sich je Seite').toBe('table-header-group');
  expect(druck.rechts, 'nichts ragt rechts aus der Druckwurzel').toBeLessThanOrEqual(
    druck.wurzelRechts + 1,
  );
});

/** Die Module, aus denen der Bericht schöpft (`druck/einsatzbericht/quellen.ts`). */
const BERICHT_MODULE = [
  'stab',
  'einheiten',
  'personal',
  'fahrzeuge',
  'lageberichte',
  'personen',
  'schaeden',
  'betreuung',
  'verpflegung',
  'etb',
];

test('Einsatzbericht als Beobachter: alle Module ausgeblendet druckbar, Rollensperre führt in die Sackgasse', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Einsatzbericht Rollen ${Date.now()}`);
  const basis = `/api/einsaetze/${einsatzId}`;
  for (const modul of BERICHT_MODULE) {
    await sende(page, 'PUT', `${basis}/modul-overrides/${modul}`, {
      sichtbar: false,
      benoetigte_rolle: null,
    });
  }
  const beobachter = await wechsleZuRolle(page, 'beobachter', einsatzId);

  // ── Alles ausgeblendet: kein Abruf eines gesperrten Endpunkts, also druckbar.
  await page.goto(`/einsaetze/${einsatzId}/einsatzdaten/bericht`);
  const drucken = page.getByRole('button', { name: 'Drucken / als PDF' });
  await expect(drucken).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByText('Kein Zugriff auf den Einsatzbericht')).toHaveCount(0);
  const wurzel = page.locator('[data-lfh="druckwurzel"]');
  // Stab, Lagebesprechungen, Lage, vier Bilanz-Abschnitte, zwei ETB-Abschnitte und die
  // Zeilen der Kräfte tragen den Vermerk.
  expect(await wurzel.getByText('In diesem Einsatz nicht genutzt').count()).toBeGreaterThanOrEqual(
    10,
  );

  // ── Rollensperre auf Personen (zurück zum Admin, dann wieder Beobachter).
  await wechsleZu(page, { benutzername: ADMIN, passwort: PW });
  await sende(page, 'PUT', `${basis}/modul-overrides/personen`, {
    sichtbar: true,
    benoetigte_rolle: 'fuehrungskraft',
  });
  await wechsleZu(page, beobachter);
  await page.goto(`/einsaetze/${einsatzId}/einsatzdaten/bericht`);
  await expect(page.getByText('Für den Einsatzbericht fehlen Rechte an: Personen.')).toBeVisible({
    timeout: 30_000,
  });
  await expect(drucken).toHaveCount(0);
  await expect(wurzel).toHaveCount(0);
});

test('Einsatzbericht: Blöcke abwählen, Anlage Personal je Kopf, Auswahl in der Adresse (LFH-902)', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Einsatzbericht Auswahl ${Date.now()}`);
  const basis = `/api/einsaetze/${einsatzId}`;
  const kraft = await sende(page, 'POST', `${basis}/personal`, {
    adhoc: { name: 'Hanna Helferin' },
  });
  await sende(page, 'POST', `${basis}/personal/${kraft.id}/zeitachse`, {
    art: 'alarmierung',
    zeitpunkt_at: vorEinerStunde(),
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/einsatzdaten/bericht`);
  const drucken = page.getByRole('button', { name: 'Drucken / als PDF' });
  await expect(drucken).toBeEnabled({ timeout: 60_000 });
  const wurzel = page.locator('[data-lfh="druckwurzel"]');
  const kopf = page.locator('[data-lfh="druckkopf"]');
  const leiste = page.getByRole('region', { name: 'Blöcke' });
  await expect(kopf).toContainText('Standardumfang');
  // Ohne Anlage steht kein Name einer Einsatzkraft auf dem Blatt.
  expect(await wurzel.innerText()).not.toContain('Hanna Helferin');

  // ── Bilanz und Lage ab, Personal-Anlage an.
  await leiste.getByRole('checkbox', { name: 'Bilanz' }).click();
  await leiste.getByRole('checkbox', { name: 'Lage', exact: true }).click();
  await leiste.getByRole('checkbox', { name: /Anlage Personal je Kopf/ }).click();
  await expect(drucken).toBeEnabled({ timeout: 60_000 });
  const erwartet = [
    'Stammdaten',
    'Zeiten',
    'Führung',
    'Kräfte',
    'ETB-Auszug',
    'Anlage Personal je Kopf',
  ];
  await expect(wurzel.getByRole('heading', { level: 3 })).toHaveText(erwartet);
  await expect(page.locator('[data-lfh="einsatzbericht-block-bilanz"]')).toHaveCount(0);
  await expect(kopf).toContainText(`Auswahl: ${erwartet.join(', ')}`);
  await expect(kopf).toContainText('enthält Namen von Einsatzkräften');
  const anlage = page.locator('[data-lfh="einsatzbericht-block-personal-kopf"]');
  await expect(anlage).toContainText('Hanna Helferin');
  // Eine Stunde seit der Alarmierung, noch im Einsatz.
  await expect(anlage).toContainText('läuft');

  // ── Die Auswahl steht in der Adresse und übersteht ein Neuladen.
  await expect(page).toHaveURL(/bloecke=/);
  await page.reload();
  await expect(drucken).toBeEnabled({ timeout: 60_000 });
  await expect(wurzel.getByRole('heading', { level: 3 })).toHaveText(erwartet);

  // ── Ein unbekannter Schlüssel fällt weg.
  await page.goto(`/einsaetze/${einsatzId}/einsatzdaten/bericht?bloecke=stammdaten,kosten`);
  await expect(drucken).toBeEnabled({ timeout: 60_000 });
  await expect(wurzel.getByRole('heading', { level: 3 })).toHaveText(['Stammdaten']);
  await expect(kopf).toContainText('Auswahl: Stammdaten');
  await expect(kopf).not.toContainText('kosten');

  // ── Druckbild: die Auswahlleiste steht nicht auf dem Papier (keine Box, auch wenn ein Vorfahr
  // statt ihrer selbst ausgeblendet ist).
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await drucken.click();
  await page.emulateMedia({ media: 'print' });
  expect(
    await leiste.evaluate((el) => el.getClientRects().length),
    'Auswahlleiste im Druck ohne Box',
  ).toBe(0);
  await expect(wurzel).toBeVisible();
});
