import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { LagebildExtern } from '../api/types';
import LagebildExternPage, { linkUngueltig, mitKarte } from './LagebildExternPage';
import { ApiError } from '../api/client';

// jsdom hat kein WebGL: die Karte selbst zeigt das Bild im PR.
vi.mock('../geraet/LagemonitorKarte', async (original) => ({
  ...(await original<typeof import('../geraet/LagemonitorKarte')>()),
  default: () => <div data-lfh="lagemonitor-karte" />,
}));

/** Seite des Lagebilds für Externe (LLH-1496, Spec `lagebild-extern`, design.md D9). */

const KARTE = { type: 'FeatureCollection', features: [] };

function antwort(extra: Partial<LagebildExtern> = {}): LagebildExtern {
  return {
    api_version: 1,
    stand_at: '2026-11-11 10:00:00',
    stufe: 'lagebild',
    empfaenger: 'Krisenstab Kreis',
    gueltig_bis: '2026-11-12 10:00:00',
    quelle: { spiegel: false, abgleich_beendet: false },
    einsatz: {
      bezeichnung: 'Hochwasser Ilmenau',
      stichwort: 'TH Wasser',
      einsatzart: 'realeinsatz',
      begonnen_at: '2026-11-11 08:00:00',
      betroffene_gesamt: 12,
      betroffene: {
        gesamt: 12,
        patienten: 5,
        sk1: 1,
        sk2: 2,
        sk3: 1,
        sk4: 1,
        tot: 0,
        unverletzt: 4,
        ohne: 3,
        vermisst: 2,
        abgeschlossen: 0,
      },
      einsatzkraefte_gesamt: 38,
      kraefte: {
        einheiten: 4,
        personal: 38,
        staerke: { fuehrer: 2, unterfuehrer: 6, mannschaft: 30 },
      },
      uhs: [
        {
          id: 2,
          bezeichnung: 'UHS Nord',
          typ: 'behandlungsplatz',
          status: 'aktiv',
          belegt: 3,
          plaetze: 8,
          kraefte: 4,
        },
      ],
      lagemeldung: { text: 'Pegel steigt, Deich hält.', freigegeben_at: '2026-11-11 09:30:00' },
    },
    nicht_uebertragen: [],
    karte: KARTE,
    karte_etag: 'abcdef0123456789',
    ...extra,
  } as LagebildExtern;
}

function bereit(...antworten: (LagebildExtern | number)[]) {
  const anfragen: { auth: string | null; oeffnung: string | null; uri: string }[] = [];
  server.use(
    http.get('/api/extern/v1/lagebild', ({ request }) => {
      anfragen.push({
        auth: request.headers.get('authorization'),
        oeffnung: request.headers.get('x-lagebild-oeffnung'),
        uri: request.url,
      });
      const a = antworten[Math.min(anfragen.length - 1, antworten.length - 1)];
      return typeof a === 'number'
        ? HttpResponse.json({ error: 'Nicht angemeldet' }, { status: a })
        : HttpResponse.json(a);
    }),
  );
  return anfragen;
}

function oeffne(hash: string) {
  window.history.replaceState(null, '', `/extern${hash}`);
  return renderMitProviders(<LagebildExternPage />, { route: '/extern' });
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('LagebildExternPage', () => {
  it('ruft mit dem Schlüssel aus dem Fragment ab und zeigt Zahlen, Karte und Lagemeldung', async () => {
    const anfragen = bereit(antwort());
    oeffne('#llh_lb_GEHEIM');
    expect(await screen.findByText('Hochwasser Ilmenau')).toBeInTheDocument();
    expect(anfragen[0].auth).toBe('Bearer llh_lb_GEHEIM');
    expect(anfragen[0].oeffnung).toMatch(/\S{8,}/);
    expect(new URL(anfragen[0].uri).search).toBe('');
    expect(screen.getByText(/für Krisenstab Kreis/)).toBeInTheDocument();
    // Datum und Uhrzeit statt DTG, auch wenn die Instanz taktisch zeigt.
    expect(document.querySelector('[data-lfh="extern-stand"]')).toHaveTextContent(
      /Stand (\d{2}\.\d{2}\. )?\d{2}:\d{2}/,
    );
    expect(screen.getByRole('group', { name: 'Betroffene nach Sichtung' })).toBeInTheDocument();
    expect(screen.getByText('UHS Nord')).toBeInTheDocument();
    expect(screen.getByText('Pegel steigt, Deich hält.')).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="lagemonitor-karte"]')).not.toBeNull();
    // Der Schlüssel bleibt in der Adresse: Neuladen und Lesezeichen gehen.
    expect(window.location.hash).toBe('#llh_lb_GEHEIM');
  });

  it('zeigt in der Stufe öffentlich nur die Gesamtzahlen', async () => {
    const e = antwort().einsatz;
    bereit(
      antwort({
        stufe: 'oeffentlich',
        einsatz: {
          bezeichnung: e.bezeichnung,
          einsatzart: e.einsatzart,
          begonnen_at: e.begonnen_at,
          betroffene_gesamt: 12,
          einsatzkraefte_gesamt: 38,
        },
      }),
    );
    oeffne('#llh_lb_PRESSE');
    expect(await screen.findByText('Hochwasser Ilmenau')).toBeInTheDocument();
    const band = screen.getByRole('group', { name: 'Kennzahlen' });
    expect(band).toHaveTextContent('12');
    expect(band).toHaveTextContent('38');
    expect(screen.queryByRole('group', { name: 'Betroffene nach Sichtung' })).toBeNull();
    expect(screen.queryByText(/nicht übertragen/)).toBeNull();
  });

  it('nennt, was die führende Stelle nicht überträgt, und den Abgleich', async () => {
    bereit(
      antwort({
        nicht_uebertragen: ['kraefte', 'karte'],
        karte: undefined,
        karte_etag: undefined,
        quelle: {
          spiegel: true,
          abgleich_beendet: false,
          letzter_abgleich_at: '2020-01-01 00:00:00',
        },
      }),
    );
    oeffne('#llh_lb_X');
    expect(await screen.findByText('Kräfte: nicht übertragen')).toBeInTheDocument();
    expect(screen.getByText('Karte: nicht übertragen')).toBeInTheDocument();
    const abgleich = document.querySelector('[data-lfh="extern-abgleich"]');
    expect(abgleich).toHaveAttribute('data-gestoert', 'ja');
    expect(abgleich).toHaveTextContent(/keine Verbindung seit/);
  });

  it('hält bei 401 an und sagt, dass der Link nicht mehr gilt', async () => {
    const anfragen = bereit(401);
    oeffne('#llh_lb_ALT');
    expect(await screen.findByText('Dieser Link gilt nicht mehr.')).toBeInTheDocument();
    expect(anfragen).toHaveLength(1);
  });

  it('ohne Schlüssel fragt sie nicht', async () => {
    const anfragen = bereit(antwort());
    oeffne('');
    expect(await screen.findByText('Dieser Link gilt nicht mehr.')).toBeInTheDocument();
    await waitFor(() => expect(anfragen).toHaveLength(0));
  });
});

describe('mitKarte', () => {
  it('behält die Karte, solange die Fassung gleich ist', () => {
    const alt = antwort();
    const neu = antwort({ karte: undefined });
    expect(mitKarte(neu, alt).karte).toBe(alt.karte);
    expect(
      mitKarte(antwort({ karte: undefined, karte_etag: 'anders' }), alt).karte,
    ).toBeUndefined();
    expect(mitKarte(neu, undefined).karte).toBeUndefined();
  });

  it('erkennt den ungültigen Link nur an 401', () => {
    expect(linkUngueltig(new ApiError(401, 'x'))).toBe(true);
    expect(linkUngueltig(new ApiError(429, 'x'))).toBe(false);
    expect(linkUngueltig(new Error('x'))).toBe(false);
  });
});
