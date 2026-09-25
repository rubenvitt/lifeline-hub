import { expect, test, type APIResponse, type Page } from '@playwright/test';

/**
 * ETB-Druckansicht (LFH-22, design.md D5/D10) gegen einen echten Server.
 *
 * WAS HIER STEHT UND NICHT IN VITEST: der Vollabruf über MEHR als eine Serverseite (die Liste
 * liefert höchstens 500 je Anfrage), die Ordnung nach Nummer über echte Daten, die
 * Berichtigung außerhalb einer gefilterten Auswahl und das Druckbild unter
 * `emulateMedia('print')`. Die Seitenlogik selbst (Cursor, Abbruch, Riegel) deckt
 * `etb/druckAbruf.test.ts`; hier geht es darum, dass Server und Client zusammen passen.
 *
 * SEEDING: über 500 Einträge per `page.request` in parallelen Bündeln. Die Session ist
 * Cookie-basiert, `page.request` teilt den Cookie-Jar. Eigene, großzügige Frist: auf den
 * 2-vCPU-Shards der CI kostet das Säen spürbar Zeit, und es ist Vorbereitung, keine Aussage.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const SAAT = 510;
const BUENDEL = 15;

test.setTimeout(240_000);

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

async function erfasse(page: Page, einsatzId: string, daten: Record<string, unknown>) {
  const antwort = await mitWiederholung(() =>
    page.request.post(`/api/einsaetze/${einsatzId}/etb`, { data: daten }),
  );
  expect(antwort.ok(), `Seeding ETB: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return (await antwort.json()) as { id: number; lfd_nr: number };
}

interface Saat {
  grund: { id: number; lfd_nr: number };
  nachtrag: { id: number; lfd_nr: number };
  berichtigung: { id: number; lfd_nr: number };
}

async function saeen(page: Page, einsatzId: string): Promise<Saat> {
  const grund = await erfasse(page, einsatzId, {
    typ: 'meldung',
    inhalt: 'Grundmeldung Deich Nord',
    von: 'Florian 1',
    an: 'ELW',
  });
  for (let i = 0; i < SAAT; i += BUENDEL) {
    await Promise.all(
      Array.from({ length: Math.min(BUENDEL, SAAT - i) }, (_, j) =>
        erfasse(page, einsatzId, { typ: 'meldung', inhalt: `Saatmeldung ${i + j + 1}` }),
      ),
    );
  }
  // Ein Nachtrag: Ereignis zwei Stunden vor der Erfassung.
  const nachtrag = await erfasse(page, einsatzId, {
    typ: 'meldung',
    inhalt: 'Nachgetragene Meldung',
    ereigniszeit: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  });
  const berichtigung = await erfasse(page, einsatzId, {
    typ: 'berichtigung',
    inhalt: 'Berichtigung: Deich Süd, nicht Nord',
    berichtigt_eintrag_id: grund.id,
  });
  return { grund, nachtrag, berichtigung };
}

/** Nummern der Drucktabelle in Anzeigefolge. */
async function nummern(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-lfh="etb-druck-tabelle"] tbody tr')).map((tr) =>
      Number(tr.querySelector('td')!.textContent),
    ),
  );
}

function zeile(page: Page, nr: number) {
  return page.locator('[data-lfh="etb-druck-tabelle"] tbody tr').filter({
    has: page.locator('td:first-child', { hasText: new RegExp(`^${nr}$`) }),
  });
}

test('ETB-Druck: Vollabruf über mehr als eine Serverseite, Ordnung, Nachtrag, Berichtigung, Druckbild', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E ETB-Druck ${Date.now()}`);
  const saat = await saeen(page, einsatzId);

  // Serverwahrheit zum Vergleich: dieselbe Zählung, die auch der ETB-Kopf nimmt.
  const zaehler = await (await page.request.get(`/api/einsaetze/${einsatzId}/etb/zaehler`)).json();
  const gesamt = zaehler.gesamt as number;
  expect(gesamt, 'Vorbedingung: mehr als eine Serverseite (500)').toBeGreaterThan(500);

  // ── Einstieg über das ETB, ungefiltert.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await page.getByRole('link', { name: 'Drucken / als PDF' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/etb/druck$`));
  const drucken = page.getByRole('button', { name: 'Drucken / als PDF' });
  await expect(drucken).toBeEnabled({ timeout: 60_000 });

  const kopf = page.locator('[data-lfh="druckkopf"]');
  await expect(kopf).toContainText(`${gesamt} Einträge`);
  await expect(kopf).toContainText(`bis Nr. ${saat.berichtigung.lfd_nr}`);
  await expect(kopf).toContainText('vollständiges Tagebuch');

  // Lückenlos und aufsteigend: 1 … höchste Nummer.
  const alle = await nummern(page);
  expect(alle).toHaveLength(gesamt);
  expect(alle).toEqual(Array.from({ length: gesamt }, (_, i) => i + 1));

  // Der Nachtrag steht an seiner Nummer und sagt es.
  await expect(zeile(page, saat.nachtrag.lfd_nr)).toContainText('nachgetragen um');
  // Berichtigung in beiden Richtungen.
  await expect(zeile(page, saat.grund.lfd_nr)).toContainText(
    `berichtigt durch Nr. ${saat.berichtigung.lfd_nr}`,
  );
  await expect(zeile(page, saat.berichtigung.lfd_nr)).toContainText(
    `berichtigt Nr. ${saat.grund.lfd_nr}`,
  );

  // ── Druckbild: Rahmen weg, Wurzel im Fluss, oben auf der Seite.
  await page.emulateMedia({ media: 'print' });
  const druck = await page.evaluate(() => {
    const wurzel = document.querySelector('[data-lfh="druckwurzel"]') as HTMLElement;
    const anzeige = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : 'fehlt';
    };
    return {
      position: getComputedStyle(wurzel).position,
      oben: wurzel.getBoundingClientRect().top + window.scrollY,
      kopfleiste: anzeige('.ant-layout-header'),
      rail: anzeige('nav[aria-label="Kategorien"]'),
      seitenkopf: anzeige('[data-lfh="seitenkopf"]'),
      tabellenkopf: anzeige('[data-lfh="etb-druck-tabelle"] thead'),
    };
  });
  expect(druck.position).toBe('static');
  expect(druck.oben).toBeLessThanOrEqual(1);
  expect(druck.kopfleiste).toBe('none');
  expect(druck.rail).toBe('none');
  expect(druck.seitenkopf, 'Bedienung der Druckansicht steht nicht auf dem Papier').toBe('none');
  expect(druck.tabellenkopf, 'Tabellenkopf wiederholt sich je Seite').toBe('table-header-group');
  await page.emulateMedia({ media: null });

  // ── Gefilterter Druck: nur Meldungen; die Berichtigung liegt außerhalb der Auswahl.
  await page.goto(`/einsaetze/${einsatzId}/etb?typ=meldung`);
  await page.getByRole('link', { name: 'Drucken / als PDF' }).click();
  await expect(page).toHaveURL(new RegExp(`/etb/druck\\?typ=meldung$`));
  await expect(drucken).toBeEnabled({ timeout: 60_000 });
  await expect(kopf).toContainText('Typ: Meldung');
  await expect(zeile(page, saat.grund.lfd_nr)).toContainText(
    `berichtigt durch Nr. ${saat.berichtigung.lfd_nr}`,
  );
  await expect(zeile(page, saat.berichtigung.lfd_nr)).toHaveCount(0);
});
