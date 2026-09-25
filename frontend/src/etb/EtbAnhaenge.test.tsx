import { render, screen, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { describe, expect, it } from 'vitest';
import type { Anhang } from '../api/types';
import EtbAnhaenge from './EtbAnhaenge';

function anhang(over: Partial<Anhang> = {}): Anhang {
  return {
    id: 9,
    einsatz_id: 5,
    dateiname: 'IMG_0412.HEIC',
    mime: 'image/heic',
    groesse: 3_250_586,
    hochgeladen_von: 1,
    erstellt_at: '2026-09-25 10:00:00',
    ...over,
  };
}

describe('EtbAnhaenge (LFH-117)', () => {
  it('zeigt je Anhang einen Download-Verweis mit Name und Größe auf die ETB-Route', () => {
    render(
      <EtbAnhaenge
        einsatzId={5}
        eintrag={{
          id: 40,
          lfd_nr: 42,
          anhaenge: [anhang(), anhang({ id: 10, dateiname: 'fax.pdf', groesse: 2048 })],
        }}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/api/einsaetze/5/etb/40/anhaenge/9');
    expect(links[0]).toHaveAttribute('download');
    expect(links[0]).toHaveTextContent('IMG_0412.HEIC · 3.1 MB');
    expect(links[1]).toHaveTextContent('fax.pdf · 2.0 KB');
  });

  it('nennt im zugänglichen Namen die Nummer des Eintrags und die Handlung', () => {
    render(<EtbAnhaenge einsatzId={5} eintrag={{ id: 40, lfd_nr: 42, anhaenge: [anhang()] }} />);
    expect(
      screen.getByRole('link', { name: 'IMG_0412.HEIC, 3.1 MB, Anhang zu Nr. 42 herunterladen' }),
    ).toBeInTheDocument();
  });

  it('gibt gleichnamigen Dateien verschiedener Einträge verschiedene Namen', () => {
    render(
      <>
        <EtbAnhaenge
          einsatzId={5}
          eintrag={{ id: 4, lfd_nr: 4, anhaenge: [anhang({ id: 1, dateiname: 'IMG_0001.jpg' })] }}
        />
        <EtbAnhaenge
          einsatzId={5}
          eintrag={{ id: 9, lfd_nr: 9, anhaenge: [anhang({ id: 2, dateiname: 'IMG_0001.jpg' })] }}
        />
      </>,
    );
    const namen = screen.getAllByRole('link').map((l) => l.getAttribute('aria-label'));
    expect(namen[0]).toContain('Nr. 4');
    expect(namen[1]).toContain('Nr. 9');
    expect(new Set(namen).size).toBe(2);
  });

  it('rendert ohne Anhang nichts', () => {
    const { container } = render(
      <EtbAnhaenge einsatzId={5} eintrag={{ id: 40, lfd_nr: 42, anhaenge: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('trägt keine Ikone als eigenes Vorleseziel im Verweis', () => {
    render(<EtbAnhaenge einsatzId={5} eintrag={{ id: 40, lfd_nr: 42, anhaenge: [anhang()] }} />);
    expect(within(screen.getByRole('link')).queryByRole('img')).toBeNull();
  });

  it('nimmt die Mindesthöhe aus controlHeight der aktiven Dichtestufe', () => {
    // Geprüft wird der gesetzte Stil, nicht ein gerechnetes Layout (jsdom rechnet keins):
    // der Boden kommt aus `verweisStil(token)`, und der Token folgt der Dichtestufe.
    render(
      <ConfigProvider theme={{ token: { controlHeight: 72 } }}>
        <EtbAnhaenge einsatzId={5} eintrag={{ id: 40, lfd_nr: 42, anhaenge: [anhang()] }} />
      </ConfigProvider>,
    );
    expect(screen.getByRole('link')).toHaveStyle({ minHeight: '72px' });
  });
});
