import { ConfigProvider, theme } from 'antd';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { antdToken, farbenDunkel, farbenHell } from '../theme/tokens';
import SichtungsTag from './SichtungsTag';

describe('SichtungsTag', () => {
  it.each(['light', 'dark'] as const)(
    '%s: Schwarz bleibt Kennzeichnung, Text bleibt lesbar',
    (modus) => {
      const config = {
        algorithm: modus === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: antdToken(modus === 'dark' ? farbenDunkel : farbenHell),
      };
      renderMitProviders(
        <ConfigProvider theme={config}>
          <SichtungsTag kategorie="tot" />
        </ConfigProvider>,
      );
      const tag = screen.getByText('tot');
      expect(tag).toHaveStyle({
        color: modus === 'dark' ? '#dee5ec' : '#10161e',
        background: 'transparent',
      });
      const farbfeld = tag.querySelector('[aria-hidden="true"]');
      expect(farbfeld).toHaveStyle({
        background: '#000000',
        borderColor: modus === 'dark' ? '#dee5ec' : '#10161e',
      });
      expect(tag.className).not.toMatch(/ant-tag-(black|default)/);
    },
  );
  it('unverletzt bekommt keine erfundene Fachfarbe und Zähler 0 bleibt sichtbar', () => {
    renderMitProviders(<SichtungsTag kategorie="unverletzt" anzahl={0} />);
    const tag = screen.getByText('unverletzt: 0');
    expect(tag.querySelector('[aria-hidden]')).toBeNull();
  });
});
