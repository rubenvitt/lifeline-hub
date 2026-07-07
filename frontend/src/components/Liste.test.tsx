import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { Liste, ListenEintrag, ListenEintragMeta } from './Liste';

describe('Liste', () => {
  it('rendert je dataSource-Eintrag ein Item', () => {
    renderMitProviders(
      <Liste
        dataSource={['Alpha', 'Bravo', 'Charlie']}
        renderItem={(t) => <ListenEintrag>{t}</ListenEintrag>}
      />,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('zeigt den Leer-Zustand (emptyText) bei leerer dataSource', () => {
    renderMitProviders(
      <Liste
        dataSource={[]}
        emptyText="Noch nichts da"
        renderItem={(t: string) => <ListenEintrag>{t}</ListenEintrag>}
      />,
    );
    expect(screen.getByText('Noch nichts da')).toBeInTheDocument();
  });

  it('rendert Aktionen und feuert onClick am Eintrag', async () => {
    const user = userEvent.setup();
    const onKlick = vi.fn();
    const onAktion = vi.fn();
    renderMitProviders(
      <Liste
        dataSource={['Eintrag']}
        renderItem={(t) => (
          <ListenEintrag
            onClick={onKlick}
            actions={[
              <button key="a" onClick={onAktion}>
                Aktion
              </button>,
            ]}
          >
            {t}
          </ListenEintrag>
        )}
      />,
    );
    await user.click(screen.getByText('Eintrag'));
    expect(onKlick).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Aktion' }));
    expect(onAktion).toHaveBeenCalledTimes(1);
  });

  it('rendert Einträge als list/listitem (Screenreader-Semantik wie antds List)', () => {
    renderMitProviders(
      <Liste
        dataSource={['A', 'B']}
        renderItem={(t) => <ListenEintrag>{t}</ListenEintrag>}
      />,
    );
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('unterdrückt den Leer-Zustand während loading (kein Empty-Aufblitzen)', () => {
    const { rerender } = renderMitProviders(
      <Liste
        dataSource={[]}
        loading
        emptyText="Noch nichts da"
        renderItem={(t: string) => <ListenEintrag>{t}</ListenEintrag>}
      />,
    );
    // Während loading: kein Leer-Text.
    expect(screen.queryByText('Noch nichts da')).not.toBeInTheDocument();
    // Nach loading (weiterhin leer): Leer-Text erscheint.
    rerender(
      <Liste
        dataSource={[]}
        loading={false}
        emptyText="Noch nichts da"
        renderItem={(t: string) => <ListenEintrag>{t}</ListenEintrag>}
      />,
    );
    expect(screen.getByText('Noch nichts da')).toBeInTheDocument();
  });

  it('stellt Titel und Beschreibung über ListenEintragMeta dar', () => {
    renderMitProviders(
      <Liste
        dataSource={['x']}
        renderItem={() => (
          <ListenEintrag>
            <ListenEintragMeta title="Der Titel" description="Die Beschreibung" />
          </ListenEintrag>
        )}
      />,
    );
    expect(screen.getByText('Der Titel')).toBeInTheDocument();
    expect(screen.getByText('Die Beschreibung')).toBeInTheDocument();
  });
});
