import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { App as AntApp } from 'antd';
import LiveStatusBanner from './LiveStatusBanner';
import {
  meldeAppAktualisierungVerfuegbar,
  setzeAppAktualisierer,
  verwerfeAppAktualisierung,
} from '../pwa/appAktualisierung';
import {
  queueAblehnen,
  queueEinreihen,
  queueLaden,
  queueLeerenFuerTests,
} from '../offline/queue';

function melde(status: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent('lfh:live-status', { detail: { status } }));
  });
}

function renderBanner(route = '/einsaetze') {
  return render(
    <AntApp>
      <MemoryRouter initialEntries={[route]}>
        <LiveStatusBanner benutzerId={11} />
      </MemoryRouter>
    </AntApp>,
  );
}

afterEach(async () => {
  act(() => verwerfeAppAktualisierung());
  setzeAppAktualisierer(null);
  await queueLeerenFuerTests();
  vi.restoreAllMocks();
});

describe('LiveStatusBanner — globale Betriebszeile', () => {
  it('zeigt bei open nichts an', () => {
    const { container } = renderBanner();
    melde('open');
    expect(container.querySelector('.ant-alert')).not.toBeInTheDocument();
  });

  it('zeigt einen Fehler-Banner bei lost', () => {
    renderBanner();
    melde('lost');
    expect(screen.getByText(/unterbrochen/i)).toBeInTheDocument();
  });

  it('zeigt bei connecting einen Hinweis und blendet ihn bei open wieder aus', () => {
    renderBanner();
    melde('connecting');
    expect(screen.getByText(/wiederhergestellt/i)).toBeInTheDocument();
    melde('open');
    expect(screen.queryByText(/wiederhergestellt/i)).not.toBeInTheDocument();
  });

  it('zeigt den initialen navigator.onLine-Ausfall und reagiert auf Browser-Ereignisse', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderBanner();
    expect(screen.getByText(/Offline — keine Verbindung zum Server/)).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.queryByText(/Offline — keine Verbindung zum Server/)).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByText(/Offline — keine Verbindung zum Server/)).toBeInTheDocument();
  });

  it('vergisst einen Einsatz-Livefehler beim Status idle', () => {
    const { container } = renderBanner();
    melde('lost');
    expect(screen.getByText(/unterbrochen/i)).toBeInTheDocument();
    melde('idle');
    expect(container.querySelector('.ant-alert')).not.toBeInTheDocument();
  });

  it('behält ein frühes PWA-Update und lädt erst nach ausdrücklichem Klick neu', async () => {
    const aktualisierer = vi.fn().mockResolvedValue(undefined);
    setzeAppAktualisierer(aktualisierer);
    meldeAppAktualisierungVerfuegbar();

    renderBanner();
    expect(screen.getByText(/Neue Version verfügbar/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Jetzt neu laden' }));

    expect(aktualisierer).toHaveBeenCalledWith(true);
    expect(screen.queryByText(/Neue Version verfügbar/)).not.toBeInTheDocument();
  });

  it('zeigt Offline-Writes als Badge in derselben Betriebszeile', async () => {
    await queueEinreihen(11, 7, { typ: 'meldung', inhalt: 'Offline', client_id: 'etb-1' });
    renderBanner('/einsaetze/7/etb');
    expect(await screen.findByLabelText('1 ausstehende Offline-Aktionen')).toBeInTheDocument();
    expect(screen.getByText('ausstehend')).toBeInTheDocument();
  });

  it('hält Aktionen anderer Einsätze im globalen Badge und in der Recovery sichtbar', async () => {
    await queueEinreihen(11, 7, {
      typ: 'meldung', inhalt: 'Aus Einsatz A', client_id: 'etb-einsatz-a',
    });
    const [pending] = await queueLaden(11, 7);
    await queueAblehnen(11, pending, 'Unter Einsatz B weiterhin sichtbar');

    renderBanner('/einsaetze/8/etb');
    await userEvent.click(await screen.findByLabelText('1 abgelehnte Offline-Aktionen'));

    expect(await screen.findByText('Unter Einsatz B weiterhin sichtbar')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
  });

  it('öffnet vom globalen Badge die Recovery mit Inhalt, Grund und Wiederholen', async () => {
    await queueEinreihen(11, 7, {
      typ: 'meldung', inhalt: 'Vollständiger Offline-Wortlaut', client_id: 'etb-recovery',
    });
    const [pending] = await queueLaden(11, 7);
    await queueAblehnen(11, pending, 'Keine Berechtigung');
    renderBanner('/einsaetze/7/etb');

    await userEvent.click(await screen.findByLabelText('1 abgelehnte Offline-Aktionen'));
    expect(await screen.findByText('Offline-Aktionen wiederherstellen')).toBeInTheDocument();
    expect(screen.getByText('Keine Berechtigung')).toBeInTheDocument();
    expect(screen.getByText(/Vollständiger Offline-Wortlaut/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    await waitFor(async () => expect(await queueLaden(11, 7)).toHaveLength(1));
  });
});
