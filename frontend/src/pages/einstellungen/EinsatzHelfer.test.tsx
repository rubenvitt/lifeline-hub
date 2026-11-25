import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import type { EinsatzAnzeige } from '../../api/types';
import EinsatzHelfer, { ORTUNG_AUS_TEXT } from './EinsatzHelfer';

/** Den Inhalt des QR-Codes kann jsdom nicht lesen: das Doppel legt ihn offen. */
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg data-testid="qr" data-value={value} />,
}));

/** Bereich „Helfer“ der Geräte-Sektion (Helfer-App, Spec „Oberfläche“). */

const EINSATZ = { id: 1, bezeichnung: 'Hochwasser Weser' } as EinsatzAnzeige;
const ZIEL = { kind: 'vehicle', id: 7, name: 'Rotkreuz 1/83-1' };

const helfer = (id: number, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  state,
  display_name: `Kraft ${id}`,
  created_at: '2026-11-25 08:00:00',
  expires_at: '2026-11-25 20:00:00',
  is_tracker: false,
  paused: false,
  person_requested: false,
  target: ZIEL,
  ...extra,
});

interface Aufbau {
  helpers?: unknown[];
  invitation?: unknown;
  /** Ortungsfreigabe der Übersicht; Vorgabe: Ortung an, Personen aus. */
  tracking_enabled?: boolean;
  person_tracking_allowed?: boolean;
  bestaetigen?: (body: Record<string, unknown>) => Response | undefined;
}

function stelleBereit(a: Aufbau = {}) {
  const aufrufe: { pfad: string; body: unknown }[] = [];
  server.use(
    http.get('/api/incidents/1/helpers', () =>
      HttpResponse.json({
        helpers: a.helpers ?? [],
        invitation: a.invitation ?? null,
        tracking_enabled: a.tracking_enabled ?? true,
        person_tracking_allowed: a.person_tracking_allowed ?? false,
      }),
    ),
    http.get('/api/incidents/1/units', () => HttpResponse.json([{ id: 4, name: 'Zug 1' }])),
    http.get('/api/incidents/1/vehicles', () =>
      HttpResponse.json([
        { id: 7, funkrufname: 'Rotkreuz 1/83-1', beendet_als: null },
        { id: 8, funkrufname: 'Rotkreuz 1/83-2', beendet_als: null },
      ]),
    ),
    http.get('/api/incidents/1/personnel', () =>
      HttpResponse.json([
        { id: 31, name: 'Anna Berg' },
        { id: 32, name: 'Kraft 2' },
      ]),
    ),
    http.post('/api/incidents/1/helpers/invitations', async ({ request }) => {
      const body = await request.json();
      aufrufe.push({ pfad: 'einladen', body });
      return HttpResponse.json(
        { id: 9, code: 'ABCD2345', url: null, expires_at: '2026-11-25 12:00:00' },
        { status: 201 },
      );
    }),
    http.post('/api/incidents/1/helpers/:gid/confirm', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      aufrufe.push({ pfad: `bestaetigen/${String(params.gid)}`, body });
      const antwort = a.bestaetigen?.(body);
      if (antwort) return antwort;
      return HttpResponse.json(
        helfer(Number(params.gid), 'aktiv', { is_tracker: body.is_tracker }),
      );
    }),
  );
  return { aufrufe };
}

function rendern(darf = true) {
  return renderMitProviders(<EinsatzHelfer einsatzId={1} einsatz={EINSATZ} darf={darf} />);
}

describe('EinsatzHelfer (Helfer-App)', () => {
  it('lädt ein und zeigt QR, Code und Gültigkeit', async () => {
    const { aufrufe } = stelleBereit();
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: /Helfer einladen/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Einladen' }));

    await waitFor(() => expect(aufrufe).toHaveLength(1));
    expect(aufrufe[0].body).toEqual({ valid_minutes: 240 });
    const blatt = await screen.findByTestId('helfer-einladung');
    expect(within(blatt).getByTestId('qr')).toHaveAttribute(
      'data-value',
      `${window.location.origin}/helfer#ABCD2345`,
    );
    expect(within(blatt).getByText('ABCD-2345')).toBeInTheDocument();
    expect(blatt.textContent).toMatch(/Gültig bis .+, für beliebig viele Helfer/);
    // Das Blatt „Helfer anmelden“ druckt über die Druckwurzel.
    expect(blatt).toHaveAttribute('data-lfh', 'druckwurzel');
    expect(within(blatt).getAllByRole('listitem')).toHaveLength(3);
  });

  it('sperrt „Helfer einladen“ mit Grund, wenn die Ortung der Organisation aus ist', async () => {
    stelleBereit({ tracking_enabled: false });
    rendern();
    expect(await screen.findByText(ORTUNG_AUS_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Helfer einladen/ })).toBeDisabled();
  });

  it('ordnet wartende vor angemeldeten Helfern', async () => {
    stelleBereit({
      helpers: [helfer(1, 'aktiv', { is_tracker: true }), helfer(2, 'unbestaetigt')],
    });
    rendern();
    await screen.findByText('Wartende Helfer');
    const namen = screen.getAllByText(/^Kraft \d$/).map((n) => n.textContent);
    expect(namen).toEqual(['Kraft 2', 'Kraft 1']);
    expect(screen.getByText('Angemeldete Helfer')).toBeInTheDocument();
  });

  it('bestätigt als Ortungsgerät, wenn das Ziel frei ist', async () => {
    const { aufrufe } = stelleBereit({ helpers: [helfer(2, 'unbestaetigt')] });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen …' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('checkbox')).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(aufrufe).toHaveLength(1));
    expect(aufrufe[0]).toEqual({ pfad: 'bestaetigen/2', body: { is_tracker: true } });
  });

  it('nennt den Halter bei belegtem Ziel und ersetzt auf Wunsch', async () => {
    const { aufrufe } = stelleBereit({
      helpers: [helfer(2, 'unbestaetigt'), helfer(5, 'aktiv', { display_name: 'Jan Alt' })],
      bestaetigen: (body) =>
        body.replace
          ? undefined
          : HttpResponse.json(
              { error: 'Belegt', reason: 'tracker_taken', holder: 5 },
              { status: 409 },
            ),
    });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen …' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen' }));
    expect(
      await within(dialog).findByText(
        'Rotkreuz 1/83-1 hat schon ein Ortungsgerät (Jan Alt). Ersetzen oder nur Person orten?',
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ersetzen' }));
    await waitFor(() => expect(aufrufe).toHaveLength(2));
    expect(aufrufe[1].body).toEqual({ is_tracker: true, replace: true });
  });

  it('ordnet eine Person zu und schlägt sie nach dem Namen vor', async () => {
    const { aufrufe } = stelleBereit({
      helpers: [helfer(2, 'unbestaetigt', { person_requested: true })],
      person_tracking_allowed: true,
    });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen …' }));
    const dialog = await screen.findByRole('dialog');
    // „Kraft 2“ heißt wie die Kraft 32.
    expect(await within(dialog).findByTitle('Kraft 2')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(aufrufe).toHaveLength(1));
    expect(aufrufe[0].body).toEqual({ is_tracker: true, person_id: 32 });
  });

  it('blendet die Personenzuordnung aus, wenn die Organisation keine Personenortung erlaubt', async () => {
    stelleBereit({
      helpers: [helfer(2, 'unbestaetigt', { person_requested: true })],
      person_tracking_allowed: false,
    });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen …' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Person')).not.toBeInTheDocument();
  });

  it('bietet keine Person an, wenn die Kraft keine Personenortung gewählt hat', async () => {
    const { aufrufe } = stelleBereit({
      helpers: [helfer(2, 'unbestaetigt', { person_requested: false })],
      person_tracking_allowed: true,
    });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen …' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Person')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(aufrufe).toHaveLength(1));
    expect(aufrufe[0].body).toEqual({ is_tracker: true });
  });

  it('nennt den Grund, wenn der Server die Person ohne Wunsch der Kraft ablehnt', async () => {
    stelleBereit({
      helpers: [helfer(2, 'unbestaetigt', { person_requested: true })],
      person_tracking_allowed: true,
      bestaetigen: () =>
        HttpResponse.json(
          { error: 'Keine Person', reason: 'person_not_requested' },
          { status: 422 },
        ),
    });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen …' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTitle('Kraft 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen' }));
    expect(
      await within(dialog).findByText(/Die Kraft hat keine Personenortung gewählt/),
    ).toBeInTheDocument();
  });

  it('fragt vor einer neuen Einladung, solange eine gültige besteht', async () => {
    stelleBereit({
      invitation: { id: 3, expires_at: '2026-11-25 20:00:00' },
    });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: /Helfer einladen/ }));
    expect(
      (
        await screen.findAllByText(
          'Neue Einladung anlegen? Gedruckte QR-Codes der bisherigen Einladung werden ungültig.',
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Einladen' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Neue Einladung' }));
    expect(await screen.findByRole('button', { name: 'Einladen' })).toBeInTheDocument();
  });

  it('schließt den Dialog mit dem Code nicht per Escape', async () => {
    stelleBereit();
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: /Helfer einladen/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Einladen' }));
    await screen.findByTestId('helfer-einladung');
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Helfer anmelden' }), {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
    });
    await new Promise((r) => setTimeout(r, 400));
    // Schließt der Dialog, trägt er die Austrittsanimation (jsdom entfernt ihn danach nicht mehr).
    expect(screen.getByTestId('helfer-einladung').closest('.ant-modal')).not.toHaveClass(
      'ant-zoom-leave',
    );
    // Schließen geht nur über den ausdrücklichen Knopf.
    expect(screen.getByRole('button', { name: 'Fertig' })).toBeEnabled();
  });

  it('behält bei einem gescheiterten Neuabruf den letzten Stand und nennt den Fehler', async () => {
    let abrufe = 0;
    stelleBereit({
      helpers: [helfer(2, 'unbestaetigt')],
      invitation: { id: 3, expires_at: '2026-11-25 20:00:00' },
    });
    server.use(
      http.get('/api/incidents/1/helpers', () => {
        abrufe += 1;
        if (abrufe > 1) return HttpResponse.json({ error: 'Kaputt' }, { status: 500 });
        return HttpResponse.json({
          helpers: [helfer(2, 'unbestaetigt')],
          invitation: { id: 3, expires_at: '2026-11-25 20:00:00' },
          tracking_enabled: true,
          person_tracking_allowed: false,
        });
      }),
      http.post('/api/incidents/1/helpers/invitations/3/revoke', () =>
        HttpResponse.json({}, { status: 200 }),
      ),
    );
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Einladung widerrufen' }));
    expect(await screen.findByText(/Helfer nicht aktualisiert/)).toBeInTheDocument();
    expect(screen.getByText('Kraft 2')).toBeInTheDocument();
    expect(screen.queryByText('Helfer nicht ladbar')).not.toBeInTheDocument();
  });

  it('lässt die Leitung das Ziel beim Bestätigen ändern', async () => {
    const { aufrufe } = stelleBereit({ helpers: [helfer(2, 'unbestaetigt')] });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen …' }));
    const dialog = await screen.findByRole('dialog');
    // Vorbelegt mit der Wahl des Helfers.
    const ziel = within(dialog).getByRole('combobox', { name: 'Ziel' });
    expect(within(dialog).getByTitle('Fahrzeug Rotkreuz 1/83-1')).toBeInTheDocument();
    await userEvent.click(ziel);
    await userEvent.click(await screen.findByTitle('Einheit Zug 1'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(aufrufe).toHaveLength(1));
    expect(aufrufe[0].body).toEqual({
      target: { kind: 'unit', id: 4 },
      is_tracker: true,
    });
  });

  it('zeigt ohne Recht keine Handlungen', async () => {
    stelleBereit({ helpers: [helfer(2, 'unbestaetigt')] });
    rendern(false);
    await screen.findByText('Wartende Helfer');
    expect(screen.queryByRole('button', { name: /Helfer einladen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bestätigen …' })).not.toBeInTheDocument();
  });
});
