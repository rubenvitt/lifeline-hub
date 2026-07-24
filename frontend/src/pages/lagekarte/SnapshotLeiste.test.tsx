import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../../test/utils';
import { einsatzKeys } from '../../api/queryKeys';

const ladeLageSnapshots = vi.fn();
const erzeugeLageSnapshot = vi.fn();
const loescheLageSnapshot = vi.fn();
const ladeLageSnapshot = vi.fn();
vi.mock('../../api/lageSnapshot', () => ({
  ladeLageSnapshots: (...a: unknown[]) => ladeLageSnapshots(...a),
  erzeugeLageSnapshot: (...a: unknown[]) => erzeugeLageSnapshot(...a),
  loescheLageSnapshot: (...a: unknown[]) => loescheLageSnapshot(...a),
  ladeLageSnapshot: (...a: unknown[]) => ladeLageSnapshot(...a),
}));

import { SnapshotLeiste, ANZEIGE_MS } from './SnapshotLeiste';

type Snap = Record<string, unknown>;
function snapshot(over: Snap = {}): Snap {
  return {
    id: 7,
    einsatz_id: 5,
    bezeichnung: 'Stand A',
    notiz: null,
    stand_at: '2026-07-24T08:00:00Z',
    schema_version: 1,
    erstellt_von: 1,
    erstellt_at: '2026-07-24T08:00:00Z',
    ...over,
  };
}

/** Rendert mit vorbefülltem Cache (Liste synchron verfügbar → deterministisch, timer-freundlich). */
function renderLeiste(liste: Snap[], props: Record<string, unknown>) {
  const client = neuerQueryClient();
  client.setQueryData(einsatzKeys.lageSnapshot(5), liste);
  ladeLageSnapshots.mockResolvedValue(liste);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AntApp>{children}</AntApp>
    </QueryClientProvider>
  );
  return render(
    <SnapshotLeiste einsatzId={5} darfSichern={false} onWaehle={vi.fn()} fehler={vi.fn()} {...props} />,
    { wrapper: Wrapper },
  );
}

describe('SnapshotLeiste', () => {
  beforeEach(() => {
    ladeLageSnapshots.mockReset();
    erzeugeLageSnapshot.mockReset();
    ladeLageSnapshot.mockReset();
    ladeLageSnapshot.mockResolvedValue(snapshot());
  });
  afterEach(() => vi.useRealTimers());

  it('„Stand sichern" ruft erzeugeLageSnapshot mit der Bezeichnung', async () => {
    erzeugeLageSnapshot.mockResolvedValue(snapshot());
    renderLeiste([], { darfSichern: true });
    await userEvent.type(await screen.findByLabelText('Snapshot-Bezeichnung'), '08:00 Lage');
    await userEvent.click(screen.getByRole('button', { name: /Stand sichern/ }));
    await waitFor(() =>
      expect(erzeugeLageSnapshot).toHaveBeenCalledWith(5, { bezeichnung: '08:00 Lage' }),
    );
  });

  it('Klick auf einen Stand ruft onWaehle(id), „Aktuell" ruft onWaehle(null)', async () => {
    const onWaehle = vi.fn();
    renderLeiste([snapshot({ id: 7, bezeichnung: 'Stand A' })], { aktiverSnapshotId: 7, onWaehle });
    await userEvent.click(await screen.findByRole('button', { name: 'Stand A' }));
    expect(onWaehle).toHaveBeenCalledWith(7);
    await userEvent.click(screen.getByRole('button', { name: 'Aktuell' }));
    expect(onWaehle).toHaveBeenCalledWith(null);
  });

  it('rendert nichts ohne Schreibrecht und ohne Stände', () => {
    renderLeiste([], { darfSichern: false });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('Replay: Play springt auf den ältesten Stand und zeigt Pause; Zeitleisten-Slider vorhanden', async () => {
    const onWaehle = vi.fn();
    // Reihenfolge absichtlich neu→alt (wie das Backend liefert) — der Slider muss chronologisch sortieren.
    renderLeiste(
      [
        snapshot({ id: 20, bezeichnung: 'B', stand_at: '2026-07-24T09:00:00Z' }),
        snapshot({ id: 10, bezeichnung: 'A', stand_at: '2026-07-24T08:00:00Z' }),
      ],
      { onWaehle },
    );
    expect(screen.getByRole('slider')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abspielen' }));
    expect(onWaehle).toHaveBeenCalledWith(10); // ältester Stand chronologisch
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('Replay schreitet nach der Anzeigedauer zum nächsten Stand fort und lädt ihn vor', async () => {
    vi.useFakeTimers();
    const onWaehle = vi.fn();
    const { rerender } = renderLeiste(
      [
        snapshot({ id: 10, bezeichnung: 'A', stand_at: '2026-07-24T08:00:00Z' }),
        snapshot({ id: 20, bezeichnung: 'B', stand_at: '2026-07-24T09:00:00Z' }),
      ],
      { onWaehle },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Abspielen' }));
    expect(onWaehle).toHaveBeenCalledWith(10);

    // LagekartePage würde ?snapshot=10 setzen → Rerender mit aktivem Stand 10 (spielt bleibt an).
    rerender(
      <SnapshotLeiste einsatzId={5} darfSichern={false} aktiverSnapshotId={10} onWaehle={onWaehle} fehler={vi.fn()} />,
    );
    await vi.advanceTimersByTimeAsync(ANZEIGE_MS);
    expect(ladeLageSnapshot).toHaveBeenCalledWith(5, 20); // Vorladen des nächsten Dokuments
    expect(onWaehle).toHaveBeenLastCalledWith(20);
  });
});
