import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { SchichtplanImportPosten, SchichtplanImportVorschau } from '../../api/types';
import { ImportVorschauAnsicht, LEERE_WAHL } from './ImportVorschauAnsicht';

const posten = (teil: Partial<SchichtplanImportPosten>): SchichtplanImportPosten => ({
  schluessel: 'p',
  art: 'einheit',
  name: 'Posten',
  abschnitt_neu: false,
  ziel: { art: 'neu' },
  treffer: 'neu',
  kandidaten: [],
  zeilen: [],
  bloecke: 0,
  ...teil,
});

function vorschau(teil: Partial<SchichtplanImportVorschau> = {}): SchichtplanImportVorschau {
  return {
    posten: [],
    personen: [],
    bloecke: [],
    meldungen: [],
    zaehlung: {
      einheiten_neu: 0,
      uhs_neu: 0,
      bloecke_neu: 0,
      bloecke_ergaenzt: 0,
      bloecke_unveraendert: 0,
      helfer_neu: 0,
      einteilungen_neu: 0,
      grenzwerte_neu: 0,
      programmpunkte_neu: 0,
      programmpunkte_vorhanden: 0,
      abschnitte_neu: 0,
      aenderungen: 0,
    },
    abschnitte_neu: [],
    auswahl: { einheiten: [], uhs: [], vorlagen: [], abschnitte: [] },
    uebernehmbar: true,
    ...teil,
  };
}

function zeichne(v: SchichtplanImportVorschau) {
  return render(
    <ImportVorschauAnsicht vorschau={v} wahl={LEERE_WAHL} gesperrt={false} onWahl={() => {}} />,
  );
}

describe('ImportVorschauAnsicht: neue Abschnitte (LLH-1609)', () => {
  it('nennt die neuen Abschnitte und markiert die Posten darin', () => {
    zeichne(
      vorschau({
        abschnitte_neu: ['Festmeile', 'Bühne'],
        posten: [
          posten({
            schluessel: 'a',
            name: 'Streife 1',
            abschnitt: 'Festmeile',
            abschnitt_neu: true,
          }),
          posten({ schluessel: 'b', name: 'Streife 3', abschnitt: 'Nord', abschnitt_id: 4 }),
        ],
      }),
    );
    const liste = screen.getByRole('region', { name: 'Neue Abschnitte' });
    expect(within(liste).getByText('Festmeile')).toBeInTheDocument();
    expect(within(liste).getByText('Bühne')).toBeInTheDocument();
    const zeilen = document.querySelectorAll('[data-lfh="einlesen-posten"]');
    expect(within(zeilen[0] as HTMLElement).getByText('neu')).toBeInTheDocument();
    expect(within(zeilen[1] as HTMLElement).queryByText('neu')).not.toBeInTheDocument();
  });

  it('zeigt ohne neue Abschnitte keine Liste', () => {
    zeichne(vorschau({ posten: [posten({ name: 'Streife 1', abschnitt: 'Nord' })] }));
    expect(screen.queryByRole('region', { name: 'Neue Abschnitte' })).not.toBeInTheDocument();
  });
});
