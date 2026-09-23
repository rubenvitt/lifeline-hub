import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ComponentProps } from 'react';
import type { EtbEintragAnzeige, EtbZaehler } from '../api/types';
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

function zaehler(jeTyp: Partial<EtbZaehler['je_typ']>): EtbZaehler {
  const je_typ = {
    meldung: 0,
    anordnung: 0,
    lage: 0,
    entscheidung: 0,
    system: 0,
    berichtigung: 0,
    ...jeTyp,
  };
  return { gesamt: Object.values(je_typ).reduce((a, b) => a + b, 0), je_typ };
}

function rendere(over: Partial<ComponentProps<typeof EtbBilanz>> = {}) {
  return renderMitProviders(
    <EtbBilanz
      einsatzId={7}
      eintraege={[]}
      zaehler={zaehler({})}
      zaehlerFehler={false}
      filterAktiv={false}
      puffer={{ art: 'uebertragen' }}
      unbestimmt={false}
      {...over}
    />,
  );
}

describe('EtbBilanz', () => {
  // LFH-612: die Bilanz zählt, was der SERVER zählt — nicht das geladene Fenster.
  it('zählt je Typ aus der Serverzählung und misst die Balken gegen deren Gesamtzahl', () => {
    rendere({
      eintraege: [e({ id: 3 }), e({ id: 2 }), e({ id: 1, typ: 'anordnung' })],
      zaehler: zaehler({
        meldung: 218,
        anordnung: 96,
        entscheidung: 31,
        lage: 62,
        berichtigung: 5,
      }),
    });
    const meldungen = document.querySelector('[data-typ="meldung"]')!;
    expect(meldungen).toHaveTextContent('Meldungen218');
    expect(
      within(meldungen as HTMLElement).getByRole('img', {
        name: 'Meldungen: 218 von 412 Einträgen',
      }),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-typ="anordnung"]')).toHaveTextContent('96');
    expect(screen.getByRole('heading', { name: 'Bilanz' })).toBeVisible();
    expect(screen.getByText('412 Einträge')).toBeVisible();
    // „Tages-" entfällt: die Zählung folgt dem Filter, nicht einem Kalendertag.
    expect(screen.queryByText(/Tagesbilanz/)).toBeNull();
    // System erscheint nur, wenn es vorkommt.
    expect(document.querySelector('[data-typ="system"]')).toBeNull();
  });

  it('heißt unter einem Filter „Bilanz im Filter" und zählt Treffer', () => {
    rendere({ filterAktiv: true, zaehler: zaehler({ meldung: 6, system: 1 }) });
    expect(screen.getByRole('heading', { name: 'Bilanz im Filter' })).toBeVisible();
    expect(screen.getByText('7 Treffer')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Meldungen: 6 von 7 Treffern' })).toBeInTheDocument();
    expect(document.querySelector('[data-typ="system"]')).toHaveTextContent('1');
  });

  it('behauptet während des Ladens keine Zählung', () => {
    rendere({ zaehler: undefined });
    expect(screen.getByText('Zählung folgt …')).toBeVisible();
    expect(document.querySelector('[data-typ]')).toBeNull();
  });

  it('sagt, wenn die Zählung gescheitert ist, statt eine Zahl zu zeigen', () => {
    rendere({ zaehler: undefined, zaehlerFehler: true });
    expect(screen.getByText('Zählung nicht verfügbar.')).toBeVisible();
    expect(document.querySelector('[data-typ]')).toBeNull();
    expect(screen.queryByText(/\d+ Einträge/)).toBeNull();
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
