import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../../test/utils';

const ladeLageSnapshots = vi.fn();
const erzeugeLageSnapshot = vi.fn();
const loescheLageSnapshot = vi.fn();
vi.mock('../../api/lageSnapshot', () => ({
  ladeLageSnapshots: (...a: unknown[]) => ladeLageSnapshots(...a),
  erzeugeLageSnapshot: (...a: unknown[]) => erzeugeLageSnapshot(...a),
  loescheLageSnapshot: (...a: unknown[]) => loescheLageSnapshot(...a),
}));

import { SnapshotLeiste } from './SnapshotLeiste';

function wrapper() {
  const client = neuerQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AntApp>{children}</AntApp>
    </QueryClientProvider>
  );
}

function snapshot(over: Record<string, unknown> = {}) {
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

describe('SnapshotLeiste', () => {
  beforeEach(() => {
    ladeLageSnapshots.mockReset();
    erzeugeLageSnapshot.mockReset();
  });

  it('„Stand sichern" ruft erzeugeLageSnapshot mit der Bezeichnung', async () => {
    ladeLageSnapshots.mockResolvedValue([]);
    erzeugeLageSnapshot.mockResolvedValue(snapshot());
    render(<SnapshotLeiste einsatzId={5} darfSichern onWaehle={vi.fn()} fehler={vi.fn()} />, {
      wrapper: wrapper(),
    });
    await userEvent.type(await screen.findByLabelText('Snapshot-Bezeichnung'), '08:00 Lage');
    await userEvent.click(screen.getByRole('button', { name: /Stand sichern/ }));
    await waitFor(() =>
      expect(erzeugeLageSnapshot).toHaveBeenCalledWith(5, { bezeichnung: '08:00 Lage' }),
    );
  });

  it('Klick auf einen Stand ruft onWaehle(id), „Aktuell" ruft onWaehle(null)', async () => {
    ladeLageSnapshots.mockResolvedValue([snapshot({ id: 7, bezeichnung: 'Stand A' })]);
    const onWaehle = vi.fn();
    render(
      <SnapshotLeiste
        einsatzId={5}
        darfSichern={false}
        aktiverSnapshotId={7}
        onWaehle={onWaehle}
        fehler={vi.fn()}
      />,
      { wrapper: wrapper() },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Stand A' }));
    expect(onWaehle).toHaveBeenCalledWith(7);
    await userEvent.click(screen.getByRole('button', { name: 'Aktuell' }));
    expect(onWaehle).toHaveBeenCalledWith(null);
  });

  it('rendert nichts ohne Schreibrecht und ohne Stände', async () => {
    ladeLageSnapshots.mockResolvedValue([]);
    render(<SnapshotLeiste einsatzId={5} darfSichern={false} onWaehle={vi.fn()} fehler={vi.fn()} />, {
      wrapper: wrapper(),
    });
    // Die Liste lädt (leer) — danach gibt es weder „Stand sichern" noch „Aktuell".
    await waitFor(() => expect(ladeLageSnapshots).toHaveBeenCalled());
    expect(screen.queryByRole('button')).toBeNull();
  });
});
