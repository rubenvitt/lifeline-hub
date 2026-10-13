import type { Browser, Page } from '@playwright/test';
import {
  KONTEXTE,
  anmelden,
  demoEinsatz,
  expect,
  fotografiere,
  fuelle,
  test,
  uhrAnhalten,
} from './kern';

/**
 * Bilder des Kapitels „Einsatzabschnitt“ (`docs/anwender/kapitel/geraet-einsatzabschnitt.md`): ein
 * Tablet an „EA 1 Sanitätsdienst“ des Demo-Einsatzes, Kontext Tablet, eigener Browserkontext wie
 * in `e2e/geraet-kopplung.spec.ts`. Zwei Aufträge an den Teilbaum erteilt die Spec als
 * Einsatzleitung über die API (D3), dazu im Test „Einsatzbefehl“ einen freigegebenen Befehl an
 * EA 1 und EA 2 (erst dort, damit das Bild der Aufträge ohne ihn bleibt).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep geraet-einsatzabschnitt`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   abschnitt.png   frontend/src/geraet/GeraetAbschnittPage.tsx
 *   auftraege.png   frontend/src/geraet/GeraetAuftraegePage.tsx, frontend/src/auftraege/AuftragKarte.tsx
 *   vollzug.png     frontend/src/auftraege/VollzugMeldenModal.tsx
 *   befehl.png      frontend/src/geraet/GeraetBefehle.tsx, frontend/src/auftraege/EmpfaengerQuittung.tsx
 */

const KAPITEL = 'geraet-einsatzabschnitt';
const AUFTRAG_EA1 = 'Zweite Behandlungsstelle im Gemeindehaus vorbereiten';
const AUFTRAG_EA11 = 'Liegendtransporte in die Kreisklinik anmelden';
const BEFEHL_TITEL = 'Verlegung der Behandlungsstelle';

interface Abschnitt {
  id: number;
  kurzbezeichnung: string | null;
}

/** Abschnitt des Demo-Einsatzes nach Kurzbezeichnung. */
async function abschnitt(page: Page, einsatz: number, kurz: string): Promise<Abschnitt> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatz}/abschnitte`);
  expect(antwort.ok(), `Abschnitte: ${antwort.status()}`).toBe(true);
  const a = ((await antwort.json()) as Abschnitt[]).find((x) => x.kurzbezeichnung === kurz);
  expect(a, `Abschnitt ${kurz} im Demo-Einsatz`).toBeDefined();
  return a!;
}

/** Zwei Aufträge an den Teilbaum von EA 1, einmal je Lauf. */
async function auftraegeErteilen(page: Page, einsatz: number, ea1: number, ea11: number) {
  const vorhanden = (await (
    await page.request.get(`/api/einsaetze/${einsatz}/auftraege`)
  ).json()) as {
    auftrag_text: string;
  }[];
  if (vorhanden.some((a) => a.auftrag_text === AUFTRAG_EA1)) return;
  await fuelle(page, 'post', `/api/einsaetze/${einsatz}/auftraege`, {
    auftrag_text: AUFTRAG_EA1,
    prioritaet: 'dringend',
    empfaenger: [{ empfaenger_typ: 'abschnitt', abschnitt_id: ea1 }],
  });
  await fuelle(page, 'post', `/api/einsaetze/${einsatz}/auftraege`, {
    auftrag_text: AUFTRAG_EA11,
    empfaenger: [{ empfaenger_typ: 'abschnitt', abschnitt_id: ea11 }],
  });
}

/** Ein freigegebener Einsatzbefehl an EA 1 und EA 2 (LLH-1190). */
async function befehlFreigeben(page: Page, einsatz: number, ea1: number, ea2: number) {
  const b = await fuelle<{ id: number }>(page, 'post', `/api/einsaetze/${einsatz}/befehle`, {
    vorlage: 'befehl_lad',
    titel: BEFEHL_TITEL,
    abschnitte: [
      { schluessel: 'lage', text: 'Gemeindehaus wird zweite Behandlungsstelle.' },
      { schluessel: 'auftrag', text: 'EA 1 verlegt die Behandlungsstelle bis 14:00 Uhr.' },
      { schluessel: 'durchfuehrung', text: 'EA 2 übernimmt den Wartebereich.' },
    ],
  });
  await fuelle(page, 'patch', `/api/einsaetze/${einsatz}/befehle/${b.id}`, {
    verteiler: [
      { empfaenger_typ: 'abschnitt', abschnitt_id: ea1 },
      { empfaenger_typ: 'abschnitt', abschnitt_id: ea2 },
    ],
  });
  await fuelle(page, 'post', `/api/einsaetze/${einsatz}/befehle/${b.id}/freigeben`);
}

/** Koppelt ein Tablet an EA 1, eigener Browserkontext, Uhr angehalten. */
async function abschnittTablet(page: Page, browser: Browser) {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  const ea1 = await abschnitt(page, demo.id, 'EA 1');
  const ea11 = await abschnitt(page, demo.id, 'EA 1.1');
  await auftraegeErteilen(page, demo.id, ea1.id, ea11.id);
  const k = await fuelle<{ code: { code: string } }>(
    page,
    'post',
    `/api/einsaetze/${demo.id}/geraete`,
    { ansicht: 'einsatzabschnitt', stelle_id: ea1.id, bezeichnung: 'Tablet EA 1' },
  );
  const kontext = await browser.newContext({ viewport: KONTEXTE.tablet });
  const leitung = { einsatz: demo.id, ea1: ea1.id };
  const geraet = await kontext.newPage();
  await uhrAnhalten(geraet);
  await geraet.goto(`/koppeln#${k.code.code}`);
  await geraet.getByRole('button', { name: 'Gerät koppeln' }).click();
  await expect(geraet).toHaveURL(new RegExp(`/geraet/${demo.id}/abschnitt$`));
  const nav = geraet.getByRole('navigation', { name: 'Gerätenavigation' });
  await expect(nav.getByRole('link')).toHaveText(['Abschnitt', 'Aufträge', 'Melden', 'Karte']);
  return { kontext, geraet, nav, leitung };
}

test.describe(KAPITEL, () => {
  test('Abschnitt mit Einheiten des Teilbaums', async ({ page, browser }) => {
    const { kontext, geraet, nav } = await abschnittTablet(page, browser);
    try {
      await expect(geraet.getByRole('heading', { level: 1, name: 'Sanitätsdienst' })).toBeVisible();
      await expect(
        geraet.getByRole('list', { name: 'Einheiten' }).getByText('Sanitätsgruppe UHS'),
      ).toBeVisible();
      await geraet.mouse.move(0, 0);
      await fotografiere(geraet, KAPITEL, 'abschnitt');

      // Nachgeklickt: die Karte des Teilbaums öffnet sich nur lesend.
      await nav.getByRole('link', { name: 'Karte' }).click();
      await expect(geraet.getByRole('heading', { level: 1, name: 'Karte' })).toBeVisible();
    } finally {
      await kontext.close();
    }
  });

  test('Aufträge quittieren, beginnen und Vollzug melden', async ({ page, browser }) => {
    const { kontext, geraet, nav } = await abschnittTablet(page, browser);
    try {
      await nav.getByRole('link', { name: 'Aufträge' }).click();
      await expect(geraet.getByText(AUFTRAG_EA1)).toBeVisible();
      await expect(geraet.getByText(AUFTRAG_EA11)).toBeVisible();
      await geraet.mouse.move(0, 0);
      await fotografiere(geraet, KAPITEL, 'auftraege');

      const karte = geraet.locator('[data-auftrag-id]').filter({ hasText: AUFTRAG_EA1 });
      const rueckmeldung = 'Gemeindehaus eingerichtet, vier Behandlungsplätze bereit';
      const dialog = geraet.getByRole('dialog', { name: 'Vollzug melden' });
      // Bild vor den Rückmeldungen: bei angehaltener Uhr schlössen sie nicht und lägen im Bild.
      await karte.getByRole('button', { name: 'Vollzug melden' }).click();
      await dialog.getByPlaceholder('Rückmeldung zur Erledigung').fill(rueckmeldung);
      await dialog.getByPlaceholder('Rückmeldung zur Erledigung').blur();
      await fotografiere(dialog, KAPITEL, 'vollzug');
      await dialog.getByRole('button', { name: 'Abbrechen' }).click();
      await expect(dialog).toHaveCount(0);

      // Nachgeklickt: quittieren, Bearbeitung beginnen, Vollzug melden.
      await karte.getByRole('button', { name: /^Empfang für .*quittieren$/ }).click();
      await geraet.getByRole('button', { name: 'Empfang quittieren' }).click();
      await expect(geraet.getByText('Empfang quittiert')).toBeVisible();
      await karte.getByRole('button', { name: 'Bearbeitung beginnen' }).click();
      await expect(geraet.getByText('Auftrag in Bearbeitung')).toBeVisible();
      await karte.getByRole('button', { name: 'Vollzug melden' }).click();
      await dialog.getByPlaceholder('Rückmeldung zur Erledigung').fill(rueckmeldung);
      await dialog.getByRole('button', { name: 'Vollzug melden' }).click();
      await expect(dialog).toHaveCount(0);
      // Vollzogen ist nicht mehr offen: der Auftrag verlässt die Liste.
      await expect(geraet.getByText(AUFTRAG_EA1)).toHaveCount(0);
    } finally {
      await kontext.close();
    }
  });

  test('Einsatzbefehl quittieren', async ({ page, browser }) => {
    const { kontext, geraet, nav, leitung } = await abschnittTablet(page, browser);
    try {
      const ea2 = await abschnitt(page, leitung.einsatz, 'EA 2');
      await befehlFreigeben(page, leitung.einsatz, leitung.ea1, ea2.id);
      await nav.getByRole('link', { name: 'Aufträge' }).click();
      const block = geraet.locator('[data-lfh="geraet-befehle"]');
      await expect(block.getByText(BEFEHL_TITEL)).toBeVisible();
      const quittieren = block.getByRole('button', { name: /^Empfang für .*quittieren$/ });
      // Nur der eigene Abschnitt trägt den Knopf.
      await expect(quittieren).toHaveCount(1);
      await geraet.mouse.move(0, 0);
      await fotografiere(block, KAPITEL, 'befehl');

      // Nachgeklickt: Text aufklappen, quittieren, rückgängig.
      await block.getByRole('button', { name: 'Befehlstext' }).click();
      await expect(block.getByText('EA 2 übernimmt den Wartebereich.')).toBeVisible();
      await quittieren.click();
      await expect(geraet.getByText('Empfang quittiert')).toBeVisible();
      await expect(quittieren).toHaveCount(0);
      await geraet.getByRole('button', { name: 'Rückgängig' }).click();
      await expect(quittieren).toHaveCount(1);
    } finally {
      await kontext.close();
    }
  });

  test('Meldung an die Einsatzleitung', async ({ page, browser }) => {
    const { kontext, geraet, nav } = await abschnittTablet(page, browser);
    try {
      await nav.getByRole('link', { name: 'Melden' }).click();
      await geraet.getByLabel('Inhalt').fill('Lage EA 1 stabil, Wartebereich leert sich');
      await geraet.getByRole('button', { name: 'Meldung senden' }).click();
      await expect(geraet.getByText(/Meldung #\d+ gesendet/)).toBeVisible();
      await expect(geraet.getByLabel('Inhalt')).toHaveValue('');
    } finally {
      await kontext.close();
    }
  });
});
