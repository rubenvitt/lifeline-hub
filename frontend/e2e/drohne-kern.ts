import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

/**
 * Drohnenquelle „Suchlage“ für e2e und Bildlauf (LLH-2122), ohne Suchlage.
 *
 * Echt sind die Anbindung (Adapter der Art `suchlage`, angehalten) und die Zuschaltung am Einsatz:
 * `PUT`/`DELETE …/drone/sources/{aid}` laufen über den Server, mit Rechteprüfung, Exklusivität und
 * ETB-Eintrag. Simuliert ist nur, was sonst aus Suchlage käme und im Arbeitsspeicher des Servers
 * läge (`drohne::Store`): Missionsname und Videokennung der Quellenliste, die Fachebene, das
 * Livebild und die Fotovorschau, per `page.route`. Ein echter Abruf geht hier nicht: der
 * Adapter-Client ruft nur `https` ab und nie Loopback (`src/adapter/ziel.rs`).
 *
 * Livebild: HLS mit VP9 in fMP4 aus `e2e/drohne-fixture/`, weil das Chromium von Playwright kein
 * H.264 abspielt. Erzeugt mit ffmpeg (synthetisches Wärmebild, 4 s, 10 fps):
 * `ffmpeg -f lavfi -i color=c=black:size=480x270:rate=10:duration=4 -vf "geq=…,format=yuv420p"
 *  -c:v libvpx-vp9 -b:v 150k -g 20 -an -f hls -hls_time 2 -hls_playlist_type vod
 *  -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 -hls_segment_filename seg%d.m4s index.m3u8`;
 * `foto.jpg` ist ein Standbild derselben Quelle.
 */

const FIXTURE = new URL('./drohne-fixture/', import.meta.url);

/** Missionsname, wie ihn Suchlage für den laufenden Einsatz meldet. */
export const DROHNEN_MISSION = 'Vermisstensuche Stadtwald';
/** Kennung des Videostroms in der Simulation. */
const VIDEO_KEY = 'v1';
/** Kennung des simulierten Fotos. */
const FOTO_KEY = 'f1';

const INHALT: Record<string, string> = {
  m3u8: 'application/vnd.apple.mpegurl',
  mp4: 'video/mp4',
  m4s: 'video/mp4',
};

/**
 * Legt eine Drohnenquelle der Art „suchlage“ an und hält sie an: angehalten ruft sie nicht ab, und
 * ohne Großbild-Zugang meldete sie sonst „braucht Eingriff“ an alle Admins.
 */
export async function drohnenquelleAnlegen(page: Page, name: string): Promise<string> {
  const angelegt = await page.request.post('/api/admin/adapter', {
    data: { art: 'suchlage', name, einstellungen: { basis_url: 'https://suchlage.example' } },
  });
  expect(angelegt.ok(), `Adapter: ${angelegt.status()} ${await angelegt.text()}`).toBe(true);
  const id = ((await angelegt.json()) as { id: string }).id;
  const angehalten = await page.request.post(`/api/admin/adapter/${id}/pause`);
  expect(angehalten.ok(), `Adapter anhalten: ${angehalten.status()}`).toBe(true);
  return id;
}

/** Ein Punkt `[lon, lat]` um `[dx, dy]` Meter neben `mitte`. */
function versetzt(mitte: [number, number], dx: number, dy: number): [number, number] {
  const [lon, lat] = mitte;
  const proGradLat = 111_320;
  const proGradLon = proGradLat * Math.cos((lat * Math.PI) / 180);
  return [lon + dx / proGradLon, lat + dy / proGradLat];
}

/** Aufnahmeort des simulierten Fotos zur Lage um `mitte`. */
export function drohnenFotoOrt(mitte: [number, number]): [number, number] {
  return versetzt(mitte, -180, -60);
}

/** Die Drohnenlage: Fluggerät, Flugspur, Suchgebiet und ein Wärmebildfoto um `mitte`. */
function drohnenFeatures(mitte: [number, number], jetzt: Date) {
  const spur = [
    [-420, -260],
    [-300, -120],
    [-180, -60],
    [-60, 40],
    [60, 90],
    [150, 160],
  ].map(([dx, dy]) => versetzt(mitte, dx, dy));
  const gebiet = [
    [-500, -320],
    [260, -320],
    [260, 260],
    [-500, 260],
    [-500, -320],
  ].map(([dx, dy]) => versetzt(mitte, dx, dy));
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [gebiet] },
        properties: { kind: 'element', label: 'Suchgebiet 1' },
      },
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: spur },
        properties: { kind: 'track' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: spur[spur.length - 1] },
        properties: {
          kind: 'aircraft',
          key: 'a1',
          label: 'Drohne 1',
          heading_deg: 35,
          airborne: true,
          battery_percent: 64,
        },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: drohnenFotoOrt(mitte) },
        properties: {
          kind: 'photo',
          key: FOTO_KEY,
          taken_at_ms: jetzt.getTime() - 4 * 60_000,
          lens: 'ir',
          heading_deg: 40,
        },
      },
    ],
  };
}

/**
 * Beantwortet, was sonst aus Suchlage käme, für den Einsatz `einsatzId`: Quellenliste (zugeschaltete
 * Quellen mit Mission und Video), Fachebene `…/map/drone` (nur mit Zuschaltung, sonst unverändert
 * vom Server), Livebild und Fotovorschau. Abrufzeit der Ebene ist die Uhr der Seite (im Bildlauf
 * angehalten), damit die Ebene nicht als veraltet gilt.
 */
export async function drohnenLageSimulieren(
  page: Page,
  einsatzId: number,
  mitte: [number, number],
) {
  let zugeschaltet = false;
  await page.route(`**/api/incidents/${einsatzId}/drone/sources`, async (route) => {
    const antwort = await route.fetch();
    const quellen = (await antwort.json()) as {
      connected: boolean;
      mission_name: string | null;
      video_keys: string[];
    }[];
    zugeschaltet = quellen.some((q) => q.connected);
    await route.fulfill({
      response: antwort,
      json: quellen.map((q) =>
        q.connected ? { ...q, mission_name: DROHNEN_MISSION, video_keys: [VIDEO_KEY] } : q,
      ),
    });
  });
  await page.route(`**/api/incidents/${einsatzId}/map/drone`, async (route) => {
    if (!zugeschaltet) return route.fallback();
    const jetzt = new Date(await page.evaluate(() => Date.now()));
    const zeit = jetzt.toISOString().replace(/\.\d{3}Z$/, 'Z');
    await route.fulfill({
      json: {
        quelle: 'drohne',
        status: 'ok',
        attribution: 'Drohnenbild',
        stand: zeit,
        abgerufen: zeit,
        features: drohnenFeatures(mitte, jetzt),
      },
    });
  });
  await page.route(
    new RegExp(`/api/incidents/${einsatzId}/drone/video/${VIDEO_KEY}/hls/([\\w.-]+)$`),
    (route) => {
      const datei = new URL(route.request().url()).pathname.split('/').pop()!;
      const endung = datei.split('.').pop()!;
      return route.fulfill({
        status: 200,
        contentType: INHALT[endung],
        headers: { 'cache-control': 'private, no-cache' },
        body: readFileSync(new URL(datei, FIXTURE)),
      });
    },
  );
  await page.route(`**/api/incidents/${einsatzId}/drone/photos/${FOTO_KEY}/thumb`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      body: readFileSync(new URL('foto.jpg', FIXTURE)),
    }),
  );
}
