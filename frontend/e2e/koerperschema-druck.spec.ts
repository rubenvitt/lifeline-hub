import { expect, test, type Page } from '@playwright/test';
import { einsatzAnlegen } from './einsatz-kern';
import { pdfAuszug } from './pdf-kern';
import { ADMIN, ADMIN_PW, anmeldenAls, benutzerAnlegen, mitgliedEintragen } from './rollen-kern';

/**
 * Druckansicht einer Person mit Körperschema (LLH-1120, Spec `druck-dokumente`, „Druckansicht
 * einer Person“; Herleitung design.md D13 der Change `y18v58dt-pat-kern`): was nur der Browser
 * zeigt. Chromium, Firefox und WebKit prüfen unter Druckmedium (`DRUCK_SPECS`), dass das Blatt
 * schwarz auf weiß steht — Umriss, Sternchen und Nummern in Schwarz, keine Fläche —, dass
 * Sternchen und Liste dieselben Nummern 1 bis 3 tragen und keine Bedienung auf dem Blatt steht.
 * Das PDF (Text des Blatts) gibt es nur in Chromium.
 *
 * Dazu der Weg ohne Schreibrecht aus dem Detail, das Zugriffsprotokoll (`druck` an der Person)
 * und die unbekannte Person ohne Druckknopf.
 *
 * Mutationsprobe: in `KoerperFigur.tsx` den Umriss im Druck mit `farben.silhouette` füllen statt
 * `none` → im Nachtbetrieb steht eine dunkle Fläche auf dem Blatt, rot.
 */

test.setTimeout(120_000);

const SCHWARZ = 'rgb(0, 0, 0)';

async function personSaeen(page: Page, einsatzId: string): Promise<number> {
  const r = await page.request.post(`/api/einsaetze/${einsatzId}/personen`, {
    data: { name: 'Mustermann', status: 'betroffen', sichtung: 'sk2', geschlecht: 'weiblich' },
  });
  expect(r.ok(), `Person: ${r.status()} ${await r.text()}`).toBe(true);
  const pid = ((await r.json()) as { id: number }).id;
  for (const verletzung of [
    { ansicht: 'vorn', region: 'kopf', art: 'wunde_blutung', x: 0.5, y: 0.05 },
    { ansicht: 'vorn', region: 'unterarm_l', art: 'fraktur_verdacht', schwere: 'schwer' },
    { ansicht: 'hinten', region: 'ruecken', art: 'schmerz' },
  ]) {
    const v = await page.request.post(`/api/einsaetze/${einsatzId}/personen/${pid}/verletzungen`, {
      data: verletzung,
    });
    expect(v.ok(), `Verletzung: ${v.status()} ${await v.text()}`).toBe(true);
  }
  const m = await page.request.post(`/api/einsaetze/${einsatzId}/personen/${pid}/massnahmen`, {
    data: { art: 'blutstillung' },
  });
  expect(m.ok()).toBe(true);
  return pid;
}

test('Beobachter druckt eine Person mit drei Verletzungen schwarz-weiß; das Öffnen steht im Protokoll', async ({
  page,
  browserName,
}) => {
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Körperschema-Druck ${Date.now()}`);
  const pid = await personSaeen(page, einsatzId);
  const beobachter = await benutzerAnlegen(page, 'beobachter');
  await mitgliedEintragen(page, einsatzId, beobachter.id, 'beobachter');

  await anmeldenAls(page, beobachter.benutzername, beobachter.passwort);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/einsaetze/${einsatzId}/personen/${pid}`);
  const kopf = page.getByRole('region', { name: 'Patientenkopf' });
  await expect(kopf).toContainText('Unterarm links, vorn');
  // Vorbedingung: ohne Schreibrecht, sonst belegte der Weg nichts.
  await expect(kopf.getByRole('button', { name: 'Verletzung markieren' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Druckansicht' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen/${pid}/druck$`));
  const drucken = page.getByRole('button', { name: 'Drucken / als PDF' });
  await expect(drucken).toBeEnabled();

  const wurzel = page.locator('[data-lfh="druckwurzel"]');
  const schema = wurzel.getByRole('region', { name: 'Körperschema' });
  await expect(schema.locator('[data-lfh="koerperfigur"]')).toHaveCount(2);
  await expect(schema.locator('[data-lfh="koerperfigur"]').first()).toHaveAttribute(
    'data-figur',
    'weiblich',
  );
  await expect(schema.getByRole('button')).toHaveCount(0);

  // ── Unter Druckmedium, mit ausgelöstem `beforeprint` (frontend/src/druck/AGENTS.md).
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await drucken.click();
  await page.emulateMedia({ media: 'print' });
  await expect(wurzel).toBeVisible();
  const blatt = await schema.evaluate((el) => {
    const farbe = (e: Element, eigenschaft: 'stroke' | 'fill' | 'color') =>
      getComputedStyle(e)[eigenschaft];
    const umrisse = [...el.querySelectorAll('[data-lfh="koerperfigur"] > [data-lfh="umriss"]')];
    const binnen = [
      ...el.querySelectorAll('[data-lfh="koerperfigur"] > [data-lfh="binnenlinien"]'),
    ];
    const sterne = [...el.querySelectorAll('[data-lfh="stern"]')];
    return {
      umrissFuellung: umrisse.map((u) => u.getAttribute('fill')),
      umrissStrich: umrisse.map((u) => farbe(u, 'stroke')),
      binnenFuellung: binnen.map((b) => b.getAttribute('fill')),
      binnenStrich: binnen.map((b) => farbe(b, 'stroke')),
      sternFarben: sterne.map((s) => farbe(s.querySelector('path')!, 'stroke')),
      nummernFarben: sterne.map((s) => farbe(s.querySelector('text')!, 'fill')),
      sternNummern: sterne.map((s) => s.getAttribute('data-nummer')),
      listenNummern: [...el.querySelectorAll('ol[aria-label="Verletzungen"] > li')].map(
        (li) => li.textContent?.split(' ')[0],
      ),
    };
  });
  expect(blatt.umrissFuellung).toEqual(['none', 'none']);
  expect(blatt.umrissStrich).toEqual([SCHWARZ, SCHWARZ]);
  // Binnenlinien (LLH-1485) zeichnen im Druck wie die Kontur, ohne Fläche.
  expect(blatt.binnenFuellung).toEqual(['none', 'none']);
  expect(blatt.binnenStrich).toEqual([SCHWARZ, SCHWARZ]);
  expect(blatt.sternFarben).toEqual([SCHWARZ, SCHWARZ, SCHWARZ]);
  expect(blatt.nummernFarben).toEqual([SCHWARZ, SCHWARZ, SCHWARZ]);
  expect([...blatt.sternNummern].sort()).toEqual(['1', '2', '3']);
  expect(blatt.listenNummern).toEqual(['1', '2', '3']);
  await expect(wurzel).toContainText('Blutstillung');
  await expect(wurzel).toContainText('Unterarm links, vorn · Fraktur-Verdacht · schwer');

  if (browserName === 'chromium') {
    test.info().annotations.push({ type: 'nur-chromium', description: 'PDF des Blatts' });
    const seiten = await pdfAuszug(await page.pdf({ format: 'A4' }));
    const text = seiten.map((s) => s.text).join(' ');
    expect(text).toContain('Körperschema');
    expect(text).toContain('Rücken, hinten · Schmerz');
  }
  await page.emulateMedia({ media: null });

  // ── Das Öffnen steht als Druck an der Person (die Einsicht hat nur die Einsatzleitung).
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const audit = await page.request.get(`/api/einsaetze/${einsatzId}/personen/${pid}/audit`);
  expect(audit.ok()).toBe(true);
  const eintraege = (await audit.json()) as { art: string; person_id: number | null }[];
  expect(eintraege.filter((e) => e.art === 'druck' && e.person_id === pid)).toHaveLength(1);
});

test('unbekannte Person: „nicht gefunden“, kein Druckknopf', async ({ page }) => {
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Körperschema-Druck leer ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/personen/987654/druck`);
  await expect(page.getByText('Person nicht gefunden')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Drucken / als PDF' })).toHaveCount(0);
  await expect(page.locator('[data-lfh="druckwurzel"]')).toHaveCount(0);
});
