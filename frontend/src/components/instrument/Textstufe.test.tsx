import { render, screen } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { farbenDunkel, farbenHell } from '../../theme/tokens';
import Textstufe from './Textstufe';

describe('Textstufe (Spec `schriftstufen`)', () => {
  it('setzt ohne Angabe die Stufe `text` im Ton `text` als span', () => {
    renderMitProviders(<Textstufe>Fahrzeug steht bereit</Textstufe>);
    const el = screen.getByText('Fahrzeug steht bereit');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveStyle({ fontSize: '14px', fontWeight: '400', color: farbenHell.text });
  });

  it('setzt den Kartentitel 15/600', () => {
    renderMitProviders(<Textstufe stufe="kartentitel">RTW 1/83-1</Textstufe>);
    expect(screen.getByText('RTW 1/83-1')).toHaveStyle({ fontSize: '15px', fontWeight: '600' });
  });

  it('setzt Sperrung und Versalien der Stufe, ohne den Wortlaut zu ändern', () => {
    renderMitProviders(<Textstufe stufe="augenbraue">Funk</Textstufe>);
    const el = screen.getByText('Funk');
    expect(el.style.letterSpacing).toBe('0.08em');
    expect(el.style.textTransform).toBe('uppercase');
    expect(el.textContent).toBe('Funk');
  });

  it('gibt der Zahlenfamilie gleich breite Ziffern', () => {
    renderMitProviders(<Textstufe stufe="meta">14:32</Textstufe>);
    const el = screen.getByText('14:32');
    expect(el.style.fontFamily).toContain('LFH JetBrains Mono');
    expect(el.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it.each([
    ['text2', farbenHell.text2],
    ['gedaempft', farbenHell.gedaempft],
    ['schwach', farbenHell.schwach],
    ['alarm', farbenHell.alarmText],
  ] as const)('färbt den Ton %s mit der Rolle des Tagmodus', (ton, farbe) => {
    renderMitProviders(<Textstufe ton={ton}>Hinweis</Textstufe>);
    expect(screen.getByText('Hinweis')).toHaveStyle({ color: farbe });
  });

  it('färbt im Nachtmodus mit der Rolle des Nachtmodus', () => {
    render(
      <ConfigProvider theme={{ token: { colorBgBase: '#08090b' } }}>
        <Textstufe ton="gedaempft">Nacht</Textstufe>
      </ConfigProvider>,
    );
    expect(screen.getByText('Nacht')).toHaveStyle({ color: farbenDunkel.gedaempft });
  });

  it('wird mit `als` zur Überschrift, ohne die Optik zu ändern', () => {
    renderMitProviders(
      <Textstufe stufe="kartentitel" als="h3">
        Wache Nord
      </Textstufe>,
    );
    const h = screen.getByRole('heading', { level: 3, name: 'Wache Nord' });
    expect(h).toHaveStyle({ fontSize: '15px', fontWeight: '600', margin: '0px' });
  });

  it('bricht mit `umbruch="ueberall"` auch lange Wörter um', () => {
    renderMitProviders(<Textstufe umbruch="ueberall">Rettungswagenbesatzung</Textstufe>);
    expect(screen.getByText('Rettungswagenbesatzung')).toHaveStyle({ overflowWrap: 'anywhere' });
  });

  it('nimmt keine freie Größe und keinen Stil an', () => {
    // @ts-expect-error — eine Zahl ist keine Stufe der Skala
    void (<Textstufe stufe={13}>x</Textstufe>);
    // @ts-expect-error — kein `style`: die Größe kommt nur aus der Stufe
    void (<Textstufe style={{ fontSize: 13 }}>x</Textstufe>);
  });
});
