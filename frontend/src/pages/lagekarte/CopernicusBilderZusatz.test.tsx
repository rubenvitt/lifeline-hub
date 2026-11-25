import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import CopernicusBilderZusatz, { type CopernicusBilderZusatzProps } from './CopernicusBilderZusatz';
import type { CopernicusBild } from './fachebenen';

const bild = (mehr: Partial<CopernicusBild> = {}): CopernicusBild => ({
  bild: 'aaaaaaaaaaaaaaaa',
  emsr: 'EMSR728',
  gebiet: 'Bogen',
  sensor: 'Pleiades',
  aufnahme: '2024-06-10 10:13:00',
  minZoom: 10,
  maxZoom: 16,
  bounds: [12.6, 48.8, 12.7, 48.9],
  darstellbar: true,
  gekuerzt: false,
  ...mehr,
});

const zeige = (props: Partial<CopernicusBilderZusatzProps> = {}) =>
  renderMitProviders(
    <CopernicusBilderZusatz
      status="ok"
      liste={[bild()]}
      deckkraft={80}
      onDeckkraft={() => {}}
      archiv={false}
      onArchiv={() => {}}
      archivHier={false}
      {...props}
    />,
  );

describe('CopernicusBilderZusatz (LLH-2021)', () => {
  it('sagt bei leer, dass es keine Bilder im Ausschnitt gibt', () => {
    zeige({ status: 'leer', liste: [] });
    expect(screen.getByText(/Keine Satellitenbilder im Ausschnitt/)).toBeInTheDocument();
  });

  it('nennt je Bild EMSR-Nummer, Gebiet, Sensor und Aufnahme als DTG', () => {
    zeige();
    const liste = screen.getByRole('list', { name: /Satellitenbilder im Ausschnitt/ });
    expect(within(liste).getByRole('listitem')).toHaveTextContent(
      /^EMSR728 · Bogen · Pleiades · \d{6}/,
    );
  });

  it('sagt „Sensor unbekannt“ ohne Sensor und lässt die Aufnahme weg, wenn sie fehlt', () => {
    zeige({ liste: [bild({ sensor: undefined, aufnahme: undefined })] });
    expect(screen.getByRole('listitem')).toHaveTextContent('EMSR728 · Bogen · Sensor unbekannt');
  });

  it('markiert eine Aufnahme, die älter als 24 h ist', () => {
    zeige();
    const marke = screen.getByText(/Satellitenaufnahme vom/);
    expect(marke.closest('[data-lfh="copernicus-bilder-alt"]')).not.toBeNull();
  });

  it('zeigt ein nicht darstellbares Bild als solches', () => {
    zeige({ liste: [bild({ darstellbar: false })] });
    expect(screen.getByRole('listitem')).toHaveTextContent('nicht darstellbar');
  });

  it('bittet bei einer gekürzten Antwort, weiter hineinzuzoomen', () => {
    zeige({ liste: [bild({ gekuerzt: true })] });
    expect(screen.getByText(/weiter hineinzoomen/)).toBeInTheDocument();
  });

  it('stellt die Deckkraft über einen Regler ein', () => {
    const onDeckkraft = vi.fn();
    zeige({ onDeckkraft });
    const regler = screen.getByRole('slider', { name: /Deckkraft/ });
    expect(regler).toHaveAttribute('aria-valuenow', '80');
    fireEvent.keyDown(regler, { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 });
    expect(onDeckkraft).toHaveBeenCalled();
    expect(onDeckkraft.mock.calls[0][0]).toBeLessThan(80);
  });

  it('zeigt den Archiv-Schalter nur, wenn die Vektorebene aus ist', () => {
    const { unmount } = zeige({ archivHier: false });
    expect(screen.queryByRole('checkbox', { name: /Ältere Aktivierungen/ })).toBeNull();
    unmount();
    const onArchiv = vi.fn();
    zeige({ archivHier: true, onArchiv });
    fireEvent.click(screen.getByRole('checkbox', { name: /Ältere Aktivierungen/ }));
    expect(onArchiv).toHaveBeenCalledWith(true);
  });
});
