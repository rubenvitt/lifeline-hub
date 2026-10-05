import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import type { CSSProperties } from 'react';
import { MemoryRouter } from 'react-router';
import { antdToken, dichten, farbenHell, type Dichte } from '../theme/tokens';
import { KennungsLink, kennungsLinkStil } from './kennungsLink';

/**
 * Ein `<a>` erbt KEINE Steuerhöhe (LFH-908): der Kennungs-Link einer Tabellen- oder Listenzeile
 * maß im Handschuh 13–17 px. Geprüft wird der Inline-Stil der reinen Funktion über die
 * Dichtestufen (jsdom rechnet kein Layout; die Messung steht in
 * `e2e/verwaltung-vereinheitlicht.spec.ts` und `e2e/trefflaeche-pruefflaechen.spec.ts`). Die
 * Böden stehen als LITERALE da, sonst prüften sie den Token gegen sich selbst.
 */
describe('kennungsLinkStil', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(kennungsLinkStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(kennungsLinkStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(kennungsLinkStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  it('steht inline in der Zelle und mittet den Text im Boden', () => {
    const stil = kennungsLinkStil(tokenFuer('handschuh'));
    expect(stil.display).toBe('inline-flex');
    expect(stil.alignItems).toBe('center');
  });

  it('legt KEINE eigene senkrechte Polsterung an: sie höbe den Link über die Zeilenknöpfe', () => {
    const stil = kennungsLinkStil(tokenFuer('handschuh'));
    expect(stil.padding).toBeUndefined();
    expect(stil.paddingBlock).toBeUndefined();
    expect(stil.paddingTop).toBeUndefined();
    expect(stil.paddingBottom).toBeUndefined();
  });
});

/**
 * Der Baustein liest das Token der Stufe selbst. Gerendert unter dem Token der jeweiligen Stufe,
 * nicht unter `renderMitProviders`: dessen nacktes `ConfigProvider` liefert nur antd-Vorgaben.
 */
describe('KennungsLink', () => {
  function linkStil(dichte: Dichte, style?: CSSProperties, klein?: boolean) {
    const { unmount } = render(
      <ConfigProvider theme={{ token: antdToken(farbenHell, dichte) }}>
        <MemoryRouter>
          <KennungsLink to="/ziel" style={style} klein={klein}>
            Florian 1
          </KennungsLink>
        </MemoryRouter>
      </ConfigProvider>,
    );
    const link = screen.getByRole('link', { name: 'Florian 1' });
    const stil = { minHeight: link.style.minHeight, fontWeight: link.style.fontWeight };
    expect(link.getAttribute('href')).toBe('/ziel');
    unmount();
    return stil;
  }

  it('trägt den Boden der Stufe: 30 in kompakt, 72 im Handschuh', () => {
    expect(linkStil('kompakt').minHeight).toBe('30px');
    expect(linkStil('handschuh').minHeight).toBe('72px');
  });

  it('trägt im Baum (`klein`) die kleine Steuerhöhe: 24 in kompakt, 72 im Handschuh', () => {
    expect(linkStil('kompakt', undefined, true).minHeight).toBe('24px');
    expect(linkStil('handschuh', undefined, true).minHeight).toBe('72px');
  });

  /**
   * Als Flex-Kind wäre ein `Tag` blockifiziert und erbte die Hover-Unterstreichung des Links. In
   * der Hülle bleibt er ein atomares Inline-Element, das keine Unterstreichung erbt.
   */
  it('hüllt den Inhalt in genau ein Flex-Kind', () => {
    render(
      <ConfigProvider theme={{ token: antdToken(farbenHell, 'handschuh') }}>
        <MemoryRouter>
          <KennungsLink to="/ziel">
            <span data-testid="marke">R-0001</span>
          </KennungsLink>
        </MemoryRouter>
      </ConfigProvider>,
    );
    const link = screen.getByRole('link', { name: 'R-0001' });
    expect(link.children).toHaveLength(1);
    expect(link.firstElementChild).not.toBe(screen.getByTestId('marke'));
    expect(link.firstElementChild?.contains(screen.getByTestId('marke'))).toBe(true);
  });

  it('legt einen übergebenen Stil darüber, ohne den Boden zu verlieren', () => {
    const stil = linkStil('handschuh', { fontWeight: 600 });
    expect(stil.fontWeight).toBe('600');
    expect(stil.minHeight).toBe('72px');
  });
});
