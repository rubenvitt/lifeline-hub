import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import CopernicusZusatz from './CopernicusZusatz';

describe('CopernicusZusatz (LLH-1200)', () => {
  it('sagt bei leer, dass nichts ausgewertet ist, und verweist auf ältere Aktivierungen', () => {
    renderMitProviders(
      <CopernicusZusatz status="leer" archiv={false} onArchiv={() => {}} aktivierungen={[]} />,
    );
    expect(screen.getByText(/Keine Copernicus-Auswertung im Ausschnitt/)).toHaveTextContent(
      /ältere Aktivierungen sind ausgeblendet/,
    );
  });

  it('nennt mit Archiv keinen Verweis mehr', () => {
    renderMitProviders(
      <CopernicusZusatz status="leer" archiv onArchiv={() => {}} aktivierungen={[]} />,
    );
    expect(screen.getByText(/Keine Copernicus-Auswertung/)).not.toHaveTextContent(/ausgeblendet/);
  });

  it('listet EMSR-Nummern mit Aufnahme', () => {
    renderMitProviders(
      <CopernicusZusatz
        status="ok"
        archiv
        onArchiv={() => {}}
        aktivierungen={[
          {
            emsr: 'EMSR728',
            aufnahme: '2024-06-03 17:16:00',
            unvollstaendig: false,
            gekuerzt: false,
          },
          { emsr: 'EMSR900', unvollstaendig: false, gekuerzt: false },
        ]}
      />,
    );
    const liste = screen.getByRole('list', { name: /Copernicus-Aktivierungen/ });
    expect(liste).toHaveTextContent(/EMSR728 · Aufnahme \d{6}/);
    expect(liste).toHaveTextContent('EMSR900');
    expect(screen.queryByText(/Keine Copernicus-Auswertung/)).toBeNull();
  });

  it('nennt ohne Aufnahme die Lieferung (LLH-2022)', () => {
    renderMitProviders(
      <CopernicusZusatz
        status="ok"
        archiv
        onArchiv={() => {}}
        aktivierungen={[
          {
            emsr: 'EMSR517',
            geliefert: '2021-08-11 12:48:47',
            unvollstaendig: false,
            gekuerzt: false,
          },
        ]}
      />,
    );
    const liste = screen.getByRole('list', { name: /Copernicus-Aktivierungen/ });
    expect(liste).toHaveTextContent(/EMSR517 · Lieferung \d{6}/);
    expect(liste).not.toHaveTextContent(/Aufnahme/);
  });

  it('schaltet das Archiv', () => {
    const onArchiv = vi.fn();
    renderMitProviders(
      <CopernicusZusatz status="ok" archiv={false} onArchiv={onArchiv} aktivierungen={[]} />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ältere Aktivierungen' }));
    expect(onArchiv).toHaveBeenCalledWith(true);
  });

  it('nennt unvollständige und gekürzte Aktivierungen', () => {
    renderMitProviders(
      <CopernicusZusatz
        status="ok"
        archiv
        onArchiv={() => {}}
        aktivierungen={[{ emsr: 'EMSR728', unvollstaendig: true, gekuerzt: true }]}
      />,
    );
    expect(screen.getByRole('list', { name: /Copernicus-Aktivierungen/ })).toHaveTextContent(
      'nicht alle Ebenen geladen',
    );
    expect(screen.getByText(/weiter hineinzoomen/)).toBeInTheDocument();
  });
});
