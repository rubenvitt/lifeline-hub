import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { App as AntApp } from 'antd';
import LiveStatusBanner from './LiveStatusBanner';
import { setzeViewportBreite } from '../test/viewport';
import { leseRahmenOben } from '../components/rahmenOben';
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
  queueLegacyEinreihenFuerTests,
} from '../offline/queue';

function melde(status: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent('lfh:live-status', { detail: { status } }));
  });
}

function renderBanner(route = '/einsaetze', klebend = false) {
  return render(
    <AntApp>
      <MemoryRouter initialEntries={[route]}>
        <LiveStatusBanner benutzerId={11} klebend={klebend} />
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
    expect(await screen.findByLabelText('1 ausstehende Offline-Aktion')).toBeInTheDocument();
    expect(screen.getByText('ausstehend')).toBeInTheDocument();
  });

  it('hält Aktionen anderer Einsätze im globalen Badge und in der Recovery sichtbar', async () => {
    await queueEinreihen(11, 7, {
      typ: 'meldung',
      inhalt: 'Aus Einsatz A',
      client_id: 'etb-einsatz-a',
    });
    const [pending] = await queueLaden(11, 7);
    await queueAblehnen(11, pending, 'Unter Einsatz B weiterhin sichtbar');

    renderBanner('/einsaetze/8/etb');
    await userEvent.click(await screen.findByLabelText('1 abgelehnte Offline-Aktion'));

    expect(await screen.findByText('Unter Einsatz B weiterhin sichtbar')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
  });

  it('nennt beim Knopf für alte Offline-Daten die Wirkung (ansehen), nicht das Verwerfen (LFH-944)', async () => {
    await queueLegacyEinreihenFuerTests(73, {
      typ: 'meldung',
      inhalt: 'Aus früherer Sitzung',
      client_id: 'legacy-banner-1',
    });
    renderBanner('/einsaetze/7/etb');

    const knopf = await screen.findByRole('button', {
      name: 'Alte Offline-Daten ansehen (1 Aktion ohne Zuordnung)',
    });
    expect(knopf).toHaveTextContent('Alte Offline-Daten ansehen');
    expect(screen.queryByText(/verwerfen/)).not.toBeInTheDocument();
    // Der Knopf öffnet nur den Drawer; verworfen wird dort erst nach Bestätigung.
    await userEvent.click(knopf);
    expect(await screen.findByText('Offline-Aktionen wiederherstellen')).toBeInTheDocument();
  });

  it('öffnet vom globalen Badge die Recovery mit Inhalt, Grund und Wiederholen', async () => {
    await queueEinreihen(11, 7, {
      typ: 'meldung',
      inhalt: 'Vollständiger Offline-Wortlaut',
      client_id: 'etb-recovery',
    });
    const [pending] = await queueLaden(11, 7);
    await queueAblehnen(11, pending, 'Keine Berechtigung');
    renderBanner('/einsaetze/7/etb');

    await userEvent.click(await screen.findByLabelText('1 abgelehnte Offline-Aktion'));
    expect(await screen.findByText('Offline-Aktionen wiederherstellen')).toBeInTheDocument();
    expect(screen.getByText('Keine Berechtigung')).toBeInTheDocument();
    expect(screen.getByText(/Vollständiger Offline-Wortlaut/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    await waitFor(async () => expect(await queueLaden(11, 7)).toHaveLength(1));
  });
});

/**
 * LFH-952 (D1): unter `md` rollt der Kopf mit; dann klebt die Betriebszeile, solange sie eine
 * Verbindungsstörung meldet (offline oder Live-Verbindung `lost`). Ab `md` trägt die SYNC-Zelle
 * im klebenden Kopf die Störung, und die Zeile rollt.
 */
describe('LiveStatusBanner — klebt bei Störung am Handy (LFH-952)', () => {
  function zeile() {
    return document.querySelector<HTMLElement>("[data-lfh='betriebszeile']");
  }

  it('390, offline: die Zeile klebt auf der Rahmenebene', () => {
    setzeViewportBreite(390);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderBanner('/einsaetze', true);
    expect(zeile()).toHaveStyle({ position: 'sticky', top: '0px', zIndex: '100' });
  });

  it('390, Live-Verbindung lost: die Zeile klebt', () => {
    setzeViewportBreite(390);
    renderBanner('/einsaetze', true);
    melde('lost');
    expect(zeile()).toHaveStyle({ position: 'sticky' });
  });

  it('390, Verbindungsaufbau: die Zeile rollt (kein Störungsfall)', () => {
    setzeViewportBreite(390);
    renderBanner('/einsaetze', true);
    melde('connecting');
    expect(zeile()).not.toBeNull();
    expect(zeile()!.style.position).toBe('');
  });

  it('1024, offline: die Zeile rollt, der Kopf klebt', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderBanner('/einsaetze', true);
    expect(zeile()!.style.position).toBe('');
  });

  it('meldet ihre Höhe als Rahmen, solange sie klebt, und nimmt sie mit der Störung wieder weg', () => {
    setzeViewportBreite(390);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderBanner('/einsaetze', true);
    expect(leseRahmenOben()).toBe(40);
    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(leseRahmenOben()).toBe(0);
  });

  it('ohne `klebend` (Gerätehülle mit eigenem Scrollbereich) klebt sie nie', () => {
    setzeViewportBreite(390);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderBanner();
    expect(zeile()!.style.position).toBe('');
  });
});
