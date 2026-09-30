import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { BenutzerAnzeige, FuehrungsfunktionEintrag } from '../api/types';
import FuehrungsfunktionenTab, { verwaltungsZeilen } from './FuehrungsfunktionenTab';

function eintrag(
  funktion: FuehrungsfunktionEintrag['funktion'],
  label: string,
  standard = label,
): FuehrungsfunktionEintrag {
  return {
    funktion,
    kuerzel: funktion.toUpperCase(),
    label,
    standard_label: standard,
    art: 'sachgebiet',
    bezeichnung_pflicht: false,
  };
}

function benutzer(systemRolle: 'admin' | 'keiner'): BenutzerAnzeige {
  return {
    id: 1,
    anzeigename: 'Ada',
    benutzername: 'ada',
    system_rolle: systemRolle,
    org_rolle: 'keine',
    org_id: 1,
    aktiv: true,
  } as unknown as BenutzerAnzeige;
}

describe('verwaltungsZeilen', () => {
  it('setzt das ausgeschaltete S7 hinter S6', () => {
    const zeilen = verwaltungsZeilen([eintrag('s5', 'Presse'), eintrag('s6', 'IuK')]);
    expect(zeilen.map((z) => [z.eintrag.funktion, z.aktiv])).toEqual([
      ['s5', true],
      ['s6', true],
      ['s7', false],
    ]);
  });
});

describe('FuehrungsfunktionenTab', () => {
  it('setzt das THW-Label und leert es wieder auf den Standard', async () => {
    let katalog = [eintrag('s4', 'Versorgung')];
    const gesendet: unknown[] = [];
    server.use(
      meHandler(benutzer('admin')),
      http.get('/api/fuehrungsfunktionen', () => HttpResponse.json(katalog)),
      http.put('/api/org-fuehrungsfunktionen/s4', async ({ request }) => {
        const body = (await request.json()) as { label: string | null };
        gesendet.push(body);
        katalog = [eintrag('s4', body.label ?? 'Versorgung', 'Versorgung')];
        return HttpResponse.json(katalog);
      }),
    );
    renderMitProviders(<FuehrungsfunktionenTab />);

    await userEvent.click(await screen.findByRole('button', { name: 'Bezeichnung S4 bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Bezeichnung S4' });
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Versorgung (Logistik){Enter}');
    expect(
      await screen.findByText('Versorgung (Logistik) (Standard: Versorgung)'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Bezeichnung S4 bearbeiten' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Bezeichnung S4' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Bezeichnung S4' }), '{Enter}');
    await waitFor(() => expect(gesendet).toHaveLength(2));
    expect(gesendet).toEqual([{ label: 'Versorgung (Logistik)' }, { label: null }]);
  });

  it('schaltet S7 ein', async () => {
    const gesendet: unknown[] = [];
    server.use(
      meHandler(benutzer('admin')),
      http.get('/api/fuehrungsfunktionen', () => HttpResponse.json([eintrag('s6', 'IuK')])),
      http.put('/api/org-fuehrungsfunktionen/s7', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json([
          eintrag('s6', 'IuK'),
          eintrag('s7', 'Psychosoziale Notfallversorgung'),
        ]);
      }),
    );
    renderMitProviders(<FuehrungsfunktionenTab />);

    const schalter = await screen.findByRole('switch', { name: 'S7 PSNV eingeschaltet' });
    expect(schalter).not.toBeChecked();
    await userEvent.click(schalter);
    await waitFor(() => expect(gesendet).toEqual([{ aktiv: true }]));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'S7 PSNV eingeschaltet' })).toBeChecked(),
    );
  });

  it('erklärt ohne Adminrecht die Sperre und lässt nichts bearbeiten', async () => {
    server.use(
      meHandler(benutzer('keiner')),
      http.get('/api/fuehrungsfunktionen', () => HttpResponse.json([eintrag('s4', 'Versorgung')])),
    );
    renderMitProviders(<FuehrungsfunktionenTab />);
    expect(await screen.findByText(/Nur Benutzer mit der Systemrolle/)).toBeInTheDocument();
    expect(await screen.findByText('Versorgung')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bezeichnung S4 bearbeiten' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'S7 PSNV eingeschaltet' })).toBeDisabled();
  });
});
