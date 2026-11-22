import type { Page } from '@playwright/test';
import { anmelden, expect, fotografiere, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Anbindungen“ (`docs/anwender/kapitel/anbindungen.md`), Abschnitt Adapter.
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep anbindungen`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   adapter-liste.png       frontend/src/pages/einstellungen/AdapterPaneel.tsx
 *   adapter-pruefung.png    frontend/src/pages/einstellungen/AdapterAnsicht.tsx (Paneel
 *                           „Zustand“ mit Ergebnis von „Verbindung prüfen“)
 *   geheimnis-ersetzen.png  frontend/src/components/Geheimfeld.tsx im Paneel „Geheimnisse“ der
 *                           Ansicht
 *
 * HERMETISCH: Noch kennt kein Server eine Adapterart (`Verzeichnis::produktiv()` ist leer, die
 * erste kommt mit Divera, LLH-1193). Liste, Verlauf und Prüfung kommen deshalb per `page.route`
 * aus Literalen in der Wire-Form von `api/types.generated.ts`, mit der erfundenen Art
 * „Beispiel-Alarmquelle“ (abgestimmt am 22.11.2026, LLH-2018). Die Zeiten hängen an der
 * angehaltenen Uhr.
 */

const KAPITEL = 'anbindungen';
const MIN = 60_000;

/** Zeit im Wire-Format des Servers: UTC ohne Zone (`YYYY-MM-DD HH:MM:SS`). */
function wire(jetzt: Date, minutenVorher: number): string {
  return new Date(jetzt.getTime() - minutenVorher * MIN)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

const ART = {
  code: 'beispiel',
  bezeichnung: 'Beispiel-Alarmquelle',
  felder: [
    { name: 'url', bezeichnung: 'Adresse', typ: 'url', pflicht: true, max: 512 },
    { name: 'standort', bezeichnung: 'Standort-Kennung', typ: 'text', pflicht: false, max: 40 },
  ],
  plaetze: [
    { name: 'token', bezeichnung: 'API-Schlüssel', pflicht: true },
    { name: 'kennwort', bezeichnung: 'Kennwort des Abrufkontos', pflicht: false },
  ],
  intervall_min_s: 30,
  intervall_vorschlag_s: 60,
};

function adapter(jetzt: Date) {
  const basis = {
    art: 'beispiel',
    art_bezeichnung: 'Beispiel-Alarmquelle',
    intervall_s: 60,
    lan_erlaubt: false,
    fehlversuche: 0,
    angelegt_at: wire(jetzt, 60 * 24),
    geaendert_at: wire(jetzt, 60 * 20),
    geheimnisse: [
      {
        name: 'token',
        bezeichnung: 'API-Schlüssel',
        pflicht: true,
        is_gesetzt: true,
        gesetzt_at: wire(jetzt, 60 * 20),
        gesetzt_von_name: 'Admin',
        is_unlesbar: false,
      },
      {
        name: 'kennwort',
        bezeichnung: 'Kennwort des Abrufkontos',
        pflicht: false,
        is_gesetzt: false,
        is_unlesbar: false,
      },
    ],
  };
  return [
    {
      ...basis,
      id: 'a1',
      name: 'Alarmquelle Leitstelle',
      einstellungen: { url: 'https://alarm.leitstelle.example/api', standort: 'WA-01' },
      zustand: 'gestoert',
      fehler_seit: wire(jetzt, 14),
      fehlversuche: 3,
      letzter_fehler: { at: wire(jetzt, 5), art: 'zeitueberschreitung' },
      letzter_erfolg_at: wire(jetzt, 19),
      letzte_anzahl: 4,
      naechster_abruf_at: wire(jetzt, -3),
    },
    {
      ...basis,
      id: 'a2',
      name: 'Stammdaten Hilfsorganisation',
      einstellungen: { url: 'https://stamm.example/api' },
      zustand: 'braucht_eingriff',
      angehalten_grund: 'abgelehnt',
      angehalten_at: wire(jetzt, 60 * 10),
      letzter_fehler: { at: wire(jetzt, 60 * 10), art: 'abgelehnt', status: 401 },
      letzter_erfolg_at: wire(jetzt, 60 * 11),
      letzte_anzahl: 112,
    },
    {
      ...basis,
      id: 'a3',
      name: 'Probeabruf Übung',
      einstellungen: { url: 'https://uebung.example/api' },
      zustand: 'aus',
      angehalten_at: wire(jetzt, 60 * 2),
    },
  ];
}

async function stelle(page: Page, jetzt: Date) {
  await page.route('**/api/admin/adapter', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            adapter: adapter(jetzt),
            arten: [ART],
            speicher: 'bereit',
            speicher_fingerabdruck: '7f3a9c21e04b5d86',
          },
        })
      : route.continue(),
  );
  await page.route('**/api/admin/adapter/a1/versuche', (route) =>
    route.fulfill({
      json: [
        {
          at: wire(jetzt, 5),
          probe: false,
          erfolg: false,
          fehler_art: 'zeitueberschreitung',
          dauer_ms: 20000,
        },
        {
          at: wire(jetzt, 9),
          probe: false,
          erfolg: false,
          fehler_art: 'zeitueberschreitung',
          dauer_ms: 20000,
        },
        {
          at: wire(jetzt, 14),
          probe: false,
          erfolg: false,
          fehler_art: 'verbindung',
          dauer_ms: 5003,
        },
        { at: wire(jetzt, 19), probe: false, erfolg: true, status: 200, dauer_ms: 388, anzahl: 4 },
      ],
    }),
  );
  await page.route('**/api/admin/adapter/a1/pruefen', (route) =>
    route.fulfill({ json: { erfolg: true, status: 200, dauer_ms: 412, anzahl: 4 } }),
  );
}

async function vorbereiten(page: Page): Promise<void> {
  await anmelden(page);
  const jetzt = await uhrAnhalten(page);
  await stelle(page, jetzt);
}

test.describe('anbindungen', () => {
  test('Paneel „Adapter“', async ({ page }) => {
    await vorbereiten(page);
    await page.goto('/admin/einstellungen/anbindungen');
    const paneel = page.getByRole('region', { name: 'Adapter', exact: true });
    await expect(paneel.getByRole('link', { name: 'Alarmquelle Leitstelle' })).toBeVisible();
    await fotografiere(paneel, KAPITEL, 'adapter-liste');
  });

  test('Ansicht mit Prüfergebnis', async ({ page }) => {
    await vorbereiten(page);
    await page.goto('/admin/einstellungen/anbindungen/adapter/a1');
    await page.getByRole('button', { name: 'Verbindung prüfen' }).click();
    await expect(page.locator('[data-lfh="adapter-pruefung"]')).toBeVisible();
    await expect(page.locator('[data-lfh="adapter-versuch"]').first()).toBeVisible();
    await fotografiere(
      page.getByRole('region', { name: 'Zustand', exact: true }),
      KAPITEL,
      'adapter-pruefung',
    );
  });

  test('Geheimnis ersetzen', async ({ page }) => {
    await vorbereiten(page);
    await page.goto('/admin/einstellungen/anbindungen/adapter/a1');
    const paneel = page.getByRole('region', { name: 'Geheimnisse' });
    await paneel.getByRole('button', { name: 'Ersetzen' }).click();
    await expect(paneel.getByLabel('Neuer Wert für API-Schlüssel')).toBeFocused();
    await fotografiere(paneel, KAPITEL, 'geheimnis-ersetzen');
  });
});
