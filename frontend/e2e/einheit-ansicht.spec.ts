import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { offeneAuswahl, waehleIn, waehleStehend } from './auswahl-kern';
import { wechsleZuRolle } from './rollen-kern';
import { FUEKW, anmelden, einsatzAnlegen, stelleDichte } from './trefflaeche-kern';

/**
 * Einheit-Ansicht (LLH-1036, Spec `einheit-ansicht`) am echten Backend, in `kompakt` und
 * `handschuh` am Fükw-Schirm: eine Angabe an ihrer Zeile ändern schickt genau ihr Feld, das
 * taktische Zeichen landet auch im Meldebild, Person und Fahrzeug kommen aus dem Stamm in die
 * Einheit und die Person über ihr Menü auf das Fahrzeug, „Personal der Einheit übernehmen“ setzt
 * die freien Kräfte in einem Schritt auf ein Fahrzeug (LLH-1267), und der Beobachter sieht nur die
 * Ansicht.
 *
 * Belegt wird je Handgriff der Körper der Anfrage: das alte Formular schickte den ganzen Stand vom
 * Öffnen und überschrieb so still, was ein anderer Arbeitsplatz geändert hatte. Die Treffflächen
 * derselben Ziele misst `gate3-trefflaeche.spec.ts`, die Fokusverdeckung `fokus-verdeckung.spec.ts`.
 */

const DICHTEN = ['kompakt', 'handschuh'] as const;
const LAUF = Date.now();

/** Körper aller PATCH an diese Einheit (Angaben und Lageweg), in Reihenfolge. */
function recordWrites(page: Page, einsatzId: string, einheitId: number) {
  const bodies: { pfad: string; body: unknown }[] = [];
  const pattern = new RegExp(`/api/einsaetze/${einsatzId}/einheiten/${einheitId}(/position)?$`);
  page.on('request', (r: Request) => {
    if (r.method() === 'PATCH' && pattern.test(r.url())) {
      bodies.push({ pfad: new URL(r.url()).pathname, body: r.postDataJSON() });
    }
  });
  return bodies;
}

/** Körper aller Sammel-Dispositionen (LLH-1100) dieses Einsatzes, in Reihenfolge. */
function recordSammel(page: Page, einsatzId: string) {
  const bodies: { pfad: string; body: unknown }[] = [];
  const pattern = new RegExp(`/api/einsaetze/${einsatzId}/(personal|fahrzeuge)/sammel$`);
  page.on('request', (r: Request) => {
    if (r.method() === 'POST' && pattern.test(r.url())) {
      bodies.push({ pfad: new URL(r.url()).pathname, body: r.postDataJSON() });
    }
  });
  return bodies;
}

/** Körper aller Besatzungs-Zuordnungen über die Sammelroute (LLH-1073 D12), in Reihenfolge. */
function recordBesatzung(page: Page, einsatzId: string) {
  const bodies: { pfad: string; body: unknown }[] = [];
  const pattern = new RegExp(`/api/einsaetze/${einsatzId}/fahrzeuge/\\d+/besatzung$`);
  page.on('request', (r: Request) => {
    if (r.method() === 'POST' && pattern.test(r.url())) {
      bodies.push({ pfad: new URL(r.url()).pathname, body: r.postDataJSON() });
    }
  });
  return bodies;
}

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return ((await antwort.json()) as { id: number }).id;
}

/** Wählt im Auswahlfeld `feld` des Paneels die Option `titel`, mit dem Namen vorher gesucht. */
async function ordneZu(paneel: Locator, feld: string, suche: string, titel: string) {
  const eingabe = paneel.getByRole('combobox', { name: feld });
  await eingabe.click();
  await eingabe.fill(suche);
  await waehleStehend(paneel.page(), titel);
  await expect(offeneAuswahl(paneel.page())).toHaveCount(0);
}

async function put(page: Page, pfad: string): Promise<void> {
  const antwort = await page.request.put(pfad);
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
}

/** `einsatz_personal.id` der Kraft mit diesem Namen im Einsatz. */
async function epIdVon(page: Page, einsatzId: string, name: string): Promise<number> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/personal`);
  const liste = (await antwort.json()) as { id: number; name: string }[];
  const treffer = liste.find((p) => p.name === name);
  if (!treffer) throw new Error(`Kraft ${name} nicht im Einsatz`);
  return treffer.id;
}

/** `einsatz_fahrzeug.id` des Fahrzeugs mit diesem Funkrufnamen im Einsatz. */
async function efIdVon(page: Page, einsatzId: string, funkrufname: string): Promise<number> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/fahrzeuge`);
  const liste = (await antwort.json()) as { id: number; funkrufname: string }[];
  const treffer = liste.find((f) => f.funkrufname === funkrufname);
  if (!treffer) throw new Error(`Fahrzeug ${funkrufname} nicht im Einsatz`);
  return treffer.id;
}

async function createEinheit(page: Page, einsatzId: string, name: string): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/einheiten`, {
    data: { name },
  });
  expect(antwort.ok(), `Seeding Einheit: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return ((await antwort.json()) as { id: number }).id;
}

for (const dichte of DICHTEN) {
  test.describe(`Einheit-Ansicht (${dichte})`, () => {
    test.use({ viewport: FUEKW });

    test.beforeEach(async ({ page }) => {
      await anmelden(page);
    });

    test('Name an der Zeile ändern: genau `name` geht hinaus', async ({ page }) => {
      const einsatzId = await einsatzAnlegen(page, `E2E 1036 Name ${dichte} ${Date.now()}`);
      const einheitId = await createEinheit(page, einsatzId, '1. Zug');
      await page.goto(`/einsaetze/${einsatzId}/einheiten/${einheitId}`);
      await stelleDichte(page, dichte);
      const bodies = recordWrites(page, einsatzId, einheitId);

      const kopf = page.getByRole('region', { name: 'Kopfdaten' });
      // Ohne Klick kein Eingabefeld: die Angaben stehen als Werte da.
      await expect(kopf.getByRole('textbox')).toHaveCount(0);
      await kopf.getByRole('button', { name: 'Name bearbeiten' }).click();
      const feld = kopf.getByRole('textbox', { name: 'Name' });
      await expect(feld).toBeFocused();
      await feld.fill('1. Zug Nord');
      await feld.press('Enter');

      await expect(
        kopf.getByRole('button', { name: 'Name bearbeiten' }),
      ).toHaveAccessibleDescription('1. Zug Nord');
      await expect(page.getByRole('heading', { name: '1. Zug Nord', level: 1 })).toBeVisible();
      expect(bodies).toEqual([
        {
          pfad: `/api/einsaetze/${einsatzId}/einheiten/${einheitId}`,
          body: { name: '1. Zug Nord' },
        },
      ]);
    });

    test('Organisation des Zeichens setzen: genau `tz_organisation`, das Meldebild trägt sie', async ({
      page,
    }) => {
      const einsatzId = await einsatzAnlegen(page, `E2E 1036 Zeichen ${dichte} ${Date.now()}`);
      const einheitId = await createEinheit(page, einsatzId, '2. Zug');
      await page.goto(`/einsaetze/${einsatzId}/einheiten/${einheitId}`);
      await stelleDichte(page, dichte);
      const bodies = recordWrites(page, einsatzId, einheitId);

      const zeichen = page.getByRole('region', { name: 'Taktisches Zeichen' });
      await zeichen.getByRole('button', { name: 'Organisation eintragen' }).click();
      await waehleIn(zeichen.getByRole('combobox', { name: 'Organisation' }), 'THW');
      await zeichen.getByRole('button', { name: 'Organisation speichern' }).click();
      await expect(
        zeichen.getByRole('button', { name: 'Organisation bearbeiten' }),
      ).toHaveAccessibleDescription('THW');
      expect(bodies).toEqual([
        {
          pfad: `/api/einsaetze/${einsatzId}/einheiten/${einheitId}/position`,
          body: { tz_organisation: 'thw' },
        },
      ]);

      await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
      const zeile = page.locator(`[data-row-key="eh-${einheitId}"]`);
      await expect(zeile.locator('[data-lfh="einheit-zeichen"] svg desc')).toContainText(
        'Organisation: Technisches Hilfswerk',
      );
    });

    test('Person und Fahrzeug aus dem Stamm zuordnen, die Person über ihr Menü auf das Fahrzeug setzen', async ({
      page,
    }) => {
      const einsatzId = await einsatzAnlegen(page, `E2E 1036 Stamm ${dichte} ${Date.now()}`);
      const einheitId = await createEinheit(page, einsatzId, '4. Zug');
      const person = `Stamm ${LAUF} ${dichte} Anna`;
      const fahrzeug = `Stamm ${LAUF} ${dichte} 83-1`;
      const personalId = await post(page, '/api/personal', { name: person });
      const fahrzeugId = await post(page, '/api/fahrzeuge', {
        funkrufname: fahrzeug,
        fahrzeugtyp: 'RTW',
      });
      await page.goto(`/einsaetze/${einsatzId}/einheiten/${einheitId}`);
      await stelleDichte(page, dichte);
      const bodies = recordSammel(page, einsatzId);
      const besatzung = recordBesatzung(page, einsatzId);

      const paneel = page.getByRole('region', { name: 'Fahrzeuge und Besatzung' });
      await expect(paneel).toContainText('—');
      await ordneZu(paneel, 'Fahrzeug zuordnen', fahrzeug, `${fahrzeug} (RTW)`);
      const aufFahrzeug = paneel.getByRole('group', { name: `Fahrzeug ${fahrzeug}` });
      await expect(aufFahrzeug).toBeVisible();

      await ordneZu(paneel, 'Person zuordnen', person, person);
      const ohne = paneel.getByRole('group', { name: 'Ohne Fahrzeug' });
      await expect(ohne.getByRole('link', { name: person })).toBeVisible();
      expect(bodies).toEqual([
        {
          pfad: `/api/einsaetze/${einsatzId}/fahrzeuge/sammel`,
          body: { fahrzeug_ids: [fahrzeugId], einheit_id: einheitId },
        },
        {
          pfad: `/api/einsaetze/${einsatzId}/personal/sammel`,
          body: { personal_ids: [personalId], einheit_id: einheitId, fahrzeug_id: null },
        },
      ]);

      await paneel.getByRole('button', { name: `Aktionen zu Person ${person}` }).click();
      await page.getByRole('menuitem', { name: `Auf ${fahrzeug}` }).click();
      await expect(aufFahrzeug.getByRole('link', { name: person })).toBeVisible();
      await expect(ohne).toHaveCount(0);
      // Über die Sammelroute mit genau dieser Kraft (LLH-1267).
      const epId = await epIdVon(page, einsatzId, person);
      expect(besatzung).toEqual([
        {
          pfad: `/api/einsaetze/${einsatzId}/fahrzeuge/${await efIdVon(page, einsatzId, fahrzeug)}/besatzung`,
          body: { ep_ids: [epId] },
        },
      ]);
    });

    test('Personal der Einheit übernehmen: die freien Kräfte in einem Schritt auf das Fahrzeug', async ({
      page,
    }) => {
      const einsatzId = await einsatzAnlegen(page, `E2E 1267 Übernahme ${dichte} ${Date.now()}`);
      const einheitId = await createEinheit(page, einsatzId, '5. Zug');
      const efId = await post(page, `/api/einsaetze/${einsatzId}/fahrzeuge`, {
        adhoc: { funkrufname: `Ü ${dichte} 83-1` },
      });
      await put(page, `/api/einsaetze/${einsatzId}/einheiten/${einheitId}/fahrzeug/${efId}`);
      const epIds: number[] = [];
      for (const name of ['Ü Berta', 'Ü Carl']) {
        const epId = await post(page, `/api/einsaetze/${einsatzId}/personal`, { adhoc: { name } });
        await put(page, `/api/einsaetze/${einsatzId}/einheiten/${einheitId}/personal/${epId}`);
        epIds.push(epId);
      }
      await page.goto(`/einsaetze/${einsatzId}/einheiten/${einheitId}`);
      await stelleDichte(page, dichte);
      const bodies = recordBesatzung(page, einsatzId);

      const paneel = page.getByRole('region', { name: 'Fahrzeuge und Besatzung' });
      const aufFahrzeug = paneel.getByRole('group', { name: `Fahrzeug Ü ${dichte} 83-1` });
      const ohne = paneel.getByRole('group', { name: 'Ohne Fahrzeug' });
      await expect(ohne.getByRole('link', { name: 'Ü Carl' })).toBeVisible();
      await aufFahrzeug.getByRole('button', { name: 'Personal der Einheit übernehmen' }).click();
      const dialog = page.getByRole('dialog', {
        name: `Personal der Einheit auf Ü ${dichte} 83-1`,
      });
      // Ohne Soll am Fahrzeug sind alle freien Kräfte vorgewählt.
      await expect(dialog.getByRole('checkbox', { name: 'Ü Berta' })).toBeChecked();
      await expect(dialog.getByRole('checkbox', { name: 'Ü Carl' })).toBeChecked();
      await dialog.getByRole('button', { name: 'Übernehmen' }).click();
      await expect(dialog).toHaveCount(0);

      await expect(aufFahrzeug.getByRole('link', { name: 'Ü Berta' })).toBeVisible();
      await expect(aufFahrzeug.getByRole('link', { name: 'Ü Carl' })).toBeVisible();
      await expect(ohne).toHaveCount(0);
      // Jetzt ist niemand mehr frei: gesperrt, der Grund steht daneben.
      await expect(
        aufFahrzeug.getByRole('button', { name: 'Personal der Einheit übernehmen' }),
      ).toBeDisabled();
      await expect(aufFahrzeug.getByText('keine freien Kräfte der Einheit')).toBeVisible();
      expect(bodies).toEqual([
        {
          pfad: `/api/einsaetze/${einsatzId}/fahrzeuge/${efId}/besatzung`,
          body: { ep_ids: epIds },
        },
      ]);
    });

    test('Beobachter: keine Stifte, kein Menü, keine Auswahl, kein Auflösen', async ({ page }) => {
      const einsatzId = await einsatzAnlegen(page, `E2E 1036 Beobachter ${dichte} ${Date.now()}`);
      const einheitId = await createEinheit(page, einsatzId, '3. Zug');
      // Ein Mitglied, damit „kein Menü“ nicht schon an der leeren Einheit wahr ist.
      const epId = await post(page, `/api/einsaetze/${einsatzId}/personal`, {
        adhoc: { name: 'Beo Mitglied' },
      });
      const zuordnung = await page.request.put(
        `/api/einsaetze/${einsatzId}/einheiten/${einheitId}/personal/${epId}`,
      );
      expect(zuordnung.ok(), await zuordnung.text()).toBe(true);
      await wechsleZuRolle(page, 'beobachter', einsatzId);
      await page.goto(`/einsaetze/${einsatzId}/einheiten/${einheitId}`);
      await stelleDichte(page, dichte);

      const main = page.getByRole('main');
      // Erst der Inhaltsanker, sonst wäre „fehlt“ auch im Ladezustand wahr.
      await expect(main.getByRole('region', { name: 'Kopfdaten' })).toContainText('3. Zug');
      await expect(
        main.getByRole('region', { name: 'Fahrzeuge und Besatzung' }).getByText('Beo Mitglied'),
      ).toBeVisible();
      await expect(main.getByRole('button', { name: /^Aktionen zu Person / })).toHaveCount(0);
      await expect(main.getByRole('combobox', { name: /zuordnen$/ })).toHaveCount(0);
      await expect(main.getByRole('button', { name: 'Aus Einheit lösen' })).toHaveCount(0);
      await expect(main.getByRole('button', { name: /(bearbeiten|eintragen)$/ })).toHaveCount(0);
      await expect(main.getByRole('button', { name: /^Status von / })).toHaveCount(0);
      await expect(main.getByRole('region', { name: 'Einheit auflösen' })).toHaveCount(0);
      await expect(main.getByRole('button', { name: 'Einheit auflösen' })).toHaveCount(0);
    });
  });
}
