import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ComponentProps } from 'react';
import type { EtbEintragAnzeige } from '../api/types';
import { renderMitProviders } from '../test/utils';
import EtbBilanz from './EtbBilanz';

function e(over: Partial<EtbEintragAnzeige>): EtbEintragAnzeige {
  return {
    id: 1,
    lfd_nr: 1,
    typ: 'meldung',
    inhalt: 'x',
    erfasser_id: 1,
    erfasser_name: 'M',
    ereigniszeit: '2026-05-23 10:00:00',
    received_at: '2026-05-23 10:00:00',
    folgeauftraege: [],
    ...over,
  };
}

function rendere(over: Partial<ComponentProps<typeof EtbBilanz>> = {}) {
  return renderMitProviders(
    <EtbBilanz
      einsatzId={7}
      eintraege={[]}
      weitereSeiten={false}
      filterAktiv={false}
      puffer={{ art: 'uebertragen' }}
      unbestimmt={false}
      {...over}
    />,
  );
}

describe('EtbBilanz', () => {
  it('zählt je Typ über die geladenen Einträge und sagt, dass es die geladenen sind', () => {
    rendere({
      eintraege: [e({ id: 3 }), e({ id: 2 }), e({ id: 1, typ: 'anordnung' })],
      weitereSeiten: true,
    });
    const meldungen = document.querySelector('[data-typ="meldung"]')!;
    expect(meldungen).toHaveTextContent('Meldungen2');
    expect(
      within(meldungen as HTMLElement).getByRole('img', {
        name: 'Meldungen: 2 von 3 geladenen Einträgen',
      }),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-typ="anordnung"]')).toHaveTextContent('1');
    expect(
      screen.getByText('in 3 geladenen Einträgen — ältere sind nicht mitgezählt'),
    ).toBeVisible();
    // Kein „Tages-" und keine Gesamtzahl, die es nicht gibt.
    expect(screen.queryByText(/Tagesbilanz/)).toBeNull();
  });

  it('behauptet während des Ladens keine Zählung', () => {
    rendere({ unbestimmt: true, eintraege: [] });
    expect(screen.getByText('Zählung folgt, sobald die Einträge geladen sind.')).toBeVisible();
    expect(document.querySelector('[data-typ]')).toBeNull();
  });

  it('verlinkt die jüngsten Berichtigungen auf ihren Eintrag, mit der Nummer des Grundeintrags', () => {
    rendere({
      eintraege: [
        e({ id: 2, lfd_nr: 9, typ: 'berichtigung', berichtigt_eintrag_id: 1 }),
        e({ id: 1, lfd_nr: 5 }),
      ],
    });
    const link = screen.getByRole('link', { name: /Nr\. 9 berichtigt Nr\. 5 um \d{2}:\d{2}/ });
    expect(link).toHaveAttribute('href', '/einsaetze/7/etb?eintrag=2');
  });

  it('nennt es, wenn unter den geladenen keine Berichtigung ist', () => {
    rendere({ eintraege: [e({})] });
    expect(screen.getByText('Keine in den geladenen Einträgen.')).toBeVisible();
  });

  it('Puffer „übertragen": Häkchen plus Wort', () => {
    rendere();
    const p = document.querySelector('[data-lfh="puffer"]')!;
    expect(p).toHaveAttribute('data-zustand', 'uebertragen');
    expect(p).toHaveTextContent('Alle Einträge übertragen');
  });

  it('Puffer „ausstehend": achtung-Fläche mit Zahl und Wort', () => {
    rendere({ puffer: { art: 'ausstehend', ausstehend: 2 } });
    const chip = document.querySelector('[data-lfh="puffer"] [data-lfh="status-chip"]')!;
    expect(chip).toHaveAttribute('data-ton', 'achtung');
    expect(chip).toHaveTextContent('2ausstehend');
  });

  it('Puffer „abgelehnt": alarm-Fläche, daneben weiter die ausstehenden', () => {
    rendere({ puffer: { art: 'abgelehnt', abgelehnt: 1, ausstehend: 3 } });
    const chips = document.querySelectorAll('[data-lfh="puffer"] [data-lfh="status-chip"]');
    expect([...chips].map((c) => c.getAttribute('data-ton'))).toEqual(['alarm', 'achtung']);
    expect(chips[0]).toHaveTextContent('1abgelehnt');
    expect(chips[1]).toHaveTextContent('3ausstehend');
  });
});
