import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { installiereXhrAttrappe } from '../../test/xhrAttrappe';
import { einpassen, type UhsPlan } from '../../api/uhsPlan';
import type { UhsAnhang, UhsDetail, UhsPlatz } from '../../api/types';
import UhsPlanPaneel, { PLAN_ACCEPT } from './UhsPlanPaneel';

const PLAN: UhsPlan = {
  uhs_id: 1,
  mime: 'image/png',
  sha256: 'ab12',
  bild_breite: 800,
  bild_hoehe: 600,
  x: 0,
  y: 0,
  breite: 820,
  helligkeit: 60,
  kontrast: 100,
  nacht_umkehren: true,
  hinterlegt_at: 'x',
  geaendert_at: 'x',
};

function platz(i: number): UhsPlatz {
  return {
    id: i + 1,
    uhs_id: 1,
    typ: 'bett',
    bezeichnung: `Bett ${i + 1}`,
    pos_x: 170 + (i % 5) * 160,
    pos_y: 130 + Math.floor(i / 5) * 120,
    verfuegbarkeit: 'frei',
    reserviert_fuer_person_id: null,
    storniert_at: null,
  };
}

function uhs(over: Partial<UhsDetail> = {}): UhsDetail {
  return {
    id: 1,
    einsatz_id: 1,
    abschnitt_id: null,
    typ: 'behandlungsplatz',
    bezeichnung: 'BHP 50',
    standort: null,
    notiz: null,
    lat: null,
    lon: null,
    status: 'aktiv',
    erfasst_at: 'x',
    erfasst_von: 1,
    geaendert_at: 'x',
    geaendert_von: 1,
    storniert_at: null,
    plaetze: Array.from({ length: 6 }, (_, i) => platz(i)),
    belegungen: [],
    material: [],
    ...over,
  };
}

function anhang(id: number, dateiname: string, mime: string): UhsAnhang {
  return {
    id,
    uhs_id: 1,
    dateiname,
    mime,
    groesse: 10,
    abgelegt_at: 'x',
    abgelegt_von_id: 1,
    abgelegt_von_name: 'Frieda',
  };
}

/** Zeichnet jede schreibende Anfrage an den Plan auf (Methode, Pfad, Body). */
function planServer(anhaenge: UhsAnhang[] = [], patchStatus = 200) {
  const anfragen: { methode: string; pfad: string; body: unknown }[] = [];
  const merke = async (request: Request) => {
    const text = await request.text();
    anfragen.push({
      methode: request.method,
      pfad: new URL(request.url).pathname,
      body: text ? JSON.parse(text) : null,
    });
  };
  server.use(
    http.get('/api/einsaetze/1/uhs/1/anhaenge', () => HttpResponse.json(anhaenge)),
    http.patch('/api/einsaetze/1/uhs/1/plan', async ({ request }) => {
      await merke(request);
      return patchStatus === 200
        ? HttpResponse.json(PLAN)
        : HttpResponse.json({ error: 'Plan nicht gefunden' }, { status: patchStatus });
    }),
    http.post('/api/einsaetze/1/uhs/1/plan/aus-anhang', async ({ request }) => {
      await merke(request);
      return HttpResponse.json(PLAN);
    }),
    http.delete('/api/einsaetze/1/uhs/1/plan', async ({ request }) => {
      await merke(request);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return anfragen;
}

const zeichne = (u: UhsDetail) => renderMitProviders(<UhsPlanPaneel einsatzId={1} uhs={u} />);

describe('UhsPlanPaneel (LFH-999)', () => {
  it('ohne Plan: Hinweis, Hochladen und Übernahme, keine Lage und kein Entfernen', async () => {
    planServer();
    zeichne(uhs());
    expect(screen.getByText('Nur Pläne, keine Fotos von Patienten.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bild hochladen/ })).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Breite' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan entfernen' })).not.toBeInTheDocument();
  });

  it('lädt ein gewähltes Bild per PUT hoch, nur PNG, JPEG und WebP im Dateidialog', async () => {
    planServer();
    const anfragen = installiereXhrAttrappe();
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    const { container } = zeichne(uhs());
    const eingabe = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(eingabe).toHaveAttribute('accept', PLAN_ACCEPT);
    expect(PLAN_ACCEPT).toBe('.png,.jpg,.jpeg,.webp');
    const datei = new File(['png'], 'halle.png', { type: 'image/png' });
    await userEvent.upload(eingabe, datei);
    await waitFor(() => expect(anfragen).toHaveLength(1));
    expect(anfragen[0].methode).toBe('PUT');
    expect(anfragen[0].url).toBe('/api/einsaetze/1/uhs/1/plan');
    expect((anfragen[0].body as FormData).get('datei')).toBe(datei);
  });

  it('bietet zur Übernahme nur Bild-Anhänge an und nennt das Protokoll', async () => {
    const anfragen = planServer([
      anhang(31, 'halle.png', 'image/png'),
      anhang(32, 'flur.jpg', 'image/jpeg'),
      anhang(33, 'zelt.webp', 'image/webp'),
      anhang(34, 'liste.pdf', 'application/pdf'),
      anhang(35, 'foto.heic', 'image/heic'),
    ]);
    zeichne(uhs());
    expect(screen.getByText(/Die Übernahme wird wie ein Abruf protokolliert/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('combobox', { name: 'Aus Dateien übernehmen' }));
    const liste = await waitFor(() => {
      const el = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
      if (!el) throw new Error('keine offene Auswahl');
      return el as HTMLElement;
    });
    await waitFor(() =>
      expect(
        [...liste.querySelectorAll('.ant-select-item-option')].map((o) => o.textContent),
      ).toEqual(['halle.png', 'flur.jpg', 'zelt.webp']),
    );
    await userEvent.click(within(liste).getByText('flur.jpg'));
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() =>
      expect(anfragen).toEqual([
        {
          methode: 'POST',
          pfad: '/api/einsaetze/1/uhs/1/plan/aus-anhang',
          body: { anhang_id: 32 },
        },
      ]),
    );
  });

  it('schickt den Regler erst beim Loslassen', async () => {
    const anfragen = planServer();
    zeichne(uhs({ plan: PLAN }));
    const regler = screen.getByRole('slider', { name: 'Helligkeit' });
    fireEvent.keyDown(regler, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 });
    fireEvent.keyDown(regler, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 });
    await new Promise((r) => setTimeout(r, 20));
    expect(anfragen).toHaveLength(0);
    fireEvent.keyUp(regler, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 });
    await waitFor(() => expect(anfragen).toHaveLength(1));
    expect(anfragen[0]).toEqual({
      methode: 'PATCH',
      pfad: '/api/einsaetze/1/uhs/1/plan',
      body: { helligkeit: 70 },
    });
  });

  it('schickt ein Zahlenfeld erst beim Verlassen', async () => {
    const anfragen = planServer();
    zeichne(uhs({ plan: PLAN }));
    const breite = screen.getByRole('spinbutton', { name: 'Breite' });
    await userEvent.clear(breite);
    await userEvent.type(breite, '1234');
    expect(anfragen).toHaveLength(0);
    await userEvent.tab();
    await waitFor(() => expect(anfragen).toHaveLength(1));
    expect(anfragen[0].body).toEqual({ breite: 1234 });
  });

  it('schaltet die Umkehr im Nachtbetrieb', async () => {
    const anfragen = planServer();
    zeichne(uhs({ plan: PLAN }));
    await userEvent.click(screen.getByRole('switch', { name: 'Im Nachtbetrieb umkehren' }));
    await waitFor(() => expect(anfragen[0]?.body).toEqual({ nacht_umkehren: false }));
  });

  it('passt mit den Werten von `einpassen` an die Plätze an', async () => {
    const anfragen = planServer();
    const u = uhs({ plan: PLAN });
    zeichne(u);
    await userEvent.click(screen.getByRole('button', { name: 'An Plätze einpassen' }));
    await waitFor(() => expect(anfragen).toHaveLength(1));
    const erwartet = einpassen(u.plaetze, PLAN.bild_breite, PLAN.bild_hoehe);
    expect(erwartet).toEqual({ x: 150, y: 110, breite: 820 });
    expect(anfragen[0].body).toEqual(erwartet);
  });

  it('fragt vor dem Entfernen und entfernt erst nach der Bestätigung', async () => {
    const anfragen = planServer();
    zeichne(uhs({ plan: PLAN }));
    await userEvent.click(screen.getByRole('button', { name: 'Plan entfernen' }));
    expect(anfragen).toHaveLength(0);
    const rueckfrage = await screen.findByRole('tooltip');
    const ja = within(rueckfrage).getByRole('button', { name: 'Entfernen' });
    expect(ja).toHaveClass('ant-btn-dangerous');
    await userEvent.click(ja);
    await waitFor(() =>
      expect(anfragen).toEqual([
        { methode: 'DELETE', pfad: '/api/einsaetze/1/uhs/1/plan', body: null },
      ]),
    );
  });

  it('zeigt einen Speicherfehler am Paneel', async () => {
    planServer([], 404);
    zeichne(uhs({ plan: PLAN }));
    await userEvent.click(screen.getByRole('switch', { name: 'Im Nachtbetrieb umkehren' }));
    expect(await screen.findByText('Plan nicht gefunden')).toBeInTheDocument();
  });
});
