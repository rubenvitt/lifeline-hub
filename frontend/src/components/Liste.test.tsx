import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { antdToken, farbenHell, type Dichte } from '../theme/tokens';
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

  /**
   * Der Fallback ohne `emptyText` (LFH-331 · B3). Er läuft jetzt über das Leer-Primitiv
   * statt über antds Leer-Element; der Titel bleibt „Keine Daten", weil genau das die
   * zehn Masken in Produktion (`ConfigProvider locale={deDE}`) heute schon zeigen —
   * der Umbau ist am Wortlaut folgenlos, nur der Knoten wechselt.
   *
   * Die zweite Zusicherung ist die tragende: der Text allein wäre unter dem antd-Element
   * ebenfalls grün (in Produktion — im Test ohne Locale wäre er englisch).
   */
  it('nutzt ohne emptyText das Leer-Primitiv, nicht antds Leer-Element', () => {
    const { container } = renderMitProviders(
      <Liste dataSource={[]} renderItem={(t: string) => <ListenEintrag>{t}</ListenEintrag>} />,
    );
    expect(screen.getByText('Keine Daten')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
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

/**
 * Innenabstände (LFH-328/T14). `Liste` versorgt 10 Masken — zieht sie bei einer
 * Dichteumschaltung (B5) nicht mit, bleibt die Dichte-Staffel folgenlos.
 *
 * Der Test liest die Zahl NICHT aus dem Token (das prüfte den Token gegen sich
 * selbst), sondern belegt zweierlei:
 *  1. unter dem **antd-Standardtheme** bleiben die Werte byte-gleich zu vorher
 *     (16 klein / 24 default) — die 10 Masken sehen unverändert aus;
 *  2. unter `antdToken(farbenHell, 'handschuh')` **bewegen** sie sich, und zwar
 *     in beiden Größen. Ein hartkodiertes Pixel bliebe hier stehen.
 * jsdom rechnet kein Layout, gibt Inline-Styles aber zurück — das genügt.
 */
function abstaende(size: 'small' | 'default', dichte?: Dichte) {
  const { container, unmount } = render(
    <ConfigProvider theme={dichte ? { token: antdToken(farbenHell, dichte) } : undefined}>
      <Liste
        size={size}
        bordered
        header={<span>Kopf</span>}
        dataSource={['A']}
        renderItem={(t) => <ListenEintrag>{t}</ListenEintrag>}
      />
    </ConfigProvider>,
  );
  const kopf = container.firstElementChild?.firstElementChild as HTMLElement;
  const eintrag = container.querySelector('.listen-eintrag') as HTMLElement;
  const werte = {
    kopfInline: kopf.style.paddingLeft,
    kopfBlock: kopf.style.paddingTop,
    eintragInline: eintrag.style.getPropertyValue('padding-inline'),
    eintragBlock: eintrag.style.getPropertyValue('padding-block'),
  };
  unmount();
  return werte;
}

describe('Liste — Innenabstände folgen der Dichte', () => {
  it('bleibt unter dem antd-Standardtheme bei den bisherigen Werten (16 / 24)', () => {
    expect(abstaende('small').kopfInline).toBe('16px');
    expect(abstaende('small').eintragInline).toBe('16px');
    expect(abstaende('default').kopfInline).toBe('24px');
    expect(abstaende('default').eintragInline).toBe('24px');
  });

  it('unterscheidet small und default auch in einer anderen Dichtestufe', () => {
    const klein = abstaende('small', 'handschuh');
    const gross = abstaende('default', 'handschuh');
    expect(klein.kopfInline).not.toBe(gross.kopfInline);
    expect(klein.eintragInline).not.toBe(gross.eintragInline);
  });

  it('zieht bei einer Dichteumschaltung mit (kein hartkodiertes Pixel)', () => {
    for (const size of ['small', 'default'] as const) {
      const kompakt = abstaende(size, 'kompakt');
      const handschuh = abstaende(size, 'handschuh');
      // Waagerecht: die beiden Zeilen aus T14.
      expect(handschuh.kopfInline).not.toBe(kompakt.kopfInline);
      expect(handschuh.eintragInline).not.toBe(kompakt.eintragInline);
      // Senkrecht: `paddingContentVertical*` ist in diesem Theme genauso
      // eingefroren wie die waagerechte Variante — mitgezogen, sonst wäre die
      // Komponente nur halb dichteabhängig.
      expect(handschuh.kopfBlock).not.toBe(kompakt.kopfBlock);
      expect(handschuh.eintragBlock).not.toBe(kompakt.eintragBlock);
    }
  });
});
