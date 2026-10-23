import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Zeitfelder nehmen eine getippte taktische Uhrzeit mit Enter an (LLH-1077, Spec `zeiteingabe`,
 * „Eingabe als Text“ und „Richtung nach Feldart“), gegen den echten Server: der ETB-Chip
 * „Ereigniszeit“, die Auftragsfrist und „Im Einsatz seit“ beim Schichtbeginn der Ablösung.
 *
 * Getippt wird eine Uhrzeit ohne Tag („HHMM“) relativ zu jetzt, damit der Test zu jeder Tageszeit
 * dasselbe prüft: eine Ereigniszeit vor jetzt fällt kurz nach Mitternacht auf gestern, eine Frist
 * nach jetzt kurz vor Mitternacht auf morgen; erwartet wird in beiden Fällen genau der Zeitpunkt,
 * aus dem die Uhrzeit stammt. Browser in Europe/Berlin, wie die Anzeigezone ohne Org-Zone.
 */

test.use({ timezoneId: 'Europe/Berlin' });

const ZONE = 'Europe/Berlin';

/** Ein Zeitpunkt `minuten` von jetzt, auf die Minute abgeschnitten. */
function umJetzt(minuten: number): Date {
  const d = new Date(Date.now() + minuten * 60_000);
  d.setUTCSeconds(0, 0);
  return d;
}

/** Die Uhrzeit als „HHMM“ in der Anzeigezone, so wie sie diktiert würde. */
function hhmm(d: Date): string {
  const teile = new Intl.DateTimeFormat('de-DE', {
    timeZone: ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const teil = (typ: string) => teile.find((t) => t.type === typ)!.value;
  return `${teil('hour')}${teil('minute')}`;
}

/** Drahtformat des Servers: UTC ohne Zonenkennung. */
function draht(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function neuerEinsatz(page: Page, name: string): Promise<number> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E ${name} ${Date.now()}` },
  });
  expect(r.ok(), `POST /api/einsaetze: ${r.status()} ${await r.text()}`).toBeTruthy();
  return ((await r.json()) as { id: number }).id;
}

test('ETB-Chip „Ereigniszeit“: HHMM + Enter übernimmt ohne Maus, der Eintrag trägt die Zeit', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await neuerEinsatz(page, 'Zeit-Chip');
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  const inhalt = `Lage ruhig ${Date.now()}`;
  const feld = page.getByPlaceholder('Inhalt …');
  await feld.fill(inhalt);

  const zeit = umJetzt(-20);
  await page.getByRole('button', { name: 'Feld', exact: true }).click();
  await page.getByRole('option', { name: /^Ereigniszeit/ }).click();
  const chip = page.getByRole('textbox', { name: 'Ereigniszeit' });
  await expect(chip).toBeFocused();
  await chip.fill(hhmm(zeit));
  await chip.press('Enter');
  // Übernommen: der Editor schließt, der Chip nennt die Zeit (vor Mitternacht mit Tag).
  await expect(page.getByText(new RegExp(`^Ereigniszeit: (\\d{2})?${hhmm(zeit)}$`))).toBeVisible();

  await page.getByRole('button', { name: 'Erfassen', exact: true }).click();
  await expect(feld).toHaveValue('');
  const r = await page.request.get(`/api/einsaetze/${einsatzId}/etb`);
  const eintrag = ((await r.json()) as { inhalt: string; ereigniszeit: string }[]).find(
    (e) => e.inhalt === inhalt,
  );
  expect(eintrag, 'Eintrag gespeichert').toBeTruthy();
  expect(eintrag!.ereigniszeit).toBe(draht(zeit));
});

test('Auftragsfrist: HHMM + Enter übernimmt die Frist und erteilt den Auftrag', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await neuerEinsatz(page, 'Auftragsfrist');
  await page.goto(`/einsaetze/${einsatzId}/auftraege`);
  await page.getByRole('button', { name: 'Auftrag erteilen' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Auftrag erteilen' });
  await expect(dialog).toBeVisible();
  const empfaenger = dialog.getByRole('combobox', { name: 'Empfänger' });
  await empfaenger.fill('EA Nord');
  await empfaenger.press('Enter');
  const text = `Hydrant freilegen ${Date.now()}`;
  await dialog.getByLabel('Auftrag / Was').fill(text);

  const frist = umJetzt(90);
  const feld = dialog.getByRole('textbox', { name: 'Frist (Quittung/Vollzug)' });
  await feld.fill(hhmm(frist));
  // Enter übernimmt die Frist und sendet ab (Erfassungs-Norm).
  await feld.press('Enter');
  await expect(dialog).toBeHidden();

  const r = await page.request.get(`/api/einsaetze/${einsatzId}/auftraege`);
  const auftrag = ((await r.json()) as { auftrag_text: string; frist_at: string | null }[]).find(
    (a) => a.auftrag_text === text,
  );
  expect(auftrag, 'Auftrag gespeichert').toBeTruthy();
  expect(auftrag!.frist_at).toBe(draht(frist));
});

test('Ablösung: „Im Einsatz seit“ HHMM + Enter beginnt die Schicht zu dieser Zeit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmeldenAlsAdmin(page);
  const einsatzId = await neuerEinsatz(page, 'Ablösung Zeit');
  const basis = `/api/einsaetze/${einsatzId}`;
  const sende = async (methode: 'post' | 'put', pfad: string, data: unknown, was: string) => {
    const antwort = await page.request[methode](`${basis}/${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return (await antwort.json()) as { id: number };
  };
  // Ohne Vorgabe beginnt mit dem Eintreffen keine Schicht (Spec `kraefte-abloesung`).
  await sende('put', 'abloesungen/schichtmodell', { schichtmodell: null }, 'keine Vorgabe');
  const einheit = await sende('post', 'einheiten', { name: 'Florian Süd' }, 'Einheit');
  await sende(
    'post',
    `einheiten/${einheit.id}/zeitachse`,
    { art: 'eintreffen', zeitpunkt_at: draht(umJetzt(-60)) },
    'Eintreffen',
  );

  await page.goto(`/einsaetze/${einsatzId}/abloesung`);
  await page.getByRole('radio', { name: /^Ohne Schicht/ }).click();
  await page
    .getByRole('region', { name: 'Einheiten ohne Schicht' })
    .getByRole('button', { name: 'Schicht beginnen für Florian Süd' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Schicht beginnen' });
  await expect(dialog.getByTitle('Florian Süd', { exact: true })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Rhythmus' }).fill('6');

  const beginn = umJetzt(-30);
  const feld = dialog.getByRole('textbox', { name: 'Im Einsatz seit' });
  await feld.fill(hhmm(beginn));
  await feld.press('Enter');
  await expect(dialog).toBeHidden();

  const r = await page.request.get(`${basis}/abloesungen`);
  const schicht = ((await r.json()) as { einheit_name: string; beginn_at: string }[]).find(
    (s) => s.einheit_name === 'Florian Süd',
  );
  expect(schicht, 'Schicht angelegt').toBeTruthy();
  expect(schicht!.beginn_at).toBe(draht(beginn));
});
