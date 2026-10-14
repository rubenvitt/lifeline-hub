import { expect, test, type Page } from '@playwright/test';
import type { DatentraegerStatus } from '../src/api/types';
import { anmeldenAlsAdmin } from './rollen-kern';
import { beobachteShifts, bericht, ruheShifts } from './cls-kern';

/**
 * Kriterium 12 der Prüfliste Einsatztauglichkeit („Kein Sprung unter dem Cursor") an den
 * Stammdaten-Listen mit der Warnleiste der Datenträgerprüfung (LLH-1229).
 *
 * Die Leiste steht über dem Seiteninhalt und kam früher erst nach dem Seitentitel: bei 390 px
 * schob sie die ganze Liste um ihre Höhe nach unten (gemessen CLS 0,11 bis 0,20). Seither
 * zeigt die Verwaltung den Inhalt erst mit dem ersten Befund.
 *
 * `page.route` STATT ECHTER PRÜFUNG: ob die Temp-DB des Laufs als unverschlüsselt gilt, hängt am
 * Rechner. Die Antwort kommt deshalb fest und hinter einem Tor, das erst aufgeht, wenn die
 * Navigation der Verwaltung steht. So ist die Reihenfolge „Seite steht, dann Befund" kein
 * Wettrennen mehr, sondern der Fall, den der Test misst: ohne Wartezeit stand der Seitentitel
 * zusammen mit der Navigation, und der Befund schob ihn danach.
 */

/** Der „gut"-Schwellwert für CLS (https://web.dev/articles/cls), als Literal. */
const CLS_GUT = 0.1;

const HANDY = { width: 390, height: 844 };

const LAUF = Date.now();

const UNVERSCHLUESSELT: DatentraegerStatus = {
  gesamt: 'unverschluesselt',
  warnung: true,
  extern_zugesichert: false,
  geprueft_um: '2026-10-13 12:00:00',
  orte: [
    { art: 'datenbank', pfad: '/var/lib/lifeline-hub/lifeline.db', wert: 'unverschluesselt' },
    { art: 'sicherung', pfad: '/var/lib/lifeline-hub/sicherungen', wert: 'unverschluesselt' },
  ],
};

interface Liste {
  name: string;
  pfad: string;
  /** Sät eine Zeile und gibt ihren Text zurück; auf sie wartet der Test. */
  saeen: (page: Page) => Promise<string>;
}

async function saeen(page: Page, pfad: string, daten: object): Promise<void> {
  const antwort = await page.request.post(pfad, { data: daten });
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
}

// Die beiden Listen, an denen die Prüfliste den Sprung gemessen hat.
const LISTEN: Liste[] = [
  {
    name: 'Fahrzeuge',
    pfad: '/admin/stammdaten/fahrzeuge',
    saeen: async (page) => {
      const kennung = `Florian CLS 1/${LAUF}`;
      await saeen(page, '/api/fahrzeuge', { funkrufname: kennung, fahrzeugtyp: 'HLF 20' });
      return kennung;
    },
  },
  {
    name: 'Einheitstypen',
    pfad: '/admin/stammdaten/einheit-typen',
    saeen: async (page) => {
      const label = `Typ CLS ${LAUF}`;
      await saeen(page, '/api/einheit-typen', { label, sortier: 990 });
      return label;
    },
  },
];

for (const liste of LISTEN) {
  test(`${liste.name} bei 390 px: die Warnleiste „Datenträger unverschlüsselt" verschiebt nichts`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(HANDY);
    await beobachteShifts(page);
    await anmeldenAlsAdmin(page);
    const zeile = await liste.saeen(page);

    let oeffne!: () => void;
    const tor = new Promise<void>((fertig) => {
      oeffne = fertig;
    });
    let angefragt = false;
    await page.route('**/api/system/datentraeger', async (route) => {
      angefragt = true;
      await tor;
      await route.fulfill({ json: UNVERSCHLUESSELT });
    });

    // Eigene Navigation nach dem Login: der Shift-Akkumulator lebt je Dokument.
    await page.goto(liste.pfad);
    await expect(page.getByRole('button', { name: `Verwaltung: ${liste.name}` })).toBeVisible();
    await expect.poll(() => angefragt, { message: 'die Prüfung muss angefragt sein' }).toBe(true);
    oeffne();

    const leiste = page.locator('[data-lfh="datentraeger-warnung"]');
    await expect(leiste).toContainText('Datenträger unverschlüsselt');
    await expect(page.locator('tr.ant-table-row').filter({ hasText: zeile })).toHaveCount(1);
    // Die Leiste steht über der Liste, nicht darunter: sonst wäre der Test grün, weil sie
    // nichts mehr zu schieben hätte.
    const leisteKasten = await leiste.boundingBox();
    const tabelleKasten = await page.locator('.ant-table').first().boundingBox();
    expect(leisteKasten && tabelleKasten, 'Leiste und Tabelle müssen messbar sein').toBeTruthy();
    expect(leisteKasten!.y).toBeLessThan(tabelleKasten!.y);

    const messung = await ruheShifts(page);
    test.info().annotations.push({ type: 'messwert', description: bericht(messung) });
    expect(messung.summe, `${liste.name} gegen web.dev: ${bericht(messung)}`).toBeLessThanOrEqual(
      CLS_GUT,
    );
  });
}
