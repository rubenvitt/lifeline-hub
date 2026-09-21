import { ConfigProvider, theme } from 'antd';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import {
  antdToken,
  etbTypFarbenDunkel,
  etbTypFarbenHell,
  farbenDunkel,
  farbenHell,
} from '../../theme/tokens';
import Zeitachseneintrag, { hinweisFarbe, zeilenGrund } from './Zeitachseneintrag';

function kante(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-lfh="typkante"]')!;
}

describe('Zeitachseneintrag', () => {
  it('Typ als Kante + Wort: Kante aria-hidden, Wort ist Text', () => {
    const { container } = renderMitProviders(
      <Zeitachseneintrag zeit="14:06" nr="Nr. 409" typ="anordnung" typwort="Anordnung" meta="ELW 1">
        Abschnitt Nord verlegt zwei Trupps.
      </Zeitachseneintrag>,
    );
    expect(kante(container)).toHaveAttribute('aria-hidden', 'true');
    expect(kante(container)).toHaveStyle({ background: etbTypFarbenHell.anordnung.kante });
    expect(screen.getByText('Anordnung')).toHaveStyle({
      color: etbTypFarbenHell.anordnung.wort,
      textTransform: 'uppercase',
    });
    expect(screen.getByText('14:06')).toBeInTheDocument();
    expect(screen.getByText('Nr. 409')).toBeInTheDocument();
    expect(screen.getByText('Abschnitt Nord verlegt zwei Trupps.')).toBeInTheDocument();
  });

  it('liest die Typfarbe im aktiven Modus', () => {
    const { container } = renderMitProviders(
      <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: antdToken(farbenDunkel) }}>
        <Zeitachseneintrag zeit="13:47" typ="entscheidung" typwort="Entscheidung">
          x
        </Zeitachseneintrag>
      </ConfigProvider>,
    );
    expect(kante(container)).toHaveStyle({ background: etbTypFarbenDunkel.entscheidung.kante });
  });

  it('ein eigenes Farbpaar schlägt den Typ', () => {
    const { container } = renderMitProviders(
      <Zeitachseneintrag
        zeit="1"
        typ="meldung"
        farben={{ kante: 'rgb(1, 2, 3)', wort: 'rgb(4, 5, 6)' }}
        typwort="Auftrag"
      >
        x
      </Zeitachseneintrag>,
    );
    expect(kante(container).style.background).toBe('rgb(1, 2, 3)');
  });

  it('Zeilentönung färbt die ganze Zeile; ohne Tönung transparent', () => {
    expect(zeilenGrund(farbenHell)).toBe('transparent');
    expect(zeilenGrund(farbenHell, 'berichtigung')).toBe(farbenHell.berichtigungZeile);
    expect(zeilenGrund(farbenDunkel, 'luecke')).toBe(farbenDunkel.lueckeZeile);
    expect(zeilenGrund(farbenDunkel, 'problem')).toBe(farbenDunkel.problemZeile);
  });

  it('reicht Attribute durch — die Datensicht-Marke muss am Eintrag stehen können', () => {
    renderMitProviders(
      <Zeitachseneintrag
        zeit="1"
        typwort="System"
        data-lfh="datensicht-karte"
        className="zeile-markiert"
        als="li"
      >
        x
      </Zeitachseneintrag>,
    );
    const li = document.querySelector('li[data-lfh="datensicht-karte"]');
    expect(li).not.toBeNull();
    expect(li).toHaveClass('zeile-markiert');
  });

  it('Hinweis, Verfasser, Weg und Aktionen erscheinen nur, wenn übergeben', () => {
    const { rerender } = renderMitProviders(
      <Zeitachseneintrag zeit="1" typwort="Lage">
        x
      </Zeitachseneintrag>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    rerender(
      <Zeitachseneintrag
        zeit="1"
        typwort="Lage"
        hinweis="Grundeintrag anzeigen ↗"
        hinweisTon="alarm"
        verfasser="Vitt · S2"
        weg="Funk"
        aktionen={<button type="button">Aktionen zu Eintrag 1</button>}
      >
        x
      </Zeitachseneintrag>,
    );
    expect(screen.getByText('Grundeintrag anzeigen ↗')).toHaveStyle({ color: farbenHell.alarm });
    expect(screen.getByText('Vitt · S2')).toBeInTheDocument();
    expect(screen.getByText('Funk')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aktionen zu Eintrag 1' })).toBeInTheDocument();
    expect(hinweisFarbe(farbenHell, 'schwach')).toBe(farbenHell.schwach);
  });
});
