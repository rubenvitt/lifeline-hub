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
   * Der Fallback ohne `emptyText` (LFH-331 · B3) läuft über das Leer-Primitiv, nicht über antds
   * Leer-Element; der Titel ist „Keine Daten".
   *
   * Die zweite Zusicherung ist die tragende: der Text allein wäre unter dem antd-Element ebenfalls
   * grün (in Produktion — im Test ohne Locale wäre er englisch).
   */
  it('nutzt ohne emptyText das Leer-Primitiv, nicht antds Leer-Element', () => {
    const { container } = renderMitProviders(
      <Liste dataSource={[]} renderItem={(t: string) => <ListenEintrag>{t}</ListenEintrag>} />,
    );
    expect(screen.getByText('Keine Daten')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
  });

  it('rendert Aktionen ohne eine Anzeigezeile klickbar zu machen', async () => {
    const user = userEvent.setup();
    const onAktion = vi.fn();
    renderMitProviders(
      <Liste
        dataSource={['Eintrag']}
        renderItem={(t) => (
          <ListenEintrag
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
    expect(screen.queryByRole('button', { name: 'Eintrag' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aktion' }));
    expect(onAktion).toHaveBeenCalledTimes(1);
  });

  it('rendert eine Auswahlzeile über das Klickbar-Primitiv', async () => {
    const user = userEvent.setup();
    const onKlick = vi.fn();
    renderMitProviders(
      <Liste
        dataSource={['Eintrag']}
        renderItem={(t) => <ListenEintrag onClick={onKlick}>{t}</ListenEintrag>}
      />,
    );

    const zeile = screen.getByRole('button', { name: 'Eintrag' });
    zeile.focus();
    await user.keyboard('{Enter}');

    expect(onKlick).toHaveBeenCalledTimes(1);
  });

  // LFH-621: `aria-current` gehört an das Element mit der Rolle, nicht an ein inneres `div`, sonst
  // sagt der Vorleser „Schaltfläche" ohne „aktuell". Beide Zweige: Auswahl- und Anzeigezeile.
  it('reicht aria-current an das Wurzelelement der Zeile durch', () => {
    renderMitProviders(
      <Liste
        dataSource={['A', 'B']}
        renderItem={(t) => (
          <ListenEintrag onClick={vi.fn()} aria-current={t === 'B' ? 'true' : undefined}>
            {t}
          </ListenEintrag>
        )}
      />,
    );
    expect(screen.getByRole('button', { current: true })).toHaveAccessibleName('B');
    expect(screen.getByRole('button', { name: 'A' })).not.toHaveAttribute('aria-current');

    renderMitProviders(
      <Liste
        dataSource={['C']}
        renderItem={(t) => <ListenEintrag aria-current="page">{t}</ListenEintrag>}
      />,
    );
    expect(screen.getByText('C').closest('.listen-eintrag')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('rendert Einträge als list/listitem (Screenreader-Semantik wie antds List)', () => {
    renderMitProviders(
      <Liste dataSource={['A', 'B']} renderItem={(t) => <ListenEintrag>{t}</ListenEintrag>} />,
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
 * Gruppenkopf als Überschrift (LFH-470): ein Vorleser springt zwischen Überschriften, nicht
 * zwischen Divs. Die Ebene kennt nur der Einbauort — deshalb `unterEbene` wie bei `Markdown`.
 */
describe('Liste — Kopf ist eine Überschrift und benennt die Liste', () => {
  it('rendert den Kopf als Überschrift eine Ebene unter `unterEbene`', () => {
    renderMitProviders(
      <Liste
        kopf={{ inhalt: 'Unfallhilfsstelle (2)', unterEbene: 2 }}
        dataSource={['A', 'B']}
        renderItem={(t) => <ListenEintrag>{t}</ListenEintrag>}
      />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Unfallhilfsstelle (2)' })).toBeVisible();
  });

  it('folgt dem Einbauort, statt eine feste Ebene zu setzen', () => {
    renderMitProviders(
      <Liste
        kopf={{ inhalt: 'Entwürfe', unterEbene: 5 }}
        dataSource={['A']}
        renderItem={(t) => <ListenEintrag>{t}</ListenEintrag>}
      />,
    );
    expect(screen.getByRole('heading', { level: 6, name: 'Entwürfe' })).toBeVisible();
  });

  it('verbindet die Liste per aria-labelledby mit ihrem Kopf', () => {
    renderMitProviders(
      <Liste
        kopf={{ inhalt: 'Unfallhilfsstelle (2)', unterEbene: 2 }}
        dataSource={['A', 'B']}
        renderItem={(t) => <ListenEintrag>{t}</ListenEintrag>}
      />,
    );
    const liste = screen.getByRole('list', { name: 'Unfallhilfsstelle (2)' });
    const kopf = screen.getByRole('heading', { name: 'Unfallhilfsstelle (2)' });
    expect(liste.getAttribute('aria-labelledby')).toBe(kopf.id);
  });

  it('ohne Kopf: weder Überschrift noch Verweis', () => {
    renderMitProviders(
      <Liste dataSource={['A']} renderItem={(t) => <ListenEintrag>{t}</ListenEintrag>} />,
    );
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('list').hasAttribute('aria-labelledby')).toBe(false);
  });

  it('ein Kopf ohne Inhalt ist keiner: weder leere Überschrift noch leerer Listenname', () => {
    renderMitProviders(
      <Liste
        kopf={{ inhalt: null, unterEbene: 2 }}
        dataSource={['A']}
        renderItem={(t) => <ListenEintrag>{t}</ListenEintrag>}
      />,
    );
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('list').hasAttribute('aria-labelledby')).toBe(false);
  });

  it('bei leerer Menge bleibt der Kopf, ein Verweis ins Leere entsteht nicht', () => {
    const { container } = renderMitProviders(
      <Liste
        kopf={{ inhalt: 'Entwürfe', unterEbene: 1 }}
        dataSource={[]}
        emptyText="Keine Entwürfe"
        renderItem={(t: string) => <ListenEintrag>{t}</ListenEintrag>}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Entwürfe' })).toBeVisible();
    expect(screen.queryByRole('list')).toBeNull();
    expect(container.querySelector('[aria-labelledby]')).toBeNull();
  });
});

/**
 * Eintragstitel (LFH-826, Spec `ueberschriften-gliederung`): die Ebene kommt vom Einbauort der
 * Liste — unter dem Kopf eine darunter, ohne Kopf aus `unterEbene`, ohne beides keine
 * Überschrift. Eine fest verdrahtete Ebene fiele in mindestens einem der Fälle durch.
 */
describe('Liste — Eintragstitel folgt dem Einbauort', () => {
  const metaEintrag = () => (
    <ListenEintrag>
      <ListenEintragMeta title="S4 · Versorgung" description="Beschreibung" />
    </ListenEintrag>
  );

  it('unter einem Kopf h3 ist der Eintragstitel h4', () => {
    renderMitProviders(
      <Liste
        kopf={{ inhalt: 'Kopf', unterEbene: 2 }}
        dataSource={['x']}
        renderItem={metaEintrag}
      />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Kopf' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 4, name: 'S4 · Versorgung' })).toBeVisible();
  });

  it('unter einem Kopf h6 bleibt der Eintragstitel bei h6, nie über dem Kopf', () => {
    renderMitProviders(
      <Liste
        kopf={{ inhalt: 'Kopf', unterEbene: 5 }}
        dataSource={['x']}
        renderItem={metaEintrag}
      />,
    );
    expect(screen.getByRole('heading', { level: 6, name: 'S4 · Versorgung' })).toBeVisible();
  });

  it('ohne Kopf folgt er `unterEbene` (eine Ebene darunter)', () => {
    renderMitProviders(<Liste unterEbene={2} dataSource={['x']} renderItem={metaEintrag} />);
    expect(screen.getByRole('heading', { level: 3, name: 'S4 · Versorgung' })).toBeVisible();
  });

  it('ohne Kopf und ohne `unterEbene` ist er keine Überschrift, bleibt aber sichtbar', () => {
    renderMitProviders(<Liste dataSource={['x']} renderItem={metaEintrag} />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('S4 · Versorgung')).toBeVisible();
  });

  it('ein Kopf ohne Inhalt zählt nicht: keine Überschrift', () => {
    renderMitProviders(
      <Liste kopf={{ inhalt: null, unterEbene: 2 }} dataSource={['x']} renderItem={metaEintrag} />,
    );
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('außerhalb einer Liste ist er keine Überschrift', () => {
    renderMitProviders(<ListenEintragMeta title="Lose" />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('Lose')).toBeVisible();
  });

  /**
   * Gewicht, Größe und Abstand stehen inline und gleich — sonst sähe der Titel ohne Überschrift
   * dünner aus als der mit (das Gewicht kam früher aus der h4-Kaskade).
   */
  it('sieht als Überschrift und als Text gleich aus', () => {
    const { unmount } = render(
      <Liste unterEbene={2} dataSource={['x']} renderItem={metaEintrag} />,
    );
    const alsUeberschrift = screen.getByText('S4 · Versorgung').getAttribute('style');
    unmount();
    render(<Liste dataSource={['x']} renderItem={metaEintrag} />);
    const alsText = screen.getByText('S4 · Versorgung');
    expect(alsText.getAttribute('style')).toBe(alsUeberschrift);
    expect(alsText.style.fontWeight).toBe('600');
  });

  it('Kopf und `unterEbene` schließen sich per Typ aus', () => {
    renderMitProviders(
      <Liste
        // @ts-expect-error — zwei Quellen für dieselbe Ebene sind verboten (design.md D1).
        kopf={{ inhalt: 'Kopf', unterEbene: 2 }}
        unterEbene={2}
        dataSource={['x']}
        renderItem={metaEintrag}
      />,
    );
    expect(screen.getByRole('heading', { level: 4, name: 'S4 · Versorgung' })).toBeVisible();
  });
});

/**
 * Innenabstände (LFH-328/T14): zieht `Liste` bei einer Dichteumschaltung nicht mit, bleibt die
 * Dichte-Staffel in ihren Masken folgenlos.
 *
 * Die Zahl kommt NICHT aus dem Token (das prüfte den Token gegen sich selbst); belegt wird:
 *  1. unter dem **antd-Standardtheme** stehen 16 (klein) / 24 (default);
 *  2. unter `antdToken(farbenHell, 'handschuh')` **bewegen** sie sich, in beiden Größen. Ein
 *     hartkodiertes Pixel bliebe stehen.
 * jsdom rechnet kein Layout, gibt Inline-Styles aber zurück — das genügt.
 */
function abstaende(size: 'small' | 'default', dichte?: Dichte) {
  const { container, unmount } = render(
    <ConfigProvider theme={dichte ? { token: antdToken(farbenHell, dichte) } : undefined}>
      <Liste
        size={size}
        bordered
        kopf={{ inhalt: <span>Kopf</span>, unterEbene: 2 }}
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
      // Waagerecht.
      expect(handschuh.kopfInline).not.toBe(kompakt.kopfInline);
      expect(handschuh.eintragInline).not.toBe(kompakt.eintragInline);
      // Senkrecht: `paddingContentVertical*` ist in diesem Theme genauso eingefroren wie die
      // waagerechte Variante — sonst wäre die Komponente nur halb dichteabhängig.
      expect(handschuh.kopfBlock).not.toBe(kompakt.kopfBlock);
      expect(handschuh.eintragBlock).not.toBe(kompakt.eintragBlock);
    }
  });
});
