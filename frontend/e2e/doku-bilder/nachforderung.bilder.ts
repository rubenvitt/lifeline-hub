import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { waehleIn } from '../auswahl-kern';
import {
  anmelden,
  apiAlsAdmin,
  demoEinsatz,
  expect,
  fotografiere,
  fuelle,
  test,
  uhrAnhalten,
} from './kern';

/**
 * Bilder des Kapitels „Nachforderungen“ (`docs/anwender/kapitel/nachforderung.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep nachforderung`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   nachforderungen-board.png    frontend/src/pages/NachforderungenPage.tsx,
 *                                frontend/src/nachforderungen/NachforderungBoard.tsx,
 *                                frontend/src/nachforderungen/NachforderungKarte.tsx
 *   nachforderung-absetzen.png   frontend/src/nachforderungen/NachforderungFormular.tsx
 *                                (Zusage mit Wer, Teilzusage, „überfällig“, LLH-1097)
 *   nachforderung-zusage.png     frontend/src/nachforderungen/ZusageFormular.tsx
 *   nachforderung-ablehnen.png   frontend/src/pages/NachforderungenPage.tsx (Ablehnen)
 *   nachforderung-material-uebernehmen.png
 *                                frontend/src/nachforderungen/MaterialUebernahmeModal.tsx
 *   nachforderung-material-posten.png
 *                                frontend/src/nachforderungen/NachforderungKarte.tsx
 *                                (übernommene Posten)
 *   nachforderung-einheit-uebernehmen.png
 *                                frontend/src/nachforderungen/EinheitUebernahmeModal.tsx
 *   nachforderung-einheit-weitere.png
 *                                frontend/src/nachforderungen/NachforderungKarte.tsx
 *                                (übernommene Einheiten, „Weitere Einheit übernehmen“)
 */

const KAPITEL = 'nachforderung';

/** Die Nachforderungen aus `beforeAll`, über die die Aufnahmen ihre Karten finden. */
interface Gesaet {
  lindenstrasse: number;
  pumpen: number;
  saecke: number;
}

const LINDENSTRASSE = 'Sandsäcke gefüllt für Unterführung Lindenstraße';
const PUMPEN = '3 Tauchpumpen für Keller Hauptstraße';
const SAECKE = 'Sandsäcke für Deich Nord';

/** Die Nachforderungen des Demo-Einsatzes, mit Bezeichnung und Kennung. */
async function vorhandene(
  api: APIRequestContext,
  einsatzId: number,
): Promise<{ id: number; bezeichnung: string }[]> {
  const pfad = `/api/einsaetze/${einsatzId}/resource-requests`;
  const antwort = await api.get(pfad);
  expect(antwort.ok(), `${pfad}: ${antwort.status()}`).toBe(true);
  return (await antwort.json()) as { id: number; bezeichnung: string }[];
}

/**
 * Demo-Lücke (D3): der Demo-Einsatz hat keine Nachforderung. Drei kommen über die API dazu, in
 * den Stufen Angefordert, Zugesagt und Unterwegs. Von den RTW ist einer zugesagt, mit Rufname und
 * einem schon verstrichenen Eintreffen (LLH-1097): das Board zeigt „überfällig“ und den Rest.
 *
 * Einmal je Datenbank (LLH-1983): nach einem roten Fall verwirft Playwright den Worker, und der
 * neue fährt `beforeAll` erneut. Ein zweites Säen stellte jede Karte doppelt aufs Board, und alle
 * Aufnahmen danach scheiterten an der Doppelung statt an ihrem eigenen Befund. Stehen die Karten
 * schon, liefert es nur ihre Kennungen.
 */
async function nachforderungenFuellen(api: APIRequestContext): Promise<Gesaet> {
  const demo = await demoEinsatz(api);
  const da = await vorhandene(api, demo.id);
  const kennung = (bezeichnung: string) => da.find((n) => n.bezeichnung === bezeichnung)?.id;
  const [lindenstrasse, pumpenDa, saeckeDa] = [LINDENSTRASSE, PUMPEN, SAECKE].map(kennung);
  if (lindenstrasse != null && pumpenDa != null && saeckeDa != null) {
    return { lindenstrasse, pumpen: pumpenDa, saecke: saeckeDa };
  }
  expect(da, 'Nachforderungen nur zum Teil gesät; Lauf mit frischer Datenbank wiederholen').toEqual(
    [],
  );
  const basis = `/api/einsaetze/${demo.id}/resource-requests`;
  const anlegen = (daten: Record<string, unknown>) =>
    fuelle<{ id: number }>(api, 'post', basis, daten);
  const linden = await anlegen({
    art: 'Sandsäcke',
    anzahl: 500,
    bezeichnung: LINDENSTRASSE,
    ziel_text: 'Unterführung Lindenstraße',
    adressat_kategorie: 'leitstelle',
    adressat_bezeichnung: 'Leitstelle Musterstadt',
    begruendung: 'Wasser steigt, Keller Lindenstraße 4 bis 8 gefährdet.',
    prioritaet: 'dringend',
  });
  const draht = (vorMinuten: number) =>
    new Date(Date.now() - vorMinuten * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  const rtw = await anlegen({
    art: 'RTW',
    anzahl: 2,
    bezeichnung: 'Transport aus der UHS Turnhalle',
    adressat_kategorie: 'leitstelle',
    prioritaet: 'sofort',
    angefordert_at: draht(40),
  });
  await fuelle(api, 'post', `${basis}/${rtw.id}/commitment`, {
    anzahl: 1,
    rufnamen: ['Rotkreuz Musterstadt 83-1'],
    eintreffen_erwartet_at: draht(10),
  });
  const seg = await anlegen({
    art: 'SEG Verpflegung',
    anzahl: 1,
    bezeichnung: 'Abendverpflegung für 80 Personen Gesamtschule',
    adressat_kategorie: 'uebergeordnet',
    adressat_bezeichnung: 'Kreisbereitschaftsleitung',
    prioritaet: 'normal',
  });
  await fuelle(api, 'post', `${basis}/${seg.id}/status`, { status: 'zugesagt' });
  await fuelle(api, 'post', `${basis}/${seg.id}/status`, { status: 'unterwegs' });

  // Zwei eingetroffene für „Als Material übernehmen“ (LLH-1226): Tauchpumpen noch ohne Posten,
  // Sandsäcke mit einer Teillieferung, die schon als Posten an der Rettungsstaffel steht.
  const eintreffen = async (id: number) => {
    for (const status of ['zugesagt', 'unterwegs', 'eingetroffen']) {
      await fuelle(api, 'post', `${basis}/${id}/status`, { status });
    }
  };
  const pumpen = await anlegen({
    art: 'Tauchpumpe',
    anzahl: 3,
    bezeichnung: PUMPEN,
    adressat_kategorie: 'leitstelle',
    prioritaet: 'dringend',
  });
  await eintreffen(pumpen.id);
  const saecke = await anlegen({
    art: 'Sandsäcke',
    anzahl: 2000,
    bezeichnung: SAECKE,
    adressat_kategorie: 'uebergeordnet',
    adressat_bezeichnung: 'Kreisbereitschaftsleitung',
    prioritaet: 'dringend',
  });
  await eintreffen(saecke.id);
  const antwort = await api.get(`/api/einsaetze/${demo.id}/einheiten`);
  expect(antwort.ok(), `Einheiten: ${antwort.status()}`).toBe(true);
  const staffel = ((await antwort.json()) as { id: number; name: string }[]).find(
    (e) => e.name === 'Rettungsstaffel',
  );
  expect(staffel, 'Demo-Einheit „Rettungsstaffel“ fehlt').toBeTruthy();
  await fuelle(api, 'post', `/api/einsaetze/${demo.id}/material`, {
    adhoc: { bezeichnung: 'Sandsäcke' },
    menge: 1200,
    art: 'verbrauchsgut',
    einheit_id: staffel!.id,
    nachforderung_id: saecke.id,
  });
  return { lindenstrasse: linden.id, pumpen: pumpen.id, saecke: saecke.id };
}

/**
 * Eine eingetroffene RTW-/KTW-Nachforderung für „Als Einheit übernehmen“ (LLH-1383) mit dem
 * Bereitstellungsraum des Demo-Einsatzes als Ziel und den Rufnamen der Zusage; mit `uebernommen`
 * sind so viele davon schon als Einheiten übernommen. Erst im Test angelegt, nicht in
 * `beforeAll`: das Board-Bild zeigt den Stand ohne sie. Die Rufnamen sind andere als die der
 * Demo-Fahrzeuge („Musterstadt 83-1“), sonst lehnte der Server die Übernahme ab. Steht sie schon
 * (dieselbe Aufnahme noch einmal in derselben Datenbank, LLH-1983), nimmt sie die vorhandene:
 * eine zweite Übernahme derselben Rufnamen lehnte der Server ab.
 */
async function einheitNachforderung(
  art: 'RTW' | 'KTW',
  bezeichnung: string,
  rufnamen: string[],
  uebernommen = 0,
): Promise<number> {
  const api = await apiAlsAdmin();
  const demo = await demoEinsatz(api);
  const basis = `/api/einsaetze/${demo.id}`;
  const schon = (await vorhandene(api, demo.id)).find((n) => n.bezeichnung === bezeichnung);
  if (schon) {
    await api.dispose();
    return schon.id;
  }
  const lies = async <T>(pfad: string): Promise<T> => {
    const antwort = await api.get(pfad);
    expect(antwort.ok(), `${pfad}: ${antwort.status()}`).toBe(true);
    return (await antwort.json()) as T;
  };
  // Der Typ steht im Katalog: der Dialog belegt ihn aus der Art vor.
  let typ = (await lies<{ id: number; label: string }[]>('/api/einheit-typen')).find(
    (t) => t.label === art,
  );
  typ ??= await fuelle<{ id: number; label: string }>(api, 'post', '/api/einheit-typen', {
    label: art,
    sortier: 90,
  });
  const raum = (
    await lies<{ id: number; bezeichnung: string }[]>(`${basis}/bereitstellungsraeume`)
  ).find((r) => r.bezeichnung === 'Parkplatz Stadion Nord');
  expect(raum, 'Demo-Bereitstellungsraum „Parkplatz Stadion Nord“ fehlt').toBeTruthy();
  const nf = await fuelle<{ id: number }>(api, 'post', `${basis}/resource-requests`, {
    art,
    anzahl: rufnamen.length,
    bezeichnung,
    ziel_br_id: raum!.id,
    adressat_kategorie: 'uebergeordnet',
    adressat_bezeichnung: 'Kreisbereitschaftsleitung',
    prioritaet: 'dringend',
  });
  await fuelle(api, 'post', `${basis}/resource-requests/${nf.id}/commitment`, { rufnamen });
  for (const status of ['unterwegs', 'eingetroffen']) {
    await fuelle(api, 'post', `${basis}/resource-requests/${nf.id}/status`, { status });
  }
  if (uebernommen > 0) {
    await fuelle(api, 'post', `${basis}/einheiten/aus-nachforderung`, {
      nachforderung_id: nf.id,
      einheiten: rufnamen.slice(0, uebernommen).map((name) => ({ name })),
      typ_id: typ.id,
      in_bereitstellungsraum: true,
    });
  }
  await api.dispose();
  return nf.id;
}

/**
 * Öffnet die Nachforderungen des Demo-Einsatzes und wartet, bis das Board fertig gelayoutet ist.
 *
 * Die Materialliste und die Namen der Orte kommen nach den Karten (LLH-1925). Mit ihnen wächst die
 * Karte „Sandsäcke für Deich Nord“ um ihren Posten und schiebt die Karten darunter weg. Lag das
 * zwischen `mousedown` und `mouseup` eines Klicks, traf der `mouseup` den Nachbarknopf („Als
 * Einheit übernehmen“ statt „Als Material übernehmen“), und kein Dialog ging auf. Der Anker
 * belegt beide späten Abrufe: den Posten samt Ortsnamen und die übernommene Menge.
 */
async function nachforderungenOeffnen(page: Page) {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  await uhrAnhalten(page);
  await page.goto(`/einsaetze/${demo.id}/nachforderungen`);
  await expect(page.getByRole('button', { name: 'Nachforderung anlegen' })).toBeVisible();
  await expect(page.getByText('Transport aus der UHS Turnhalle').first()).toBeVisible();
  const saeckePosten = page
    .locator('[data-nachforderung-id]', { hasText: 'Sandsäcke für Deich Nord' })
    .locator('[data-lfh="nachforderung-posten"]');
  await expect(saeckePosten).toContainText('Sandsäcke · 1200 · Rettungsstaffel');
  await expect(saeckePosten).toContainText('übernommen 1200 von 2000');
}

/** Die Karte einer Nachforderung, über ihre Kennung statt über den Text (LLH-1983). */
function karteZu(page: Page, id: number): Locator {
  return page.locator(`[data-nachforderung-id="${id}"]`);
}

/**
 * Öffnet einen Dialog über seinen Knopf und wartet, bis er ausgezoomt steht. Bleibt er aus, hängt
 * der Fall den Zustand der Seite an (LLH-1983): im Sammellauf blieb „Als Material übernehmen“
 * dreimal aus, ließ sich aber nicht nachstellen, auch nicht unter Last oder 12-fach gedrosselt.
 * Kein zweiter Klick: er verdeckte einen echten Fehler der Seite.
 */
async function dialogOeffnen(page: Page, knopf: Locator, dialog: Locator) {
  await knopf.click();
  try {
    await expect(dialog).toBeVisible();
  } catch (fehler) {
    const zustand = await page.evaluate(() => ({
      adresse: location.href,
      fokus: document.activeElement?.outerHTML.slice(0, 300) ?? null,
      dialoge: [...document.querySelectorAll('[role="dialog"], .ant-modal-wrap')].map((d) => ({
        rolle: d.getAttribute('role'),
        klasse: d.className,
        titel: d.querySelector('.ant-modal-title')?.textContent ?? null,
        anzeige: getComputedStyle(d).display,
        ariaVersteckt: d.closest('[aria-hidden="true"]') != null,
      })),
      meldungen: [
        ...document.querySelectorAll('.ant-message-notice, .ant-notification-notice'),
      ].map((m) => m.textContent),
    }));
    // Als Dateien im Ausgabeordner: der Reporter `list` nennt nur Anhänge mit Pfad.
    const info = test.info();
    const anzahl = await knopf.count();
    const zustandDatei = info.outputPath('seitenzustand-ohne-dialog.json');
    writeFileSync(
      zustandDatei,
      JSON.stringify(
        { zustand, knopf: { anzahl, gesperrt: anzahl === 1 ? await knopf.isDisabled() : null } },
        null,
        2,
      ),
    );
    await info.attach('seitenzustand-ohne-dialog', {
      path: zustandDatei,
      contentType: 'application/json',
    });
    const bildDatei = info.outputPath('seite-ohne-dialog.png');
    await page.screenshot({ path: bildDatei });
    await info.attach('seite-ohne-dialog', { path: bildDatei, contentType: 'image/png' });
    throw fehler;
  }
  await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
}

/** Leert den Fokus, damit kein Fokusring und kein Cursor im Bild steht. */
async function fokusWeg(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test.describe(KAPITEL, () => {
  // Einmal je Datenbank, die teilen alle Tests; ein neuer Worker findet die Karten wieder.
  let gesaet: Gesaet;
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    gesaet = await nachforderungenFuellen(api);
    await api.dispose();
  });

  test('Board der Nachforderungen nach Stufe', async ({ page }) => {
    await nachforderungenOeffnen(page);
    await expect(page.getByRole('button', { name: 'Eintreffen melden' })).toBeVisible();
    await expect(page.locator('[data-lfh="board-ueberfaellig"]')).toContainText('1');
    const eingetroffen = page.locator('[data-lfh="board-spalte"][data-stufe="eingetroffen"]');
    for (const id of [gesaet.pumpen, gesaet.saecke]) {
      await expect(eingetroffen.locator(`[data-nachforderung-id="${id}"]`)).toBeVisible();
    }
    await fotografiere(page, KAPITEL, 'nachforderungen-board');
  });

  test('Formular „Neue Nachforderung“', async ({ page }) => {
    await nachforderungenOeffnen(page);
    await page.getByRole('button', { name: 'Nachforderung anlegen' }).click();
    const paneel = page.getByRole('region', { name: 'Neue Nachforderung' });
    // Schnellwahl und drei Felder (LLH-1089); „Weitere Angaben“ bleibt eingeklappt.
    await expect(paneel.getByRole('group', { name: 'Schnellwahl' })).toBeVisible();
    await paneel.getByRole('combobox', { name: 'Was' }).fill('Tauchpumpe');
    await paneel.getByLabel('Anzahl').fill('3');
    await paneel.getByRole('combobox', { name: 'Wohin' }).fill('Keller Hauptstraße 12');
    await fokusWeg(page);
    await fotografiere(paneel, KAPITEL, 'nachforderung-absetzen');
  });

  test('Formular „Zusage erfassen“ an der Karte', async ({ page }) => {
    await nachforderungenOeffnen(page);
    const karte = karteZu(page, gesaet.lindenstrasse);
    await karte.getByRole('button', { name: 'Zusage erfassen' }).click();
    const formular = karte.getByRole('region', { name: /^Zusage zu / });
    await formular.getByRole('spinbutton', { name: 'Zugesagt' }).fill('300');
    await formular.getByRole('combobox', { name: 'Wer' }).fill('THW OV Musterstadt');
    await formular.getByRole('combobox', { name: 'Wer' }).press('Enter');
    await fokusWeg(page);
    await fotografiere(karte, KAPITEL, 'nachforderung-zusage');
  });

  test('Dialog „Nachforderung ablehnen“', async ({ page }) => {
    await nachforderungenOeffnen(page);
    await page
      .getByRole('button', { name: /^Aktionen zu Nachforderung / })
      .first()
      .click();
    await page.getByRole('menuitem', { name: 'Ablehnen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nachforderung ablehnen' });
    await dialog
      .getByRole('textbox')
      .fill('Keine Sandsäcke im Lager, Anforderung über Nachbarkreis.');
    await fokusWeg(page);
    await fotografiere(dialog, KAPITEL, 'nachforderung-ablehnen');
  });

  test('Dialog „Als Material übernehmen“', async ({ page }) => {
    await nachforderungenOeffnen(page);
    const dialog = page.getByRole('dialog', { name: '„Tauchpumpe“ als Material übernehmen' });
    await dialogOeffnen(
      page,
      karteZu(page, gesaet.pumpen).getByRole('button', { name: 'Als Material übernehmen' }),
      dialog,
    );
    await dialog.getByRole('radio', { name: 'Gerät' }).click();
    await expect(dialog.getByRole('spinbutton', { name: 'Menge' })).toHaveValue('1');
    await waehleIn(
      dialog.getByRole('combobox', { name: 'Ort' }),
      'Sanitätszug Musterstadt › Rettungsstaffel',
    );
    await fokusWeg(page);
    await fotografiere(dialog, KAPITEL, 'nachforderung-material-uebernehmen');
  });

  test('Karte mit übernommenem Posten', async ({ page }) => {
    await nachforderungenOeffnen(page);
    const karte = karteZu(page, gesaet.saecke);
    await expect(karte).toContainText('übernommen 1200 von 2000');
    await expect(karte.getByRole('button', { name: 'Weiteren Posten übernehmen' })).toBeVisible();
    await fokusWeg(page);
    await fotografiere(karte, KAPITEL, 'nachforderung-material-posten');
  });

  test('Dialog „Als Einheit übernehmen“', async ({ page }) => {
    const id = await einheitNachforderung('RTW', 'Zwei RTW für Transporte ab Deich Nord', [
      'Nachbarstadt 83-1',
      'Nachbarstadt 83-2',
    ]);
    await nachforderungenOeffnen(page);
    const dialog = page.getByRole('dialog', { name: '„RTW“ als Einheit übernehmen' });
    await dialogOeffnen(
      page,
      karteZu(page, id).getByRole('button', { name: 'Als Einheit übernehmen' }),
      dialog,
    );
    // Vorbelegt: die Rufnamen der Zusage, der Typ aus der Art und der Haken für den Raum.
    await expect(dialog).toContainText('Nachbarstadt 83-1');
    await expect(dialog).toContainText('Nachbarstadt 83-2');
    await expect(dialog.getByText('RTW', { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole('checkbox', { name: 'In BR Parkplatz Stadion Nord eintragen' }),
    ).toBeChecked();
    await fokusWeg(page);
    await fotografiere(dialog, KAPITEL, 'nachforderung-einheit-uebernehmen');
  });

  test('Karte mit übernommenen Einheiten', async ({ page }) => {
    const id = await einheitNachforderung(
      'KTW',
      'Drei KTW für die Verlegung aus der UHS Turnhalle',
      ['Nachbarstadt 85-1', 'Nachbarstadt 85-2', 'Nachbarstadt 85-3'],
      2,
    );
    await nachforderungenOeffnen(page);
    const karte = karteZu(page, id);
    await expect(karte).toContainText(
      'Als Einheit übernommen: Nachbarstadt 85-1 ↗, Nachbarstadt 85-2 ↗',
    );
    await expect(karte.getByRole('button', { name: 'Weitere Einheit übernehmen' })).toBeVisible();
    await fokusWeg(page);
    await fotografiere(karte, KAPITEL, 'nachforderung-einheit-weitere');
  });
});
