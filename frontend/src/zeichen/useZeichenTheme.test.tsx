import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { ConfigProvider, theme } from 'antd';
import { describe, expect, it } from 'vitest';
import { antdToken, farbenDunkel } from '../theme/tokens';
import { useZeichenTheme } from './useZeichenTheme';
import { ZEICHEN_THEME_DUNKEL } from './zeichenTheme';

const nacht = ({ children }: { children: ReactNode }) => (
  <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: antdToken(farbenDunkel) }}>
    {children}
  </ConfigProvider>
);

// LLH-1409: Meldebild, Organigramm und Gefahrauswahl zeichnen nachts wie die Lagekarte mit dem
// Render-Theme `dark`; der Druck steht auf Papier und bleibt ohne Theme.
describe('useZeichenTheme (LLH-1409)', () => {
  it('nimmt nachts das Theme `dark`, am Tag keins', () => {
    expect(renderHook(() => useZeichenTheme(), { wrapper: nacht }).result.current).toBe(
      ZEICHEN_THEME_DUNKEL,
    );
    expect(renderHook(() => useZeichenTheme()).result.current).toBeUndefined();
  });

  it('nimmt im Druck kein Theme, auch nachts, und danach wieder `dark`', () => {
    const { result } = renderHook(() => useZeichenTheme(), { wrapper: nacht });
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(result.current).toBeUndefined();
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(result.current).toBe(ZEICHEN_THEME_DUNKEL);
  });
});
