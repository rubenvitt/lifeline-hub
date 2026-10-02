import { render, screen } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { describe, expect, it } from 'vitest';
import EtbDokumente, { type EtbDokument } from './EtbDokumente';

function dokument(over: Partial<EtbDokument> = {}): EtbDokument {
  return {
    id: 3,
    titel: 'Lageplan Nord',
    dateiname: 'plan.pdf',
    groesse: 2048,
    mime: 'application/pdf',
    ...over,
  };
}

describe('EtbDokumente (LFH-743)', () => {
  it('zeigt je Dokument einen Download-Verweis auf die modul-gegatete Dokument-Route', () => {
    render(
      <EtbDokumente
        einsatzId={5}
        lfdNr={42}
        dokumente={[dokument(), dokument({ id: 4, titel: 'Funkskizze', dateiname: 'f.png' })]}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/api/einsaetze/5/dokumente/3/datei');
    expect(links[0]).toHaveAttribute('download', 'plan.pdf');
    expect(links[0]).toHaveTextContent('Dokument „Lageplan Nord“ · 2.0 KB');
    expect(links[1]).toHaveAttribute('href', '/api/einsaetze/5/dokumente/4/datei');
  });

  it('nennt im zugänglichen Namen Titel, Nummer des Eintrags und die Handlung', () => {
    render(<EtbDokumente einsatzId={5} lfdNr={42} dokumente={[dokument()]} />);
    expect(
      screen.getByRole('link', {
        name: 'Dokument „Lageplan Nord“, 2.0 KB, zu Nr. 42 herunterladen',
      }),
    ).toBeInTheDocument();
  });

  it('rendert ohne Dokument nichts', () => {
    const { container } = render(<EtbDokumente einsatzId={5} lfdNr={42} dokumente={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('nimmt die Mindesthöhe aus controlHeight der aktiven Dichtestufe', () => {
    render(
      <ConfigProvider theme={{ token: { controlHeight: 72 } }}>
        <EtbDokumente einsatzId={5} lfdNr={42} dokumente={[dokument()]} />
      </ConfigProvider>,
    );
    expect(screen.getByRole('link')).toHaveStyle({ minHeight: '72px' });
  });

  describe('Original-Verweis (LFH-747)', () => {
    const foto = dokument({ id: 4, titel: 'Lagefoto', dateiname: 'lage.jpg', mime: 'image/jpeg' });

    it('steht mit darfOriginal hinter dem Foto, nicht hinter dem PDF', () => {
      render(<EtbDokumente einsatzId={5} lfdNr={42} dokumente={[dokument(), foto]} darfOriginal />);
      const original = screen.getByRole('link', {
        name: 'Dokument „Lagefoto“, zu Nr. 42: Original mit Standort- und Gerätedaten herunterladen',
      });
      expect(original).toHaveAttribute(
        'href',
        '/api/einsaetze/5/dokumente/4/datei?fassung=original',
      );
      expect(original).toHaveAttribute('download', 'lage.original.jpg');
      expect(screen.getAllByRole('link')).toHaveLength(3);
    });

    it('fehlt ohne darfOriginal', () => {
      render(<EtbDokumente einsatzId={5} lfdNr={42} dokumente={[foto]} />);
      expect(screen.getAllByRole('link')).toHaveLength(1);
    });
  });
});
