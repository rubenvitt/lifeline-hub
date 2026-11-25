import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import { ApiError } from '../../api/client';
import type { DroneSourceView } from '../../api/drohne';
import DrohnenQuelle from './DrohnenQuelle';

// Der Transport ist die Naht: Pfad und Methode sind der Vertrag mit der Route
// (`src/routes/drohne.rs`); `ApiError` bleibt echt.
const transport = vi.hoisted(() => ({ apiGet: vi.fn(), apiSend: vi.fn() }));

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  ...transport,
}));

const QUELLEN = '/api/incidents/7/drone/sources';
const QUELLE = `${QUELLEN}/suchlage-1`;

/** Dünne Sicht auf den Transport mit den Namen der Fachaktionen. */
const api = {
  loadDrohnenQuellen: transport.apiGet,
  schalteDrohnenQuelleZu: vi.fn(),
  schalteDrohnenQuelleAb: vi.fn(),
};

const quelle = (o: Partial<DroneSourceView> = {}): DroneSourceView => ({
  adapter_id: 'suchlage-1',
  label: 'Suchlage Staffel Nord',
  connected: false,
  held_by_other_hidden: false,
  lagemonitor: false,
  state: 'aktiv',
  video_keys: [],
  ...o,
});

describe('DrohnenQuelle (LLH-2106)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.loadDrohnenQuellen.mockResolvedValue([quelle()]);
    transport.apiSend.mockImplementation((pfad: string, methode: string, body?: unknown) => {
      if (pfad !== QUELLE) throw new Error(`unerwarteter Pfad ${pfad}`);
      return methode === 'PUT'
        ? api.schalteDrohnenQuelleZu(
            7,
            'suchlage-1',
            (body as { lagemonitor: boolean }).lagemonitor,
          )
        : api.schalteDrohnenQuelleAb(7, 'suchlage-1');
    });
  });

  it('zeigt „Suchlage zuschalten“ nur der Einsatzleitung', async () => {
    const { unmount } = renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten />);
    expect(await screen.findByRole('button', { name: 'Suchlage zuschalten' })).toBeInTheDocument();
    unmount();

    renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten={false} />);
    expect(await screen.findByText('Nicht zugeschaltet')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('schaltet zu und liest danach neu', async () => {
    api.schalteDrohnenQuelleZu.mockResolvedValue(quelle({ connected: true }));
    renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten />);
    fireEvent.click(await screen.findByRole('button', { name: 'Suchlage zuschalten' }));
    await waitFor(() =>
      expect(api.schalteDrohnenQuelleZu).toHaveBeenCalledWith(7, 'suchlage-1', false),
    );
    await waitFor(() => expect(api.loadDrohnenQuellen.mock.calls.length).toBeGreaterThan(1));
  });

  it('zeigt den Missionsnamen und „Abschalten“, sobald zugeschaltet', async () => {
    api.loadDrohnenQuellen.mockResolvedValue([
      quelle({ connected: true, mission_name: 'Waldsuche Ost' }),
    ]);
    api.schalteDrohnenQuelleAb.mockResolvedValue(undefined);
    renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten />);
    expect(await screen.findByText(/Zugeschaltet · Mission Waldsuche Ost/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suchlage zuschalten' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Abschalten' }));
    await waitFor(() => expect(api.schalteDrohnenQuelleAb).toHaveBeenCalledWith(7, 'suchlage-1'));
  });

  it('zeigt die Mission auch ohne Schaltrecht', async () => {
    api.loadDrohnenQuellen.mockResolvedValue([
      quelle({ connected: true, mission_name: 'Waldsuche Ost' }),
    ]);
    renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten={false} />);
    expect(await screen.findByText(/Mission Waldsuche Ost/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('nennt den Einsatz, der die Quelle hält, und bietet kein Zuschalten an', async () => {
    api.loadDrohnenQuellen.mockResolvedValue([quelle({ held_by_other: 'Hochwasser Süd' })]);
    renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten />);
    expect(
      await screen.findByText('Bereits an Einsatz Hochwasser Süd zugeschaltet'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('sagt ohne Leserecht am anderen Einsatz „einem anderen Einsatz“, ohne Platzhalternamen', async () => {
    api.loadDrohnenQuellen.mockResolvedValue([quelle({ held_by_other_hidden: true })]);
    renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten />);
    expect(
      await screen.findByText('Bereits an einem anderen Einsatz zugeschaltet'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Einsatz anderer Einsatz/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('bietet kein weiteres Zuschalten an, solange eine Quelle hier zugeschaltet ist', async () => {
    api.loadDrohnenQuellen.mockResolvedValue([
      quelle({ connected: true }),
      quelle({ adapter_id: 'suchlage-2', label: 'Suchlage Staffel Süd' }),
    ]);
    renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten />);
    expect(await screen.findByRole('button', { name: 'Abschalten' })).toBeInTheDocument();
    expect(screen.getByText('Suchlage Staffel Süd')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suchlage zuschalten' })).toBeNull();
  });

  it('zeigt nach einem 409 den Einsatz aus der neu geladenen Liste', async () => {
    api.loadDrohnenQuellen
      .mockResolvedValueOnce([quelle()])
      .mockResolvedValue([quelle({ held_by_other: 'Hochwasser Süd' })]);
    api.schalteDrohnenQuelleZu.mockRejectedValue(new ApiError(409, 'Konflikt'));
    renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten />);
    fireEvent.click(await screen.findByRole('button', { name: 'Suchlage zuschalten' }));
    expect(
      await screen.findByText('Bereits an Einsatz Hochwasser Süd zugeschaltet'),
    ).toBeInTheDocument();
  });

  it('sagt bei einem 409 ohne Namen, dass ein anderer Einsatz die Quelle hält', async () => {
    api.schalteDrohnenQuelleZu.mockRejectedValue(new ApiError(409, 'Konflikt'));
    renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten />);
    fireEvent.click(await screen.findByRole('button', { name: 'Suchlage zuschalten' }));
    expect(
      await screen.findByText('Bereits an einem anderen Einsatz zugeschaltet.'),
    ).toBeInTheDocument();
  });

  it('nennt eine Org ohne Drohnenquelle', async () => {
    api.loadDrohnenQuellen.mockResolvedValue([]);
    renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten />);
    expect(await screen.findByText('Keine Drohnenquelle eingerichtet.')).toBeInTheDocument();
  });

  it('bietet „Livebild“ bei einer zugeschalteten Quelle mit Videostrom, auch ohne Schaltrecht', async () => {
    api.loadDrohnenQuellen.mockResolvedValue([quelle({ connected: true, video_keys: ['k1'] })]);
    const onLivebild = vi.fn();
    renderMitProviders(
      <DrohnenQuelle einsatzId={7} darfSchalten={false} onLivebild={onLivebild} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Livebild' }));
    expect(onLivebild).toHaveBeenCalledWith('suchlage-1');
  });

  it('zeigt kein „Livebild“ ohne Videoschlüssel', async () => {
    api.loadDrohnenQuellen.mockResolvedValue([quelle({ connected: true, video_keys: [] })]);
    renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten onLivebild={vi.fn()} />);
    expect(await screen.findByText(/Zugeschaltet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Livebild' })).toBeNull();
  });
  describe('Schalter „Livebild auf dem Lagemonitor“ (LLH-2109)', () => {
    const AUS = 'Aus (Vorgabe): das Großbild zeigt kein Livebild.';
    const AN = 'Das Großbild zeigt das Livebild; Personen im Bild sind dort sichtbar.';

    it('schaltet das Livebild auf den Lagemonitor, Vorgabe aus', async () => {
      api.loadDrohnenQuellen.mockResolvedValue([quelle({ connected: true })]);
      api.schalteDrohnenQuelleZu.mockResolvedValue(quelle({ connected: true, lagemonitor: true }));
      renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten />);
      const schalter = await screen.findByRole('switch', { name: 'Livebild auf dem Lagemonitor' });
      expect(schalter).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByText(AUS)).toBeInTheDocument();
      fireEvent.click(schalter);
      await waitFor(() =>
        expect(api.schalteDrohnenQuelleZu).toHaveBeenCalledWith(7, 'suchlage-1', true),
      );
    });

    it('nennt eingeschaltet die Personen im Bild und schaltet wieder aus', async () => {
      api.loadDrohnenQuellen.mockResolvedValue([quelle({ connected: true, lagemonitor: true })]);
      api.schalteDrohnenQuelleZu.mockResolvedValue(quelle({ connected: true }));
      renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten />);
      const schalter = await screen.findByRole('switch', { name: 'Livebild auf dem Lagemonitor' });
      expect(schalter).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText(AN)).toBeInTheDocument();
      fireEvent.click(schalter);
      await waitFor(() =>
        expect(api.schalteDrohnenQuelleZu).toHaveBeenCalledWith(7, 'suchlage-1', false),
      );
    });

    it('zeigt ohne Schaltrecht nur den Zustand', async () => {
      api.loadDrohnenQuellen.mockResolvedValue([quelle({ connected: true, lagemonitor: true })]);
      renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten={false} />);
      expect(await screen.findByText(AN)).toBeInTheDocument();
      expect(screen.queryByRole('switch')).toBeNull();
    });

    it('fehlt an einer nicht zugeschalteten Quelle', async () => {
      renderMitProviders(<DrohnenQuelle einsatzId={7} darfSchalten />);
      expect(
        await screen.findByRole('button', { name: 'Suchlage zuschalten' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('switch')).toBeNull();
      expect(screen.queryByText(AUS)).toBeNull();
    });
  });
});
