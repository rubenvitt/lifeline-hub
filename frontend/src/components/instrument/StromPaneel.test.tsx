import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import StromPaneel from './StromPaneel';

function rendere(neu: number, zustand: 'daten' | 'leer' | 'fehler' = 'daten') {
  const onAnzeigen = vi.fn();
  renderMitProviders(
    <StromPaneel
      titel="Jüngste ETB-Einträge"
      zustand={zustand}
      listeName="Jüngste Einträge"
      neu={neu}
      bannerText={`${neu} neue Einträge`}
      onAnzeigen={onAnzeigen}
      leerText="Noch keine Einträge."
      gesperrtText="Modul ETB nicht freigegeben."
      onNeuladen={vi.fn()}
    >
      <li>Eintrag 1</li>
      <li>Eintrag 2</li>
    </StromPaneel>,
  );
  return { onAnzeigen };
}

describe('StromPaneel', () => {
  it('zeigt die Einträge als benannte Liste, ohne Banner, solange nichts neu ist', () => {
    rendere(0);
    expect(screen.getByRole('list', { name: 'Jüngste Einträge' }).children).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'anzeigen' })).toBeNull();
  });

  it('Neues kommt als Sammelbanner, „anzeigen“ gibt den Fokus an die Liste', async () => {
    const { onAnzeigen } = rendere(3);
    expect(screen.getByText('3 neue Einträge')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '3 neu anzeigen' }));
    expect(onAnzeigen).toHaveBeenCalledOnce();
    expect(screen.getByRole('list', { name: 'Jüngste Einträge' })).toHaveFocus();
  });

  // LLH-1934: als Überlagerung über der Liste verdeckte er die halbe oberste Zeile.
  it('der Banner steht als Kurzform im Paneelkopf, nicht über der Liste', () => {
    rendere(3);
    const banner = screen.getByRole('status');
    const kopf = screen.getByRole('heading', { name: 'Jüngste ETB-Einträge' }).parentElement!;
    expect(kopf).toContainElement(banner);
    expect(kopf).not.toContainElement(screen.getByRole('list', { name: 'Jüngste Einträge' }));
    expect(banner.querySelector('[data-lfh="sammelbanner-kurz"]')).toHaveTextContent('3 neu');
  });

  it('Leer und Fehler zeigen keine Liste', () => {
    rendere(0, 'leer');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('Noch keine Einträge.')).toBeInTheDocument();
  });
});
