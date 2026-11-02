import type { APIRequestContext } from '@playwright/test';
import { waehleIn, waehleStehend, zeigtWahl } from '../auswahl-kern';
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
 * Bilder des Kapitels „Ablösung“ (`docs/anwender/kapitel/abloesung.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep abloesung`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   schichten.png        frontend/src/pages/AbloesungPage.tsx, frontend/src/abloesung/AbloesungKarte.tsx,
 *                        frontend/src/abloesung/abloeserStand.ts (Stand des Ablösers, LLH-1131),
 *                        frontend/src/abloesung/planungWarnung.ts (Warnung an der Karte)
 *   ohne-schicht.png     frontend/src/pages/AbloesungPage.tsx (Ansicht „Ohne Schicht“),
 *                        frontend/src/abloesung/OhneSchichtKarte.tsx, frontend/src/abloesung/ohneSchicht.ts
 *   schicht-beginnen.png frontend/src/abloesung/AbloesungDialoge.tsx (`SchichtBeginnenDialog`)
 *   vollziehen.png       frontend/src/abloesung/AbloesungDialoge.tsx (Vollzugsdialog mit Ablöser-Liste und
 *                        „Abschnitt übergeben“, LLH-1132), frontend/src/abloesung/abloeser.ts
 *   besatzungswechsel.png frontend/src/abloesung/AbloesungDialoge.tsx (Vollzugsdialog mit Art
 *                        „Besatzungswechsel“, LLH-1150, Klappteil „Verteilen“, LLH-1319),
 *                        frontend/src/abloesung/besatzung.ts
 *   vorgaben.png         frontend/src/pages/AbloesungPage.tsx (Paneel „Rhythmus je Abschnitt“)
 *   einsatz-vorgabe.png  frontend/src/pages/AbloesungPage.tsx (Paneel „Vorgabe des Einsatzes“),
 *                        frontend/src/abloesung/schichtmodellText.ts, frontend/src/abloesung/dauer.ts
 *
 * Demo-Lücke (D3): die Demo-Daten tragen keine Schichten. Die Spec setzt am Abschnitt
 * „Sanitätsdienst“ die Vorgabe 6 h, bildet eine „2. Rettungsstaffel“ als Ablöser und beginnt drei
 * Schichten: eine überfällige, eine in der Vorwarnzeit und eine planmäßige mit eigenem Rhythmus.
 * Die Vorgabe des Einsatzes bringen die Demo-Daten mit (LLH-1122: „12-h-Schicht Hochwasser“,
 * `src/demo/szenario.rs`).
 *
 * „Ohne Schicht“ (LLH-1128): die Demo-Daten tragen keine Kräfte-Zeitachse. Die Spec lässt den
 * geplanten Ablöser per Nachtrag eintreffen (mit der Vorgabe des Einsatzes begänne jede andere
 * Einheit beim Eintreffen ihre Schicht von selbst, er nicht) und die Betreuungsgruppe alarmieren,
 * noch ohne Eintreffen.
 *
 * Besatzungswechsel (LLH-1150): die Spec disponiert zwei Kräfte ohne Einheit („Lena Brandt“,
 * „Tom Weber“), aus denen der Dialog die neue Besatzung wählt.
 * Hinweise an der Karte (LLH-1131 Teil II): der geplante Ablöser wird vor seinem Eintreffen per
 * Nachtrag alarmiert und danach am neu angelegten „BR Sportplatz“ eingebucht (die Zeitachse lässt
 * das zweite Eintreffen aus); der Sanitätszug plant die Sanitätsgruppe UHS, die selbst eine
 * laufende Schicht hat, und trägt damit die Warnung „… steht selbst im Einsatz seit …“.
 */

const KAPITEL = 'abloesung';

interface Einheit {
  id: number;
  name: string;
}
interface Vorgabe {
  abschnitt_id: number;
  abschnitt_name: string;
}
interface Schicht {
  id: number;
}

/** Drahtformat des Servers: UTC ohne Zonenkennung. */
function draht(zeit: Date): string {
  return zeit.toISOString().slice(0, 19).replace('T', ' ');
}

function vor(basis: Date, minuten: number): Date {
  return new Date(basis.getTime() - minuten * 60_000);
}

async function liste<T>(api: APIRequestContext, pfad: string): Promise<T[]> {
  const antwort = await api.get(pfad);
  expect(antwort.ok(), `${pfad}: ${antwort.status()}`).toBe(true);
  return (await antwort.json()) as T[];
}

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    try {
      const demo = await demoEinsatz(api);
      const basis = `/api/einsaetze/${demo.id}`;
      const jetzt = new Date();
      const einheiten = await liste<Einheit>(api, `${basis}/einheiten`);
      const einheit = (name: string) => {
        const e = einheiten.find((x) => x.name === name);
        expect(e, `Einheit „${name}“`).toBeDefined();
        return e!.id;
      };
      const vorgaben = await liste<Vorgabe>(api, `${basis}/abloesungen/vorgaben`);
      const sanitaetsdienst = vorgaben.find((v) => v.abschnitt_name === 'Sanitätsdienst');
      expect(sanitaetsdienst, 'Abschnitt „Sanitätsdienst“').toBeDefined();
      await fuelle(api, 'put', `${basis}/abloesungen/vorgaben/${sanitaetsdienst!.abschnitt_id}`, {
        rhythmus_minuten: 360,
      });
      const abloeser = await fuelle<Einheit>(api, 'post', `${basis}/einheiten`, {
        name: '2. Rettungsstaffel',
      });

      const rettung = await fuelle<Schicht>(api, 'post', `${basis}/abloesungen`, {
        einheit_id: einheit('Rettungsstaffel'),
        beginn_at: draht(vor(jetzt, 380)),
      });
      await fuelle(api, 'patch', `${basis}/abloesungen/${rettung.id}`, {
        abloesende_einheit_id: abloeser.id,
      });
      const sanitaetszug = await fuelle<Schicht>(api, 'post', `${basis}/abloesungen`, {
        einheit_id: einheit('Sanitätszug Musterstadt'),
        beginn_at: draht(vor(jetzt, 340)),
      });
      await fuelle(api, 'post', `${basis}/abloesungen`, {
        einheit_id: einheit('Sanitätsgruppe UHS'),
        beginn_at: draht(vor(jetzt, 240)),
        rhythmus_minuten: 480,
      });
      await fuelle(api, 'patch', `${basis}/abloesungen/${sanitaetszug.id}`, {
        abloeser_ids: [einheit('Sanitätsgruppe UHS')],
      });
      await fuelle(api, 'post', `${basis}/einheiten/${abloeser.id}/zeitachse`, {
        art: 'alarmierung',
        zeitpunkt_at: draht(vor(jetzt, 55)),
      });
      await fuelle(api, 'post', `${basis}/einheiten/${abloeser.id}/zeitachse`, {
        art: 'eintreffen',
        zeitpunkt_at: draht(vor(jetzt, 25)),
      });
      const raum = await fuelle<{ id: number }>(api, 'post', `${basis}/bereitstellungsraeume`, {
        bezeichnung: 'BR Sportplatz',
      });
      await fuelle(api, 'post', `${basis}/bereitstellungsraeume/${raum.id}/status`, {
        status: 'aktiv',
      });
      await fuelle(api, 'post', `${basis}/bereitstellungsraeume/${raum.id}/eintreffen`, {
        kraft: { objekt_typ: 'einheit', objekt_id: abloeser.id },
      });
      await fuelle(api, 'post', `${basis}/einheiten/${einheit('Betreuungsgruppe')}/zeitachse`, {
        art: 'alarmierung',
        zeitpunkt_at: draht(vor(jetzt, 40)),
      });
      for (const name of ['Lena Brandt', 'Tom Weber']) {
        await fuelle(api, 'post', `${basis}/personal`, { adhoc: { name } });
      }
    } finally {
      await api.dispose();
    }
  });

  test('Laufende Schichten', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/abloesung`);
    const schichten = page.getByRole('region', { name: 'Laufende Schichten' });
    await expect(schichten.locator('[data-lfh="abloesung-karte"]')).toHaveCount(3);
    await expect(
      schichten
        .getByRole('article', { name: 'Schicht Rettungsstaffel' })
        .locator('[data-lfh="abloesung-abloeser"]'),
    ).toHaveText(
      /^Ablösung: 2\. Rettungsstaffel · alarmiert \d{4} · eingetroffen \d{4} \(BR Sportplatz\)$/,
    );
    await expect(
      schichten
        .getByRole('article', { name: 'Schicht Sanitätszug Musterstadt' })
        .locator('[data-lfh="abloesung-planung-warnung"]'),
    ).toHaveText(/^Sanitätsgruppe UHS steht selbst im Einsatz seit \d{4}$/);
    await fotografiere(schichten, KAPITEL, 'schichten');
  });

  test('Einheiten ohne Schicht', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/abloesung`);
    const segment = page.getByRole('radio', { name: /^Ohne Schicht/ });
    await expect(segment).toHaveText('Ohne Schicht (2)');
    await segment.click();
    const liste = page.getByRole('region', { name: 'Einheiten ohne Schicht' });
    await expect(liste.locator('[data-lfh="abloesung-ohne-schicht"]')).toHaveCount(2);
    await fotografiere(liste, KAPITEL, 'ohne-schicht');
  });

  test('Paneel „Rhythmus je Abschnitt“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/abloesung`);
    const paneel = page.getByRole('region', { name: 'Rhythmus je Abschnitt' });
    await expect(paneel.getByText('Rhythmus 6 h · 2 laufend')).toBeVisible();
    await fotografiere(paneel, KAPITEL, 'vorgaben');
  });

  test('Paneel „Vorgabe des Einsatzes“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/abloesung`);
    const paneel = page.getByRole('region', { name: 'Vorgabe des Einsatzes' });
    await expect(paneel.getByText('12-h-Schicht Hochwasser')).toBeVisible();
    await fotografiere(paneel, KAPITEL, 'einsatz-vorgabe');
  });

  test('Dialog „Schicht beginnen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/abloesung`);
    await page.getByRole('button', { name: 'Schicht beginnen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Schicht beginnen' });
    await waehleIn(dialog.getByRole('combobox', { name: 'Einheit' }), 'Betreuungsgruppe');
    await dialog.getByRole('textbox', { name: 'Rhythmus' }).fill('8 h');
    await dialog.getByRole('textbox', { name: 'Rhythmus' }).blur();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'schicht-beginnen');
  });

  test('Dialog „Ablösung vollziehen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/abloesung`);
    const karte = page.getByRole('article', { name: 'Schicht Rettungsstaffel' });
    await karte.getByRole('button', { name: 'Ablösung vollziehen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ablösung Rettungsstaffel vollziehen' });
    await expect(dialog.getByTitle('2. Rettungsstaffel', { exact: true })).toBeVisible();
    // Der Dialog setzt den Fokus ins erste Feld; das Bild soll keinen Fokusrahmen zeigen.
    await expect(dialog.getByRole('checkbox', { name: /^Abschnitt übergeben/ })).toBeChecked();
    // „Danach“ (LLH-1308): die abgelöste Staffel geht in den Bereitstellungsraum des Demo-Einsatzes.
    const danach = dialog.getByRole('combobox', { name: 'Danach' });
    await waehleIn(danach, 'Bereitstellungsraum «Parkplatz Stadion Nord»');
    await danach.blur();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'vollziehen');
  });

  test('Dialog „Ablösung vollziehen“ als Besatzungswechsel', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/abloesung`);
    const karte = page.getByRole('article', { name: 'Schicht Sanitätszug Musterstadt' });
    await karte.getByRole('button', { name: 'Ablösung vollziehen' }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Ablösung Sanitätszug Musterstadt vollziehen',
    });
    await dialog.getByText('Besatzungswechsel', { exact: true }).click();
    await expect(dialog.locator('[data-lfh="vollzug-bisherige-besatzung"]')).not.toContainText('…');
    // Die Liste ist virtuell und lang (alle Kräfte des Demo-Einsatzes): erst suchen, dann wählen.
    const feld = dialog.getByRole('combobox', { name: 'Neue Besatzung' });
    for (const name of ['Lena Brandt', 'Tom Weber']) {
      await feld.click();
      await feld.pressSequentially(name);
      await waehleStehend(page, name);
      await zeigtWahl(feld, name);
    }
    await feld.blur();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'besatzungswechsel');
  });
});
