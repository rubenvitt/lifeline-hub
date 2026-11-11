import type {
  LagebildDauer,
  LagebildExtern,
  LagebildFreigabeAnzeige,
  LagebildFreigabeMitSchluessel,
  LagebildStufe,
} from './types';
import { ApiError, apiGet, apiSend, NetzFehler } from './client';
import { merkeServerzeit } from '../offline/serveruhr';

// Lagebild für Externe (LLH-1496, Spec `lagebild-extern`): Links der Einsatzleitung je Empfänger
// und der Abruf der Seite `/extern` mit dem Schlüssel aus dem Link.

export function ladeLagebildFreigaben(einsatzId: number): Promise<LagebildFreigabeAnzeige[]> {
  return apiGet<LagebildFreigabeAnzeige[]>(`/api/einsaetze/${einsatzId}/lagebild-freigaben`);
}

export interface NeueLagebildFreigabe {
  empfaenger: string;
  stufe: LagebildStufe;
  dauer: LagebildDauer;
}

/** Legt einen Link an; der Schlüssel steht nur in dieser Antwort. */
export function legeLagebildFreigabeAn(
  einsatzId: number,
  werte: NeueLagebildFreigabe,
): Promise<LagebildFreigabeMitSchluessel> {
  return apiSend<LagebildFreigabeMitSchluessel>(
    `/api/einsaetze/${einsatzId}/lagebild-freigaben`,
    'POST',
    werte,
  );
}

/** Der Link gilt sofort nicht mehr; Antwort ist die ganze Liste. */
export function widerrufeLagebildFreigabe(
  einsatzId: number,
  freigabeId: number,
): Promise<LagebildFreigabeAnzeige[]> {
  return apiSend<LagebildFreigabeAnzeige[]>(
    `/api/einsaetze/${einsatzId}/lagebild-freigaben/${freigabeId}/widerrufen`,
    'POST',
  );
}

/** Kopf, mit dem die Seite ihre Öffnung nennt (Protokoll, design.md D6). */
export const OEFFNUNG_KOPF = 'x-lagebild-oeffnung';

/**
 * Abruf der Seite `/extern`. Ohne Cookie (`credentials: 'omit'`): der Link gilt für sich, auch in
 * einem Browser, in dem jemand angemeldet ist. `karteEtag` ist die Fassung der Karte, die die
 * Seite schon hat; dann fehlt `karte` in der Antwort. Ein ungültiger Link ist 401.
 */
export async function ladeLagebildExtern(
  schluessel: string,
  oeffnung: string,
  karteEtag?: string,
): Promise<LagebildExtern> {
  const pfad = karteEtag
    ? `/api/extern/v1/lagebild?karte=${encodeURIComponent(karteEtag)}`
    : '/api/extern/v1/lagebild';
  let res: Response;
  try {
    res = await fetch(pfad, {
      credentials: 'omit',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${schluessel}`, [OEFFNUNG_KOPF]: oeffnung },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new NetzFehler();
  }
  merkeServerzeit(res);
  if (!res.ok) {
    let message = `Serverfehler (${res.status})`;
    let vomAnwendungsserver = false;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === 'string') {
        message = body.error;
        vomAnwendungsserver = true;
      }
    } catch {
      // keine JSON-Antwort
    }
    throw new ApiError(res.status, message, { vomAnwendungsserver, ohneSitzung: true });
  }
  return (await res.json()) as LagebildExtern;
}
