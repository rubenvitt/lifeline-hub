import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { Abloesung } from '../api/types';
import { renderMitProviders } from '../test/utils';
import AbloesungKarte from './AbloesungKarte';

dayjs.extend(utc);

const jetzt = dayjs.utc('2026-10-17 12:00:00');

const schicht = (over: Partial<Abloesung> = {}): Abloesung => ({
  id: 1,
  einsatz_id: 1,
  einheit_id: 11,
  einheit_name: 'Zug 1',
  abschnitt_id: 7,
  abschnitt_name: 'Deich',
  beginn_at: '2026-10-17 06:00:00',
  rhythmus_minuten: 360,
  vorwarnung_minuten: 30,
  rhythmus_quelle: 'einsatz',
  faellig_at: '2026-10-17 15:00:00',
  status: 'laufend',
  ruecknehmbar: false,
  erbende_einheiten: [],
  abloeser: [],
  folgeschichten: [],
  uebernommen_bei_vollzug: false,
  art: 'einheit',
  besatzung: [],
  abschnitt_uebergeben: false,
  planung_warnungen: [],
  angelegt_at: '2026-10-17 06:00:00',
  ...over,
});

const zeige = (s: Abloesung, darfSchreiben = true) =>
  renderMitProviders(
    <AbloesungKarte
      schicht={s}
      jetzt={jetzt}
      darfSchreiben={darfSchreiben}
      onVollziehen={() => {}}
      onZuruecknehmen={() => {}}
    />,
  );

const zeitspalte = () => {
  const zeit = document.querySelector<HTMLElement>('[data-lfh="abloesung-zeit"]')!;
  return { zeit: zeit.textContent, wort: zeit.nextElementSibling?.textContent };
};

describe('AbloesungKarte — Ende und Vererbung (LLH-1128)', () => {
  it('eine mit der Entlassung beendete Schicht heißt „beendet · entlassen“ mit Uhrzeit, nicht „abgelöst“', () => {
    zeige(
      schicht({
        status: 'beendet',
        beendet_grund: 'entlassung',
        beendet_at: '2026-10-17 10:12:00',
      }),
    );
    const karte = screen.getByRole('article', { name: 'Schicht Zug 1' });
    expect(zeitspalte().wort).toBe('beendet');
    const ende = karte.querySelector<HTMLElement>('[data-lfh="abloesung-ende"]');
    expect(ende).toHaveTextContent(/^beendet · entlassen \d{4}$/);
    expect(within(karte).queryByText(/abgelöst/i)).toBeNull();
    // Beendet ist nicht laufend: keine Fälligkeit, keine Aktionen, keine Rücknahme.
    expect(karte.querySelector('[data-lfh="abloesung-abstand"]')).toBeNull();
    expect(within(karte).queryByRole('button')).toBeNull();
  });

  it('eine beim Auflösen beendete Schicht heißt „beendet · aufgelöst“', () => {
    zeige(
      schicht({
        status: 'beendet',
        beendet_grund: 'aufloesung',
        beendet_at: '2026-10-17 10:12:00',
      }),
    );
    expect(document.querySelector('[data-lfh="abloesung-ende"]')).toHaveTextContent(
      /^beendet · aufgelöst$/,
    );
  });

  it('die Zeitspalte einer beendeten Schicht zeigt das Ende, die einer abgelösten den Vollzug', () => {
    const { unmount } = zeige(
      schicht({
        status: 'beendet',
        beendet_grund: 'entlassung',
        beendet_at: '2026-10-17 10:12:00',
      }),
    );
    const beendet = zeitspalte().zeit;
    unmount();
    zeige(schicht({ status: 'abgeloest', vollzogen_at: '2026-10-17 10:12:00' }));
    expect(zeitspalte()).toEqual({ zeit: beendet, wort: 'abgelöst' });
    expect(document.querySelector('[data-lfh="abloesung-ende"]')).toBeNull();
  });

  it('die tragende Schicht nennt ihre erbenden Untereinheiten in einer Zeile', () => {
    zeige(
      schicht({
        erbende_einheiten: [
          { einheit_id: 12, einheit_name: '1. Trupp' },
          { einheit_id: 13, einheit_name: '2. Trupp' },
        ],
      }),
    );
    const erben = document.querySelector<HTMLElement>('[data-lfh="abloesung-erben"]');
    expect(erben).toHaveTextContent(/^gilt auch für: 1\. Trupp, 2\. Trupp$/);
    // Einzeilig, der ganze Text im Titel: ein neuer Erbe ändert die Kartenhöhe nicht.
    expect(erben).toHaveAttribute('title', 'gilt auch für: 1. Trupp, 2. Trupp');
    expect(erben!.style.whiteSpace).toBe('nowrap');
  });

  it('ohne Erben keine Zeile', () => {
    zeige(schicht());
    expect(document.querySelector('[data-lfh="abloesung-erben"]')).toBeNull();
  });
});

describe('AbloesungKarte — Besatzungswechsel (LLH-1150)', () => {
  it('die abgelöste Schicht nennt „Besatzungswechsel“ und die neue Besatzung, ohne „Abgelöst durch“', () => {
    zeige(
      schicht({
        status: 'abgeloest',
        vollzogen_at: '2026-10-17 11:40:00',
        art: 'besatzung',
        besatzung: [
          { personal_id: 1, name: 'Anna Alt', rolle: 'alt' },
          { personal_id: 2, name: 'Cora Neu', rolle: 'neu' },
          { personal_id: 3, name: 'Dirk Neu', rolle: 'neu' },
        ],
      }),
    );
    const zeile = document.querySelector<HTMLElement>('[data-lfh="abloesung-besatzung"]')!;
    expect(zeile).toHaveTextContent('Besatzungswechsel · neu: Cora Neu, Dirk Neu');
    expect(zeile.title).toContain('Bisherige: Anna Alt');
    expect(document.querySelector('[data-lfh="abloesung-abloeser"]')).toBeNull();
  });

  it('eine laufende oder als ganze Einheit abgelöste Schicht hat keine solche Zeile', () => {
    zeige(schicht());
    expect(document.querySelector('[data-lfh="abloesung-besatzung"]')).toBeNull();
  });
});
