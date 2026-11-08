import { expect, type Page } from '@playwright/test';

/**
 * Messzustand der Vorplanung (LLH-1595, Prüfliste LLH-1586 Kriterien 1, 2, 5, 12 und 13), geteilt
 * von `gate3-trefflaeche.spec.ts`, `fokus-verdeckung.spec.ts` und `planung-kontrast.spec.ts`.
 * Gesät per API (`page.request` teilt den Cookie-Jar des Admins): der Weg über die Oberfläche
 * steht in `planung.spec.ts`, hier zählt nur der vollste Stand.
 *
 * Der Stand trägt jede Ampelstufe einmal im Raster und in der Handy-Liste:
 *
 * | Posten (Abschnitt)  | Soll | Block       | Personen | Ampel                          |
 * |---------------------|------|-------------|----------|--------------------------------|
 * | RTW 1 (Nord)        | 2    | 08–12       | —        | `luecke` „2 offen“             |
 * | RTW 1 (Nord)        | 2    | 12–16       | —        | `luecke` (stößt an den ersten) |
 * | RTW 2 (Nord)        | 1    | 08–10       | Hanna    | `besetzt`                      |
 * | RTW 2 (Nord)        | 1    | 12–16       | Helmut   | `befund` „zu lange im Dienst“  |
 * | Fußtrupp (Süd)      | —    | 08–12       | —        | `ohne-soll`                    |
 *
 * „Höchstens im Dienst“ steht auf 3 h, deshalb trägt Helmuts 4-h-Block den Befund. Zwei Blöcke
 * an einem Posten stoßen aneinander (12:00), wie es „Schichten erzeugen“ hinterlässt; so steht der
 * engste Abstand im Raster und in der Liste mit im Messzustand.
 *
 * Die Planung liegt eine Woche voraus, an EINEM Tag: die Zeitspanne steht als Segmente („Ganze
 * Planung“, der Tag), und vorgewählt ist der Tag.
 */

export const POSTEN = [
  { bezeichnung: 'RTW 1', abschnitt: 'Nord', soll: 2 },
  { bezeichnung: 'RTW 2', abschnitt: 'Nord', soll: 1 },
  { bezeichnung: 'Fußtrupp', abschnitt: 'Süd', soll: null },
] as const;

export const HELFER = ['Hanna Messweg', 'Helmut Messweg'] as const;

/** Blöcke im Messzustand (Tabelle oben). */
export const BLOECKE_ANZAHL = 5;

/** Die vier Ampelstufen mit dem Wort, das jeder Block trägt (`ampelVon` im Schichtplan). */
export const AMPELN = {
  luecke: '2 offen',
  besetzt: 'besetzt',
  befund: 'zu lange im Dienst',
  'ohne-soll': 'unbesetzt',
} as const;

const zwei = (n: number) => String(n).padStart(2, '0');

/** Wire-Zeit des Servers (`YYYY-MM-DD HH:mm:ss`, UTC), wie `alsBackendZeit`. */
export function wireZeit(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${zwei(d.getUTCMonth() + 1)}-${zwei(d.getUTCDate())} ` +
    `${zwei(d.getUTCHours())}:${zwei(d.getUTCMinutes())}:00`
  );
}

/**
 * Der Tag der Planung als lokale Mitternacht, EINMAL je Saat gelesen: läse jeder Zeitpunkt die Uhr
 * neu, landeten Planung und Blöcke beim Lauf über Mitternacht auf verschiedenen Tagen.
 */
function planungsTag(tage: number): Date {
  const d = new Date(Date.now() + tage * 24 * 3_600_000);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Lokale Wanduhr `stunde:00` am Tag `tag` (Browser und Lauf teilen die Zeitzone). */
export function zeitpunktAm(tag: Date, stunde: number): Date {
  const d = new Date(tag);
  d.setHours(stunde, 0, 0, 0);
  return d;
}

async function send<T>(
  page: Page,
  methode: 'post' | 'patch',
  pfad: string,
  data: unknown,
): Promise<T> {
  const r = await page.request[methode](pfad, { data });
  expect(r.ok(), `${methode} ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

interface PlanungResponse {
  kopf: { id: number };
  posten: { id: number; bezeichnung: string }[];
  bloecke: { id: number; ampel?: string }[];
}

export interface SeededPlanung {
  id: number;
  bezeichnung: string;
  /** Der Tag der Planung, lokale Mitternacht. */
  tag: Date;
}

/** Legt die Planung im Messzustand an (Tabelle im Kopf). */
export async function seedPlanung(page: Page, bezeichnung: string): Promise<SeededPlanung> {
  const tag = planungsTag(7);
  const p = await send<PlanungResponse>(page, 'post', '/api/planungen', {
    bezeichnung,
    ort: 'Stadtpark Messweg',
    von: wireZeit(zeitpunktAm(tag, 6)),
    bis: wireZeit(zeitpunktAm(tag, 22)),
    max_dienst_minuten: 180,
  });
  const id = p.kopf.id;
  const postenIds: number[] = [];
  for (const posten of POSTEN) {
    const antwort = await send<PlanungResponse>(page, 'post', `/api/planungen/${id}/posten`, {
      bezeichnung: posten.bezeichnung,
      abschnitt: posten.abschnitt,
      art: 'einheit',
      schichtlaenge_minuten: 240,
      soll_anzahl: posten.soll,
    });
    postenIds.push(antwort.posten.find((x) => x.bezeichnung === posten.bezeichnung)!.id);
  }
  const helferIds: number[] = [];
  for (const name of HELFER) {
    const h = await send<{ id: number }>(page, 'post', `/api/planungen/${id}/helfer`, {
      name,
      organisation: 'DLRG',
    });
    helferIds.push(h.id);
  }
  const block = (posten: number, von: number, bis: number, helfer?: number) =>
    send<PlanungResponse>(page, 'post', `/api/planungen/${id}/bloecke`, {
      posten_id: postenIds[posten],
      von: wireZeit(zeitpunktAm(tag, von)),
      bis: wireZeit(zeitpunktAm(tag, bis)),
      ...(helfer != null ? { personen: [{ art: 'helfer', helfer_id: helferIds[helfer] }] } : {}),
    });
  await block(0, 8, 12);
  await block(0, 12, 16);
  await block(1, 8, 10, 0);
  await block(1, 12, 16, 1);
  await block(2, 8, 12);
  return { id, bezeichnung, tag };
}

/**
 * Eine Planung, die vor 80 Tagen endete: der Server löscht sie 90 Tage nach dem Ende, also in
 * zehn Tagen, und die Liste nennt den Tag („wird am … gelöscht“, ab 14 Tagen vorher).
 */
export async function seedAltePlanung(page: Page, bezeichnung: string): Promise<number> {
  const p = await send<PlanungResponse>(page, 'post', '/api/planungen', {
    bezeichnung,
    von: wireZeit(zeitpunktAm(planungsTag(-81), 8)),
    bis: wireZeit(zeitpunktAm(planungsTag(-80), 8)),
  });
  return p.kopf.id;
}

/** Wartet, bis die Planungsseite ihren Kopf trägt (Datenanker). */
export async function waitForPlanung(page: Page, bezeichnung: string) {
  await expect(page.getByRole('heading', { level: 1, name: bezeichnung })).toBeVisible();
  await expect(page.locator('[data-lfh="planung-kennzahlen"]')).toBeVisible();
}

/** Wartet, bis das Raster alle gesäten Blöcke trägt. */
export async function waitForRaster(page: Page) {
  await expect(page.locator('[data-lfh="schichtplan-block"]')).toHaveCount(BLOECKE_ANZAHL);
  for (const ampel of Object.keys(AMPELN)) {
    await expect(
      page.locator(`[data-lfh="schichtplan-block"][data-ampel="${ampel}"]`).first(),
      `Vorbedingung: ein Block mit Ampel „${ampel}“`,
    ).toBeVisible();
  }
}
