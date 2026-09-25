import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import SchadenAnhaenge from './SchadenAnhaenge';

vi.mock('../../api/einsatzSchaden', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../../api/einsatzSchaden')>();
  return { ...echt, entferneSchadenAnhang: vi.fn() };
});
import { entferneSchadenAnhang } from '../../api/einsatzSchaden';

const entferne = vi.mocked(entferneSchadenAnhang);
afterEach(() => vi.clearAllMocks());

const PFAD = '/api/einsaetze/1/schaeden/10/anhaenge';
const schaden = { id: 10, registrier_nr: 3, storniert_at: null as string | null };
const anhang = (id: number, dateiname: string, mime = 'image/jpeg') => ({
  id,
  schaden_id: 10,
  dateiname,
  mime,
  groesse: 2 * 1024 * 1024,
  abgelegt_von_id: 1,
  abgelegt_von_name: 'Leitung',
  abgelegt_at: '2026-09-25 10:30:00',
});

function rendere(
  liste: unknown[] | 'fehler' | 'haengt',
  props: { darfSchreiben?: boolean; storniert?: boolean } = {},
) {
  server.use(
    http.get(PFAD, () => {
      if (liste === 'fehler') return HttpResponse.json({ error: 'kaputt' }, { status: 500 });
      if (liste === 'haengt') return new Promise<never>(() => {});
      return HttpResponse.json(liste);
    }),
  );
  return renderMitProviders(
    <SchadenAnhaenge
      einsatzId={1}
      schaden={{ ...schaden, storniert_at: props.storniert ? '2026-09-25 11:00:00' : null }}
      darfSchreiben={props.darfSchreiben ?? true}
    />,
  );
}

const paneel = () => screen.getByRole('region', { name: 'Fotos und Dateien' });

describe('SchadenAnhaenge (LFH-21)', () => {
  it('zeigt den Ladezustand benannt', () => {
    rendere('haengt');
    expect(screen.getByLabelText('Fotos und Dateien wird geladen')).toBeInTheDocument();
  });

  it('zeigt einen Fehler als Fehler, nicht als leer', async () => {
    rendere('fehler');
    expect(await within(paneel()).findByRole('alert')).toBeInTheDocument();
    expect(within(paneel()).queryByText('Noch keine Fotos oder Dateien')).toBeNull();
  });

  it('zeigt den Leerzustand mit Ablegen als Ausweg', async () => {
    rendere([]);
    expect(await within(paneel()).findByText('Noch keine Fotos oder Dateien')).toBeInTheDocument();
  });

  it('listet Dateien mit Download-Anker auf die Schadensroute und eindeutigem Namen', async () => {
    rendere([anhang(5, 'dach.jpg'), anhang(6, 'gutachten.pdf', 'application/pdf')]);
    const dach = await screen.findByRole('link', {
      name: 'dach.jpg, 2.0 MB, Datei von Schaden S-003 herunterladen',
    });
    expect(dach).toHaveAttribute('href', '/api/einsaetze/1/schaeden/10/anhaenge/5/datei');
    expect(dach).toHaveAttribute('download', 'dach.jpg');
    expect(dach.getAttribute('href')).not.toMatch(/^\/api\/einsaetze\/1\/anhaenge/);
    const links = within(paneel()).getAllByRole('link');
    const namen = links.map((l) => l.getAttribute('aria-label'));
    expect(new Set(namen).size).toBe(namen.length);
    expect(within(paneel()).getByText('2 Dateien')).toBeInTheDocument();
    const knoepfe = within(paneel())
      .getAllByRole('button', { name: /entfernen$/ })
      .map((b) => b.getAttribute('aria-label'));
    expect(knoepfe).toEqual([
      'Datei dach.jpg von Schaden S-003 entfernen',
      'Datei gutachten.pdf von Schaden S-003 entfernen',
    ]);
  });

  it('ohne Schreibrecht: keine Aktionen, Leerzustand ohne Ablegen', async () => {
    rendere([anhang(5, 'dach.jpg')], { darfSchreiben: false });
    await screen.findByRole('link', { name: /dach\.jpg/ });
    expect(within(paneel()).queryByRole('button', { name: /Datei ablegen/ })).toBeNull();
    expect(within(paneel()).queryByRole('button', { name: /entfernen/ })).toBeNull();
  });

  it('storniert: lesbar, aber keine Aktionen', async () => {
    rendere([anhang(5, 'dach.jpg')], { storniert: true });
    await screen.findByRole('link', { name: /dach\.jpg/ });
    expect(within(paneel()).queryByRole('button', { name: /Datei ablegen/ })).toBeNull();
    expect(within(paneel()).queryByRole('button', { name: /entfernen/ })).toBeNull();
  });

  it('ohne Schreibrecht und leer: kein Ablegen-Knopf ins Leere', async () => {
    rendere([], { darfSchreiben: false });
    await within(paneel()).findByText('Noch keine Fotos oder Dateien');
    expect(within(paneel()).queryByRole('button')).toBeNull();
  });

  it('entfernt erst nach Bestätigung mit rotem OK-Knopf', async () => {
    entferne.mockResolvedValue(undefined);
    rendere([anhang(5, 'dach.jpg')]);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Datei dach.jpg von Schaden S-003 entfernen' }),
    );
    expect(entferne).not.toHaveBeenCalled();
    const frage = await screen.findByText('Datei entfernen?');
    const pop = frage.closest('.ant-popover') as HTMLElement;
    expect(pop).toHaveTextContent('Sie verschwindet aus der Liste; der ETB-Nachweis bleibt.');
    const ok = within(pop).getByRole('button', { name: 'Entfernen' });
    expect(ok.className).toMatch(/ant-btn-dangerous/);
    await userEvent.click(ok);
    await vi.waitFor(() => expect(entferne).toHaveBeenCalledWith(1, 10, 5));
  });

  it('öffnet den Ablegen-Dialog aus dem Paneelkopf', async () => {
    rendere([anhang(5, 'dach.jpg')]);
    await userEvent.click(await within(paneel()).findByRole('button', { name: 'Datei ablegen' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Datei ablegen · Schaden S-003');
  });
});
