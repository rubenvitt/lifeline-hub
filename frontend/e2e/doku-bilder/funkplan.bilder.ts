import type { APIRequestContext, Page } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
import {
  apiAlsAdmin,
  anmelden,
  demoEinsatz,
  expect,
  fotografiere,
  fuelle,
  test,
  uhrAnhalten,
} from './kern';

/**
 * Bilder des Kapitels „Funkplan, Fernmeldeskizze und Kommunikationsplan“
 * (`docs/anwender/kapitel/funkplan.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep funkplan`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   tabelle.png             frontend/src/pages/FunkplanPage.tsx (Tabelle, Lücken)
 *   skizze.png              frontend/src/pages/FunkplanPage.tsx, frontend/src/stab/FernmeldeskizzeBild.tsx
 *   kommunikationsplan.png  frontend/src/pages/KommunikationsplanPage.tsx
 *   verbindung.png          frontend/src/stab/KommunikationsplanDialoge.tsx
 *
 * Füllung (D3): der Demo-Einsatz kennt keine Sprechgruppen und keinen Kommunikationsplan. Drei
 * einsatzlokale Sprechgruppen, die eigene Führungsstelle, Funkangaben an zwei Abschnitten und
 * zwei Einheiten sowie zwei externe Stellen und die Stelle S5 kommen über die API, jeweils nur, wenn sie fehlen
 * (ein Lauf aller Kapitel teilt eine Datenbank). Logistik und drei Einheiten bleiben ohne
 * Sprechgruppe: so zeigt das Paneel „Lücken“, wofür es da ist.
 */

const KAPITEL = 'funkplan';

interface Sprechgruppe {
  id: number;
  bezeichnung: string;
}

/** Einsatzlokale Sprechgruppe, angelegt nur, wenn es sie im Einsatz noch nicht gibt. */
async function sprechgruppe(
  api: APIRequestContext,
  einsatzId: number,
  bezeichnung: string,
  betriebsart: 'TMO' | 'DMO',
): Promise<Sprechgruppe> {
  const liste = await api.get(`/api/einsaetze/${einsatzId}/sprechgruppen`);
  expect(liste.ok(), `Sprechgruppen: ${liste.status()}`).toBe(true);
  const vorhanden = ((await liste.json()) as Sprechgruppe[]).find(
    (s) => s.bezeichnung === bezeichnung,
  );
  return (
    vorhanden ??
    fuelle<Sprechgruppe>(api, 'post', `/api/einsaetze/${einsatzId}/sprechgruppen`, {
      bezeichnung,
      betriebsart,
    })
  );
}

/** Id eines Datensatzes aus einer Liste des Einsatzes, nach Name. */
async function idNachName(api: APIRequestContext, pfad: string, name: string): Promise<number> {
  const liste = (await (await api.get(pfad)).json()) as { id: number; name: string }[];
  const treffer = liste.find((x) => x.name === name);
  expect(treffer, `${pfad}: „${name}“`).toBeDefined();
  return treffer!.id;
}

/**
 * Meldet der Seite die Benachrichtigungs-Freigabe als erteilt. Der kopflose Chromium sagt sonst
 * „denied“ (auch mit `permissions: ['notifications']`), und die Kopfleiste zeigte „Benachrichtigung
 * blockiert“ — ein Zustand des Bildlaufs, nicht der Arbeitsplätze, die das Bild zeigen soll.
 */
async function benachrichtigungErlaubt(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (typeof Notification !== 'undefined') {
      Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    }
  });
}

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    const { id } = await demoEinsatz(api);
    const e = `/api/einsaetze/${id}`;
    const el = await sprechgruppe(api, id, 'TMO 311_F_EL', 'TMO');
    const san = await sprechgruppe(api, id, 'TMO 311_F_SAN', 'TMO');
    const dmo = await sprechgruppe(api, id, 'DMO 505', 'DMO');

    const fs = await (await api.get(`${e}/fuehrungsstelle`)).json();
    if (!fs.rufname) {
      const fahrzeuge = (await (await api.get(`${e}/fahrzeuge`)).json()) as {
        id: number;
        funkrufname: string;
      }[];
      const elw = fahrzeuge.find((f) => f.funkrufname === 'Musterstadt 11-1');
      await fuelle(api, 'patch', `${e}/fuehrungsstelle`, {
        rufname: 'Florian Musterstadt 11-1',
        kommunikationsmittel: 'digitalfunk',
        erreichbarkeit: '0561 123 4567',
        sprechgruppe_ids: [el.id, dmo.id],
        fahrzeug_ids: elw ? [elw.id] : [],
      });
    }

    // Die Zuordnung ersetzt die Menge: wiederholt ist sie dieselbe.
    const abschnitte = `${e}/abschnitte`;
    await fuelle(
      api,
      'patch',
      `${abschnitte}/${await idNachName(api, abschnitte, 'Sanitätsdienst')}`,
      {
        sprechgruppe_ids: [el.id, san.id],
        kommunikationsmittel: 'digitalfunk',
        erreichbarkeit: '0170 555 0101',
      },
    );
    await fuelle(
      api,
      'patch',
      `${abschnitte}/${await idNachName(api, abschnitte, 'UHS Turnhalle')}`,
      {
        sprechgruppe_ids: [san.id],
      },
    );
    await fuelle(api, 'patch', `${abschnitte}/${await idNachName(api, abschnitte, 'Betreuung')}`, {
      sprechgruppe_ids: [el.id],
      kommunikationsmittel: 'mobil',
      erreichbarkeit: '0170 555 0202',
    });
    const einheiten = `${e}/einheiten`;
    for (const name of ['Sanitätszug Musterstadt', 'Rettungsstaffel']) {
      await fuelle(api, 'patch', `${einheiten}/${await idNachName(api, einheiten, name)}`, {
        sprechgruppe_ids: [san.id],
      });
    }

    const plan = `${e}/stab/kommunikationsplan`;
    const stellen = (await (await api.get(plan)).json()) as { bezeichnung?: string }[];
    if (!stellen.some((s) => s.bezeichnung === 'ILS Musterstadt')) {
      const neu = (await fuelle(api, 'post', `${plan}/stellen?antwort=stelle`, {
        stellenart: 'leitstelle',
        bezeichnung: 'ILS Musterstadt',
      })) as { id: number };
      await fuelle(api, 'post', `${plan}/stellen/${neu.id}/verbindungen`, {
        mittel: 'festnetz',
        wert: '0561 7000 112',
        hinweis: 'Lagedienst',
      });
    }
    const mitFunktion = stellen as { funktion?: string }[];
    if (!mitFunktion.some((s) => s.funktion === 's5')) {
      const neu = (await fuelle(api, 'post', `${plan}/stellen?antwort=stelle`, {
        stellenart: 'funktion',
        funktion: 's5',
      })) as { id: number };
      await fuelle(api, 'post', `${plan}/stellen/${neu.id}/verbindungen`, {
        mittel: 'email',
        wert: 'presse@musterstadt.example',
      });
    }
    if (!stellen.some((s) => s.bezeichnung === 'Ordnungsamt Musterstadt')) {
      await fuelle(api, 'post', `${plan}/stellen?antwort=stelle`, {
        stellenart: 'behoerde',
        bezeichnung: 'Ordnungsamt Musterstadt',
      });
    }
    await api.dispose();
  });

  test('Funkplan als Tabelle mit Lücken', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await benachrichtigungErlaubt(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/stab/funkplan`);
    await expect(page.getByRole('region', { name: 'Lücken' })).toBeVisible();
    await expect(page.getByText('Florian Musterstadt 11-1').first()).toBeVisible();
    await expect(page.getByText('UHS Turnhalle').first()).toBeVisible();
    // Die Übernahme-Knöpfe laden ihre Quellen nach; mit Ladekreis wirkten sie gesperrt.
    for (const name of ['In Lagebericht übernehmen', 'In Befehl übernehmen']) {
      await expect(page.getByRole('button', { name })).not.toHaveClass(/ant-btn-loading/);
    }
    await fotografiere(page, KAPITEL, 'tabelle');
  });

  test('Fernmeldeskizze', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await benachrichtigungErlaubt(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/stab/funkplan?ansicht=skizze`);
    const blatt = page.locator('[data-lfh="funkplan-blatt"]');
    await expect(blatt.locator('svg text').filter({ hasText: '311_F_SAN' }).first()).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(page.locator('[data-lfh="fernmeldeskizze"]'), KAPITEL, 'skizze');
  });

  test('Kommunikationsplan', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await benachrichtigungErlaubt(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/stab/kommunikationsplan`);
    await expect(page.getByText('0561 7000 112')).toBeVisible();
    await expect(page.getByText('presse@musterstadt.example')).toBeVisible();
    await expect(page.getByText('Sanitätsdienst · EA 1')).toBeVisible();
    await fotografiere(page, KAPITEL, 'kommunikationsplan');
  });

  test('Dialog „Verbindung hinzufügen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/stab/kommunikationsplan`);
    await page
      .getByRole('button', { name: /^Verbindung zu .*Ordnungsamt Musterstadt.* hinzufügen$/ })
      .click();
    const dialog = page.getByRole('dialog', { name: /^Verbindung hinzufügen · / });
    await waehleIn(dialog.getByRole('combobox', { name: 'Mittel' }), 'Mobil');
    await dialog.getByLabel('Nummer/Adresse').fill('0170 555 0300');
    await dialog.getByLabel('Hinweis').fill('Bereitschaft, rund um die Uhr');
    await dialog.getByLabel('Hinweis').blur();
    // Der Zeiger stünde sonst über dem Feld unter der Auswahlliste (hervorgehobener Rahmen).
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'verbindung');
  });
});
