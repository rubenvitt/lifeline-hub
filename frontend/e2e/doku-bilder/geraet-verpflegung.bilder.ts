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
 * dazu eine erste Ausgabe (D3).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep geraet-verpflegung`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   zeitfenster.png        frontend/src/pages/VerpflegungPage.tsx, frontend/src/verpflegung/ZeitfensterKarte.tsx
 *   ausgabe-erfassen.png   frontend/src/verpflegung/VerpflegungDialoge.tsx (Dialog „Ausgabe erfassen“)
 *   fehlmenge.png          frontend/src/geraet/GeraetMeldungenPage.tsx (vorbefüllt aus der Verpflegung)
 */

const KAPITEL = 'geraet-verpflegung';
const MITTAG = 'Mittagessen';
const ABEND = 'Abendessen';

/** Zwei Zeitfenster (eines läuft, eines steht an) und eine Ausgabe, einmal je Lauf. */
async function zeitfensterAnlegen(page: Page, einsatz: number) {
  const basis = `/api/einsaetze/${einsatz}/verpflegung`;
  const stand = (await (await page.request.get(basis)).json()) as {
    zeitfenster: { bezeichnung: string }[];
  };
  if (stand.zeitfenster.some((z) => z.bezeichnung === MITTAG)) return;
  const stunde = 3_600_000;
  const jetzt = Date.now();
  const mittag = await fuelle<{ id: number }>(page, 'post', `${basis}/zeitfenster`, {
    bezeichnung: MITTAG,
    von_at: new Date(jetzt - stunde).toISOString(),
    bis_at: new Date(jetzt + 2 * stunde).toISOString(),
    bedarf_kraefte: 60,
    bedarf_betreute: 90,
    sonderkost: { vegetarisch: 12 },
  });
  await fuelle(page, 'post', `${basis}/zeitfenster/${mittag.id}/ausgaben`, {
    menge: 80,
    ort: 'Gesamtschule, Mensa',
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

  test('Ausgabe erfassen und zurücknehmen', async ({ page, browser }) => {
    const { kontext, geraet, mittag } = await verpflegungTablet(page, browser);
    try {
      await mittag.getByRole('button', { name: /^Ausgabe erfassen zu / }).click();
      const dialog = geraet.getByRole('dialog', { name: `Ausgabe erfassen: ${MITTAG}` });
      await dialog.getByLabel('Menge (EP)').fill('40');
      await dialog.getByLabel('Ort').fill('Gesamtschule, Aula');
      await dialog.getByLabel('Ort').blur();
      // Erst nach der Einblendung: mitten im Zoom wäre der Dialog im Bild noch verkleinert.
      await expect(dialog).not.toHaveClass(/ant-zoom-appear/);
      await fotografiere(dialog, KAPITEL, 'ausgabe-erfassen');
      await dialog.getByRole('button', { name: 'Erfassen', exact: true }).click();
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
