import { ConfigProvider, theme } from 'antd';
import type { ReactNode } from 'react';
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
import Zeitachseneintrag, {
  hinweisFarbe,
  zeilenGrund,
  zeitachsenAufbau,
  zeitachsenRinne,
} from './Zeitachseneintrag';

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
    expect(screen.getByText('Grundeintrag anzeigen ↗')).toHaveStyle({
      color: farbenHell.alarmText,
    });
    expect(screen.getByText('Vitt · S2')).toBeInTheDocument();
    expect(screen.getByText('Funk')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aktionen zu Eintrag 1' })).toBeInTheDocument();
    expect(hinweisFarbe(farbenHell, 'schwach')).toBe(farbenHell.schwach);
  });
});

describe('zeitachsenRinne', () => {
  // Literale statt Rücklesen aus dem Token (frontend/AGENTS.md): handschuh = 26 / 16.
  const handschuh = { padding: 26, paddingSM: 16 };
  it('unter md die kleine Rinne — der Text braucht die Breite', () => {
    expect(zeitachsenRinne(handschuh, true)).toBe(16);
  });
  it('ab md die volle Rinne des Entwurfs', () => {
    expect(zeitachsenRinne(handschuh, false)).toBe(26);
  });
});

describe('zeitachsenAufbau (LFH-958)', () => {
  // Literale statt Rücklesen aus dem Token: kompakt 30, komfortabel 48, Handschuh 72; antd ohne
  // Dichte-Token 32.
  it.each([
    [30, 'zeile'],
    [32, 'zeile'],
    [48, 'spalte'],
    [72, 'spalte'],
  ] as const)('controlHeight %i → %s', (hoehe, aufbau) => {
    expect(zeitachsenAufbau({ controlHeight: hoehe })).toBe(aufbau);
  });
});

describe('Zeitachseneintrag: Aufbau je Dichte (LFH-958)', () => {
  const VERFASSER = 'Administrator · EL';

  function zeile(zusatz: { aktionen?: ReactNode } = {}) {
    return (
      <Zeitachseneintrag
        zeit="14:06"
        nr="Nr. 409"
        typ="meldung"
        typwort="Meldung"
        meta="ELW 1 → FüKw"
        verfasser={VERFASSER}
        weg="Funk"
        menue={<button type="button">Aktionen zu Eintrag 409</button>}
        {...zusatz}
      >
        Pegel steigt.
      </Zeitachseneintrag>
    );
  }

  function kopfzeile() {
    return screen.getByText('Meldung').parentElement!;
  }

  it('kompakt: Verfasser, Weg und Menü stehen in der Kopfzeile, keine Metaspalte', () => {
    const { container } = renderMitProviders(
      <ConfigProvider theme={{ token: { controlHeight: 30 } }}>{zeile()}</ConfigProvider>,
    );
    const kopf = kopfzeile();
    const verfasser = screen.getByText(VERFASSER);
    expect(kopf).toContainElement(verfasser);
    expect(kopf).toContainElement(screen.getByText('Funk'));
    expect(kopf).toContainElement(screen.getByRole('button', { name: 'Aktionen zu Eintrag 409' }));
    expect(container.querySelector('[data-lfh="metaspalte"]')).toBeNull();
    // Einzeilig mit Auslassung, der volle Name als Titel.
    expect(verfasser).toHaveAttribute('title', VERFASSER);
    expect(verfasser).toHaveStyle({ whiteSpace: 'nowrap', textOverflow: 'ellipsis' });
  });

  it('kompakt: Text-Aktionen bleiben rechts, ohne Verfasser darüber', () => {
    const { container } = renderMitProviders(
      <ConfigProvider theme={{ token: { controlHeight: 30 } }}>
        {zeile({ aktionen: <button type="button">Erneut senden</button> })}
      </ConfigProvider>,
    );
    const spalte = container.querySelector('[data-lfh="metaspalte"]')!;
    expect(spalte).toContainElement(screen.getByRole('button', { name: 'Erneut senden' }));
    expect(spalte).not.toContainElement(screen.getByText(VERFASSER));
  });

  it('kompakt: ein bedienbarer Verfasser bleibt mit dem Weg in der Spalte', () => {
    const { container } = renderMitProviders(
      <ConfigProvider theme={{ token: { controlHeight: 30 } }}>
        <Zeitachseneintrag
          zeit="14:06"
          typwort="Meldung"
          verfasser={<a href="#anrufer">Anrufer 3</a>}
          weg="Telefon"
          menue={<button type="button">Aktionen zu Eintrag 1</button>}
        >
          x
        </Zeitachseneintrag>
      </ConfigProvider>,
    );
    const spalte = container.querySelector('[data-lfh="metaspalte"]')!;
    expect(spalte).toContainElement(screen.getByRole('link', { name: 'Anrufer 3' }));
    expect(spalte).toContainElement(screen.getByText('Telefon'));
    // Das Menü steht trotzdem in der Kopfzeile.
    expect(kopfzeile()).toContainElement(
      screen.getByRole('button', { name: 'Aktionen zu Eintrag 1' }),
    );
  });

  it('kompakt: der Text hält dem Menüknopf die Breite frei', () => {
    renderMitProviders(
      <ConfigProvider theme={{ token: { controlHeight: 30 } }}>{zeile()}</ConfigProvider>,
    );
    expect(screen.getByText('Pegel steigt.')).toHaveStyle({ paddingInlineEnd: '30px' });
  });

  it.each([48, 72])(
    'controlHeight %i: Verfasser, Weg und Menü in der Spalte rechts, wie bisher',
    (hoehe) => {
      const { container } = renderMitProviders(
        <ConfigProvider theme={{ token: { controlHeight: hoehe } }}>{zeile()}</ConfigProvider>,
      );
      const spalte = container.querySelector('[data-lfh="metaspalte"]')!;
      expect(spalte).toContainElement(screen.getByText(VERFASSER));
      expect(spalte).toContainElement(screen.getByText('Funk'));
      expect(spalte).toContainElement(
        screen.getByRole('button', { name: 'Aktionen zu Eintrag 409' }),
      );
      expect(kopfzeile()).not.toContainElement(screen.getByText(VERFASSER));
    },
  );
});
