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
 * Bilder des Kapitels „Verpflegung“ (`docs/anwender/kapitel/geraet-verpflegung.md`): ein Tablet an
 * der Essensausgabe, Kontext Tablet, eigener Browserkontext wie in `e2e/geraet-kopplung.spec.ts`.
 * Der Demo-Einsatz hat keine Zeitfenster; zwei legt die Spec als Einsatzleitung über die API an,
 * dazu zwei aktive Verpflegungsstellen (LLH-1040; „Ausgabe Gesamtschule“ dem Mittagessen
 * zugeordnet, „Ausgabe Turnhalle Nord“ nicht) und eine erste Ausgabe an der Gesamtschule (D3).
 * Den Einheiten des Demo-Einsatzes ohne Eintreffen trägt sie eines nach (LLH-1055).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep geraet-verpflegung`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   zeitfenster.png        frontend/src/pages/VerpflegungPage.tsx, frontend/src/verpflegung/ZeitfensterKarte.tsx
 *   ausgabe-zaehlen.png    frontend/src/verpflegung/AusgabeAnsicht.tsx, frontend/src/geraet/GeraeteLayout.tsx
 *                          (Tablet, Stellenwahl mit der zugeordneten Stelle, Empfänger
 *                          „Rettungsstaffel“, offene Sammlung, ein ausstehender Eintrag ohne Netz),
 *                          frontend/src/verpflegung/EmpfaengerStand.tsx (LLH-1055)
 *   fehlmenge.png          frontend/src/geraet/GeraetMeldungenPage.tsx (vorbefüllt aus der Verpflegung)
 */

const KAPITEL = 'geraet-verpflegung';
const MITTAG = 'Mittagessen';
const ABEND = 'Abendessen';
const STELLE = 'Ausgabe Gesamtschule';
/** Untereinheit des Demo-Einsatzes (`src/demo/szenario.rs`, `EINHEITEN_VORLAGEN`). */
const STAFFEL = 'Rettungsstaffel';

/** Zwei Zeitfenster (eines läuft, eines steht an) und eine Ausgabe, einmal je Lauf. */
async function zeitfensterAnlegen(page: Page, einsatz: number) {
  const basis = `/api/einsaetze/${einsatz}/verpflegung`;
  const stand = (await (await page.request.get(basis)).json()) as {
    zeitfenster: { bezeichnung: string }[];
    empfaenger: { einheiten: { id: number; eintreffen_at?: string | null }[] };
  };
  if (stand.zeitfenster.some((z) => z.bezeichnung === MITTAG)) return;
  const stunde = 3_600_000;
  const jetzt = Date.now();
  // Eintreffen der Demo-Einheiten (LLH-1055), nur wo es fehlt.
  for (const e of stand.empfaenger.einheiten.filter((x) => !x.eintreffen_at)) {
    await fuelle(page, 'post', `/api/einsaetze/${einsatz}/einheiten/${e.id}/zeitachse`, {
      art: 'eintreffen',
      zeitpunkt_at: new Date(jetzt - 2 * stunde).toISOString(),
    });
  }
  const stelle = async (bezeichnung: string, standort: string) => {
    const { id } = await fuelle<{ id: number }>(page, 'post', `${basis}/stellen`, {
      bezeichnung,
      art: 'ausgabestelle',
      standort,
    });
    await fuelle(page, 'post', `${basis}/stellen/${id}/status`, { status: 'aktiv' });
    return id;
  };
  const gesamtschule = await stelle(STELLE, 'Gesamtschule, Mensa');
  await stelle('Ausgabe Turnhalle Nord', 'Turnhalle Nord');
  const mittag = await fuelle<{ id: number }>(page, 'post', `${basis}/zeitfenster`, {
    bezeichnung: MITTAG,
    von_at: new Date(jetzt - stunde).toISOString(),
    bis_at: new Date(jetzt + 2 * stunde).toISOString(),
    bedarf_kraefte: 60,
    bedarf_betreute: 90,
    sonderkost: { vegetarisch: 12 },
  });
  await fuelle(page, 'patch', `${basis}/zeitfenster/${mittag.id}`, {
    stelle_ids: [gesamtschule],
    verpflegungsart: 'warm',
  });
  await fuelle(page, 'post', `${basis}/zeitfenster/${mittag.id}/ausgaben`, {
    menge: 80,
    verpflegungsstelle_id: gesamtschule,
    sonderkost: { vegetarisch: 6 },
  });
  await fuelle(page, 'post', `${basis}/zeitfenster`, {
    bezeichnung: ABEND,
    von_at: new Date(jetzt + 6 * stunde).toISOString(),
    bis_at: new Date(jetzt + 8 * stunde).toISOString(),
    bedarf_kraefte: 60,
    bedarf_betreute: 90,
  });
}

/** Koppelt ein Verpflegungstablet (ohne Stelle), eigener Browserkontext, Uhr angehalten. */
async function verpflegungTablet(page: Page, browser: Browser) {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  await zeitfensterAnlegen(page, demo.id);
  const k = await fuelle<{ code: { code: string } }>(
    page,
    'post',
    `/api/einsaetze/${demo.id}/geraete`,
    { ansicht: 'verpflegung', bezeichnung: 'Tablet Ausgabe' },
  );
  const kontext = await browser.newContext({ viewport: KONTEXTE.tablet });
  const geraet = await kontext.newPage();
  await uhrAnhalten(geraet);
  await geraet.goto(`/koppeln#${k.code.code}`);
  await geraet.getByRole('button', { name: 'Gerät koppeln' }).click();
  await expect(geraet).toHaveURL(new RegExp(`/geraet/${demo.id}/verpflegung$`));
  const nav = geraet.getByRole('navigation', { name: 'Gerätenavigation' });
  await expect(nav.getByRole('link')).toHaveText(['Verpflegung', 'Melden']);
  const mittag = geraet.getByRole('article', { name: new RegExp(`^Zeitfenster ${MITTAG}`) });
  await expect(mittag).toBeVisible();
  return { kontext, geraet, mittag };
}

test.describe(KAPITEL, () => {
  test('Zeitfenster am Gerät', async ({ page, browser }) => {
    const { kontext, geraet } = await verpflegungTablet(page, browser);
    try {
      await expect(
        geraet.getByRole('article', { name: new RegExp(`^Zeitfenster ${ABEND}`) }),
      ).toBeVisible();
      // Planen gehört der Einsatzleitung.
      await expect(geraet.getByRole('button', { name: 'Zeitfenster anlegen' })).toHaveCount(0);
      await geraet.mouse.move(0, 0);
      await fotografiere(geraet, KAPITEL, 'zeitfenster');
    } finally {
      await kontext.close();
    }
  });

  test('Ausgabe nachtragen und zurücknehmen', async ({ page, browser }) => {
    const { kontext, geraet, mittag } = await verpflegungTablet(page, browser);
    try {
      await mittag.getByRole('button', { name: /^Ausgabe nachtragen zu / }).click();
      const dialog = geraet.getByRole('dialog', { name: `Ausgabe nachtragen: ${MITTAG}` });
      await dialog.getByLabel('Menge (EP)').fill('40');
      // An der Stelle statt an einem Ort („Zuführungsziel“ steht nur ohne Stelle).
      await dialog.getByRole('combobox', { name: 'Stelle' }).click();
      await geraet
        .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
        .locator(`.ant-select-item-option[title="${STELLE}"]`)
        .click();
      await expect(dialog.getByLabel('Zuführungsziel')).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Nachtragen', exact: true }).click();
      await expect(dialog).toHaveCount(0);

      // Nachgeklickt: eine Ausgabe zurücknehmen, mit Rückfrage.
      const zurueck = mittag.getByRole('button', { name: /^Zurücknehmen: Ausgabe 40 EP/ });
      await zurueck.click();
      const rueckfrage = geraet.getByRole('dialog', { name: 'Ausgabe zurücknehmen?' });
      await rueckfrage.getByRole('button', { name: 'Zurücknehmen' }).click();
      await expect(rueckfrage).toHaveCount(0);
      await expect(zurueck).toHaveCount(0);
    } finally {
      await kontext.close();
    }
  });

  test('Portionen zählen', async ({ page, browser }) => {
    const { kontext, geraet, mittag } = await verpflegungTablet(page, browser);
    try {
      await mittag.getByRole('link', { name: /^Ausgabe öffnen zu / }).click();
      await expect(geraet).toHaveURL(/\/geraet\/\d+\/verpflegung\/\d+\/ausgabe$/);
      await expect(geraet.getByRole('heading', { level: 1, name: MITTAG })).toBeVisible();
      // Die einzige zugeordnete Stelle ist vorgewählt, ihr Ist steht daneben.
      await expect(geraet.locator('[data-lfh="ausgabe-stelle"] .ant-select')).toContainText(STELLE);
      await expect(geraet.locator('[data-lfh="ausgabe-stelle-ist"]')).toHaveText(
        'an der Stelle 80 EP',
      );
      const plus1 = geraet.locator('[data-lfh="zaehltasten"]').getByRole('button', {
        name: '+1',
        exact: true,
      });
      // Ein ausstehender Eintrag: ohne Netz gezählt und gebucht.
      await kontext.setOffline(true);
      await expect(geraet.locator('[data-lfh="ausgabe-offline"]')).toHaveText('Offline vorgemerkt');
      for (let i = 0; i < 3; i++) await plus1.click();
      await geraet.getByRole('button', { name: 'Buchen', exact: true }).click();
      await expect(geraet.locator('[data-lfh="ausgabe-ausstehend"]')).toHaveText('+ 3 ausstehend');
      // Danach eine offene Sammlung an die Rettungsstaffel samt Sonderkost (LLH-1055).
      await geraet.getByRole('button', { name: `Empfänger wählen: ${STAFFEL}` }).click();
      await expect(geraet.locator('[data-lfh="ausgabe-empfaenger"]')).toContainText(STAFFEL);
      await geraet.getByRole('button', { name: /^vegetarisch/ }).click();
      await plus1.click();
      await expect(geraet.locator('[data-lfh="sammlung-menge"]')).toHaveText('2');
      // Nur der Inhalt: der Vormerk-Hinweis und die Leiste „Offline“ liegen über dem Kopf.
      const inhalt = geraet.locator('main');
      await inhalt.evaluate((m) => m.scrollTo(0, 0));
      await geraet.mouse.move(0, 0);
      await fotografiere(inhalt, KAPITEL, 'ausgabe-zaehlen');
    } finally {
      await kontext.close();
    }
  });

  test('Fehlmenge an die Einsatzleitung melden', async ({ page, browser }) => {
    const { kontext, geraet, mittag } = await verpflegungTablet(page, browser);
    try {
      await mittag.getByRole('button', { name: /^Fehlmenge melden zu / }).click();
      await expect(geraet).toHaveURL(/\/geraet\/\d+\/meldungen$/);
      await expect(geraet.getByLabel('Inhalt')).toHaveValue(/^Fehlmenge Verpflegung /);
      await geraet.getByLabel('Inhalt').blur();
      await geraet.mouse.move(0, 0);
      await fotografiere(geraet, KAPITEL, 'fehlmenge');
      await geraet.getByRole('button', { name: 'Meldung senden' }).click();
      await expect(geraet.getByText(/Meldung #\d+ gesendet/)).toBeVisible();
    } finally {
      await kontext.close();
    }
  });
});
