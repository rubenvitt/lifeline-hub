import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import type { BefehlAnzeige, BefehlKopf } from '../api/types';
import { renderMitProviders } from '../test/utils';
import { ApiError } from '../api/client';
import { vorlage } from '../befehle/vorlagen';
import BefehlDetail from './BefehlDetail';

const ladeBefehl = vi.fn();
const gibBefehlFrei = vi.fn();
const schreibeBefehlFort = vi.fn();
const quittiereBefehlEmpfang = vi.fn();
const nimmBefehlQuittungZurueck = vi.fn();
vi.mock('../api/befehle', () => ({
  ladeBefehl: (...a: unknown[]) => ladeBefehl(...a),
  gibBefehlFrei: (...a: unknown[]) => gibBefehlFrei(...a),
  schreibeBefehlFort: (...a: unknown[]) => schreibeBefehlFort(...a),
  quittiereBefehlEmpfang: (...a: unknown[]) => quittiereBefehlEmpfang(...a),
  nimmBefehlQuittungZurueck: (...a: unknown[]) => nimmBefehlQuittungZurueck(...a),
}));

const kopf = (over: Partial<BefehlKopf> = {}): BefehlKopf => ({
  id: 7,
  einsatz_id: 5,
  ersteller_id: 1,
  ersteller_name: 'Huber',
  erstellt_at: '2026-06-11 08:00:00',
  etb_eintrag_id: null,
  freigegeben_at: null,
  freigegeben_von_id: null,
  freigegeben_von_name: null,
  status: 'entwurf',
  titel: 'Befehl an 2. Zug',
  version: 1,
  vorgaenger_id: null,
  vorlage: 'befehl_lad',
  zeitstand: '2026-06-11 08:30:00',
  verteiler: [],
  is_quittierbar: false,
  ...over,
});
const LAD = vorlage('befehl_lad')!;
const VERTEILER: BefehlKopf['verteiler'] = [
  {
    id: 1,
    empfaenger_typ: 'abschnitt',
    abschnitt_id: 3,
    snap_anzeige: 'EA Süd',
    quittiert_at: '2026-06-11 08:45:00',
  },
  { id: 2, empfaenger_typ: 'funktion', funktion: 's3', snap_anzeige: 'S3 Einsatz' },
];
const anzeige = (k: BefehlKopf): BefehlAnzeige => ({
  ...k,
  aktualisiert_at: k.zeitstand,
  abschnitte: [{ schluessel: LAD.abschnitte[0].schluessel, text: 'Brand im Lager' }],
});

function Ort() {
  return <span data-testid="ort">{useLocation().pathname}</span>;
}

function rendern(b: BefehlKopf, darfSchreiben = true) {
  ladeBefehl.mockResolvedValue(anzeige(b));
  return renderMitProviders(
    <>
      <Ort />
      <BefehlDetail befehl={b} einsatzId={5} darfSchreiben={darfSchreiben} />
    </>,
    { route: '/einsaetze/5/auftraege' },
  );
}

describe('BefehlDetail (Spec `auftraege-befehle`, „Einsatzbefehl im Detail“)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('zeigt Fassung, Angaben, die Lesefassung und den Sprung zur Vollansicht', async () => {
    rendern(kopf());
    expect(screen.getByRole('heading', { name: 'Befehl v1' })).toBeInTheDocument();
    expect(await screen.findByText('Brand im Lager')).toBeInTheDocument();
    expect(screen.getByText('Befehl LAD (vereinfacht)')).toBeInTheDocument();
    expect(screen.getByText('Huber')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Vollansicht/ })).toHaveAttribute(
      'href',
      '/einsaetze/5/auftraege/befehle/7',
    );
    expect(ladeBefehl).toHaveBeenCalledWith(5, 7);
  });

  it('ein Entwurf nennt den Verteiler ohne Quittungsstand (LLH-1172)', async () => {
    rendern(kopf({ verteiler: VERTEILER }));
    expect(await screen.findByText('EA Süd, S3 Einsatz')).toBeInTheDocument();
    expect(screen.getByText('Verteiler')).toBeInTheDocument();
    expect(screen.queryByText(/quittiert/)).toBeNull();
  });

  describe('Quittung je Empfänger (LLH-1173, Spec `befehl-quittung`)', () => {
    const frei = (over: Partial<BefehlKopf> = {}) =>
      kopf({
        status: 'freigegeben',
        freigegeben_at: '2026-06-11 08:40:00',
        is_quittierbar: true,
        verteiler: VERTEILER,
        ...over,
      });

    it('zeigt Quittungsstand, Quittierte mit ✓ und Offene mit Knopf', async () => {
      rendern(frei());
      expect(await screen.findByText('2 Empfänger · 1/2 quittiert')).toBeInTheDocument();
      expect(screen.getByText('EA Süd ✓')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Empfang für S3 Einsatz quittieren' }),
      ).toBeInTheDocument();
    });

    it('quittiert ohne Rückfrage, Rückgängig nimmt die Quittung zurück', async () => {
      const b = frei();
      const quittiert = {
        ...anzeige(b),
        verteiler: VERTEILER.map((e) => ({ ...e, quittiert_at: '2026-06-11 08:50:00' })),
      };
      quittiereBefehlEmpfang.mockResolvedValue(quittiert);
      nimmBefehlQuittungZurueck.mockResolvedValue(anzeige(b));
      rendern(b);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Empfang für S3 Einsatz quittieren' }),
      );
      await waitFor(() => expect(quittiereBefehlEmpfang).toHaveBeenCalledWith(5, 7, 2));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(await screen.findByText('2 Empfänger · 2/2 quittiert')).toBeInTheDocument();
      await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
      await waitFor(() => expect(nimmBefehlQuittungZurueck).toHaveBeenCalledWith(5, 7, 2));
    });

    it('eine überholte Fassung zeigt ihre offenen Empfänger ohne Knopf', async () => {
      rendern(frei({ is_quittierbar: false }));
      expect(await screen.findByText('S3 Einsatz')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /quittieren/ })).toBeNull();
    });

    it('ohne Schreibrecht Verteiler und Stand, aber kein Knopf', async () => {
      rendern(frei(), false);
      expect(await screen.findByText('2 Empfänger · 1/2 quittiert')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /quittieren/ })).toBeNull();
    });

    it('eine abgelehnte Quittung nennt den Grund am Verteiler', async () => {
      quittiereBefehlEmpfang.mockRejectedValue(
        new ApiError(422, 'Eine neuere Fassung ist freigegeben; quittiert wird nur die jüngste'),
      );
      rendern(frei());
      await userEvent.click(
        await screen.findByRole('button', { name: 'Empfang für S3 Einsatz quittieren' }),
      );
      const block = document.querySelector('[data-lfh="befehl-verteiler"]') as HTMLElement;
      expect(await within(block).findByText(/neuere Fassung ist freigegeben/)).toBeInTheDocument();
    });
  });

  it('ohne Verteiler steht keine Zeile „Verteiler“', async () => {
    rendern(kopf());
    await screen.findByText('Brand im Lager');
    expect(screen.queryByText('Verteiler')).toBeNull();
  });

  it('gliedert unter dem Paneel (h4) mit h5-Abschnitten; „Befehlstext“ ist Etikett, keine Überschrift', async () => {
    rendern(kopf());
    await screen.findByText('Brand im Lager');
    expect(screen.getByRole('heading', { level: 4, name: 'Befehl v1' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 5 }).length).toBeGreaterThan(0);
    expect(screen.getByText('Befehlstext')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Befehlstext' })).toBeNull();
  });

  it('ein Entwurf trägt „Entwurf bearbeiten“ und „Freigeben“; Freigeben fragt mit Folge nach', async () => {
    const freigegeben = kopf({ status: 'freigegeben', freigegeben_at: '2026-06-11 08:40:00' });
    gibBefehlFrei.mockResolvedValue(anzeige(freigegeben));
    rendern(kopf());
    await screen.findByText('Brand im Lager');
    expect(screen.getByRole('button', { name: 'Freigeben' })).toBeInTheDocument();
    // Link in Knopfgestalt: Strg/⌘+Klick öffnet die Vollseite in einem Tab.
    await userEvent.click(screen.getByRole('link', { name: 'Entwurf bearbeiten' }));
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/5/auftraege/befehle/7');
  });

  it('Freigeben im Detail: Rückfrage mit „Endgültig: geht ins ETB“, dann freigegeben', async () => {
    gibBefehlFrei.mockResolvedValue(anzeige(kopf({ status: 'freigegeben' })));
    rendern(kopf());
    await screen.findByText('Brand im Lager');
    await userEvent.click(screen.getByRole('button', { name: 'Freigeben' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/Endgültig: geht ins ETB/);
    await userEvent.click(within(dialog).getByRole('button', { name: /freigeben/i }));
    await waitFor(() => expect(gibBefehlFrei).toHaveBeenCalledWith(5, 7));
    // antds Modal räumt seinen Knoten erst am Ende der Zoom-Animation ab; jsdom feuert kein
    // `transitionend` (Muster `BefehlDetailPage.test.tsx`).
    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
  });

  it('eine abgelehnte Freigabe hält den Dialog offen und nennt den Grund darin', async () => {
    gibBefehlFrei.mockRejectedValue(new ApiError(422, 'Abschnitt „Lage“ ist leer'));
    rendern(kopf());
    await screen.findByText('Brand im Lager');
    await userEvent.click(screen.getByRole('button', { name: 'Freigeben' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /freigeben/i }));
    expect(await within(dialog).findByText(/Abschnitt „Lage“ ist leer/)).toBeInTheDocument();
    expect(within(dialog).getByText('Freigabe fehlgeschlagen')).toBeInTheDocument();
    expect(dialog).not.toHaveClass('ant-zoom-leave');
  });

  it('Fortschreiben öffnet die Vollseite des neuen Entwurfs', async () => {
    const frei = kopf({ status: 'freigegeben', freigegeben_at: '2026-06-11 08:40:00' });
    schreibeBefehlFort.mockResolvedValue(anzeige(kopf({ id: 8, version: 2 })));
    rendern(frei);
    await screen.findByText('Brand im Lager');
    expect(screen.queryByRole('button', { name: 'Freigeben' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Fortschreiben' }));
    await waitFor(() =>
      expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/5/auftraege/befehle/8'),
    );
  });

  it('ohne Schreibrecht keine Handlung, die Lesefassung bleibt', async () => {
    rendern(kopf(), false);
    expect(await screen.findByText('Brand im Lager')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('entfallen sagt das Detail, dass der Befehl nicht mehr in der Ansicht steht', async () => {
    ladeBefehl.mockResolvedValue(anzeige(kopf()));
    renderMitProviders(<BefehlDetail befehl={kopf()} einsatzId={5} darfSchreiben entfallen />);
    expect(screen.getByText('Nicht mehr in dieser Ansicht')).toBeInTheDocument();
  });
});
