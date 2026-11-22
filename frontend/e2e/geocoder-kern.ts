import { expect, type APIRequestContext } from '@playwright/test';

/**
 * Geocoder der Organisation in e2e-Suite und Bildlauf (LLH-2063).
 *
 * Port 9 (discard) auf Loopback: niemand antwortet, die Verbindung wird sofort verweigert. Beide
 * globalen Vorbereitungen lenken den Geocoder hierher, damit kein Lauf eine Koordinate oder einen
 * Suchtext an den öffentlichen Nominatim schickt (`NOMINATIM_DEFAULT`, `src/geocoding/mod.rs`)
 * und die Ort-Vorschau nie einen Ortsnamen trägt, der vom Netz des Laufs abhängt.
 */
export const GEOCODER_LOOPBACK = 'http://127.0.0.1:9';

export type OrgEinstellungen = Record<string, unknown>;

/**
 * Setzt die Geocoder-URL der Organisation und liefert die vorherigen Einstellungen. Der PUT ist ein
 * Vollersatz (`org::einstellungen::speichern`), also gehen alle Felder mit (`writeOrgEinstellungen`).
 */
export async function setGeocoderUrl(
  request: APIRequestContext,
  url: string | null,
): Promise<OrgEinstellungen> {
  const alt = await request.get('/api/org-einstellungen');
  expect(alt.ok(), await alt.text()).toBeTruthy();
  const vorher = (await alt.json()) as OrgEinstellungen;
  await writeOrgEinstellungen(request, { ...vorher, geocoder_url: url });
  return vorher;
}

/**
 * Schreibt die Org-Einstellungen zurück, wie `GET /api/org-einstellungen` sie liefert:
 * `auto_etb_eintraege` liest sich als Zahl und schreibt sich als Wahrheitswert, die
 * Kategorie-Vorgaben bleiben weg (fehlend = unverändert).
 */
export async function writeOrgEinstellungen(request: APIRequestContext, e: OrgEinstellungen) {
  const body: OrgEinstellungen = { ...e };
  for (const feld of ['org_id', 'aufbewahrung_kategorien', 'geaendert_at', 'geaendert_von']) {
    delete body[feld];
  }
  body.auto_etb_eintraege = e.auto_etb_eintraege == null ? null : e.auto_etb_eintraege !== 0;
  const antwort = await request.put('/api/org-einstellungen', { data: body });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
}
