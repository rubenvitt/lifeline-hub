import type { APIRequestContext, Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { waehleIn } from '../auswahl-kern';
import {
  apiAlsAdmin,
  anmelden,
  demoEinsatz,
  expect,
  fotografiere,
  test,
  uhrAnhalten,
} from './kern';

/**
 * Bilder des Kapitels „Dokumente“ (`docs/anwender/kapitel/dokumente.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep dokumente`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   dokumente.png         frontend/src/pages/DokumentePage.tsx
 *   dokument-ablegen.png  frontend/src/dokumente/DokumentAblegenModal.tsx
 *
 * Füllung (D3): der Demo-Einsatz hat keine Dokumente. Ein Lageplan (PDF, Bezug auf den Abschnitt
 * Sanitätsdienst), ein Befehl (PDF) und ein Foto (PNG) werden über die API abgelegt, jeweils nur,
 * wenn es sie noch nicht gibt (ein Lauf aller Kapitel teilt eine Datenbank). Im Dialog wird nur
 * ausgefüllt, nicht abgelegt.
 */

const KAPITEL = 'dokumente';
const PDF = Buffer.from('%PDF-1.4 Lifeline Hub Doku\n%%EOF\n');

/** CRC-32 (PNG-Chunks), ohne Abhängigkeit von der Node-Version. */
function crc32(daten: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of daten) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Kleines PNG (Himmel über Wasser), damit die Liste ein Vorschaubild zeigt. */
function fotoPng(breite = 160, hoehe = 120): Buffer {
  const chunk = (typ: string, inhalt: Buffer) => {
    const kopf = Buffer.alloc(4);
    kopf.writeUInt32BE(inhalt.length);
    const typUndInhalt = Buffer.concat([Buffer.from(typ, 'ascii'), inhalt]);
    const pruef = Buffer.alloc(4);
    pruef.writeUInt32BE(crc32(typUndInhalt));
    return Buffer.concat([kopf, typUndInhalt, pruef]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr.writeUInt8(8, 8); // Bittiefe
  ihdr.writeUInt8(2, 9); // RGB
  const zeilen: Buffer[] = [];
  for (let y = 0; y < hoehe; y++) {
    const zeile = Buffer.alloc(1 + breite * 3);
    for (let x = 0; x < breite; x++) {
      const wasser = y > hoehe * 0.55;
      zeile[1 + x * 3] = wasser ? 70 : 150 + Math.round((60 * y) / hoehe);
      zeile[2 + x * 3] = wasser ? 95 : 180 + Math.round((40 * y) / hoehe);
      zeile[3 + x * 3] = wasser ? 110 : 215;
    }
    zeilen.push(zeile);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(zeilen))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Legt ein Dokument per Multipart ab, nur wenn es den Titel im Einsatz noch nicht gibt. */
async function ablegen(
  api: APIRequestContext,
  einsatzId: number,
  vorhanden: string[],
  felder: { titel: string; kategorie: string; dateiname: string; mime: string; inhalt: Buffer },
  bezug?: { typ: string; id: number },
): Promise<void> {
  if (vorhanden.includes(felder.titel)) return;
  const antwort = await api.post(`/api/einsaetze/${einsatzId}/dokumente`, {
    multipart: {
      datei: { name: felder.dateiname, mimeType: felder.mime, buffer: felder.inhalt },
      titel: felder.titel,
      kategorie: felder.kategorie,
      ...(bezug ? { bezug_typ: bezug.typ, bezug_id: String(bezug.id) } : {}),
    },
  });
  expect(antwort.ok(), `Ablage ${felder.titel}: ${antwort.status()} ${await antwort.text()}`).toBe(
    true,
  );
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
    const vorhanden = (
      (await (await api.get(`/api/einsaetze/${id}/dokumente`)).json()) as { titel: string }[]
    ).map((d) => d.titel);
    const abschnitte = (await (await api.get(`/api/einsaetze/${id}/abschnitte`)).json()) as {
      id: number;
      name: string;
    }[];
    const sanitaet = abschnitte.find((a) => a.name === 'Sanitätsdienst');
    expect(sanitaet, 'Demo-Abschnitt „Sanitätsdienst“').toBeDefined();
    await ablegen(
      api,
      id,
      vorhanden,
      {
        titel: 'Lageplan Ortsteil Nord',
        kategorie: 'lagekarte_plan',
        dateiname: 'Lageplan Ortsteil Nord.pdf',
        mime: 'application/pdf',
        inhalt: PDF,
      },
      { typ: 'abschnitt', id: sanitaet!.id },
    );
    await ablegen(api, id, vorhanden, {
      titel: 'Einsatzbefehl Deichverteidigung',
      kategorie: 'befehl',
      dateiname: 'Einsatzbefehl Deichverteidigung.pdf',
      mime: 'application/pdf',
      inhalt: PDF,
    });
    await ablegen(api, id, vorhanden, {
      titel: 'Mühlbach an der Brücke',
      kategorie: 'foto',
      dateiname: 'Mühlbach an der Brücke.png',
      mime: 'image/png',
      inhalt: fotoPng(),
    });
    await api.dispose();
  });

  test('Liste der Dokumente', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await benachrichtigungErlaubt(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/dokumente`);
    await expect(page.getByText('Lageplan Ortsteil Nord').first()).toBeVisible();
    // Das Vorschaubild lädt verzögert; ohne es stünde ein leerer Rahmen im Bild.
    const vorschau = page
      .locator('[data-lfh="anhang-vorschau"] img, [data-lfh="anhang-vorschau-bild"] img')
      .first();
    await expect
      .poll(() => vorschau.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0))
      .toBe(true);
    await fotografiere(page, KAPITEL, 'dokumente');
  });

  test('Dialog „Dokument ablegen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/dokumente`);
    await page.getByRole('button', { name: 'Dokument ablegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dokument ablegen' });
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'Meldevordruck Betreuungsstelle.pdf',
      mimeType: 'application/pdf',
      buffer: PDF,
    });
    await expect(dialog.getByLabel('Titel')).toHaveValue('Meldevordruck Betreuungsstelle');
    await waehleIn(dialog.getByRole('combobox', { name: 'Kategorie' }), 'Formular');
    await dialog.getByRole('combobox', { name: 'Kategorie' }).blur();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'dokument-ablegen');
  });
});
