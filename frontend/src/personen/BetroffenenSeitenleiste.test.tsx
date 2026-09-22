import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Person } from '../api/types';
import { renderMitProviders } from '../test/utils';
import BetroffenenSeitenleiste from './BetroffenenSeitenleiste';

/**
 * Die Seitenleiste liest die Bilanz aus `personenBilanz.ts` — hier nur, dass die neuen
 * Posten (LFH-613: Notunterkunft, Fundort über Koordinate) tatsächlich ankommen.
 */

const basis: Person = {
  id: 1,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'betroffen',
  name: 'Mustermann',
  vorname: null,
  geschlecht: null,
  geburtsdatum: null,
  alter_geschaetzt: null,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  aktueller_verbleib: null,
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-09-22 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-09-22 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
};
let n = 1;
const p = (extra: Partial<Person>): Person => ({ ...basis, id: ++n, registrier_nr: n, ...extra });

function zeige(alle: Person[]) {
  return renderMitProviders(
    <BetroffenenSeitenleiste
      alle={alle}
      uhsName={(id) => (id === 7 ? 'Weserstadion' : undefined)}
      nurLuecken={false}
      onNurLuecken={() => {}}
    />,
  );
}

describe('BetroffenenSeitenleiste — Verbleib und offene Felder (LFH-613)', () => {
  it('führt Notunterkunft als eigenen Posten neben Transport, UHS und offen', () => {
    zeige([
      p({ aktuelle_verbleib_art: 'transport', aktueller_verbleib: 'Transport → KH Nord' }),
      p({ aktuelle_verbleib_art: 'transport', aktueller_verbleib: 'Transport' }),
      p({
        aktuelle_verbleib_art: 'notunterkunft',
        aktuelles_verbleib_ziel: 'Turnhalle Ost',
        aktueller_verbleib: 'Notunterkunft → Turnhalle Ost',
      }),
      p({ aktuelle_uhs_id: 7 }),
      p({}),
    ]);
    const verbleib = screen.getByRole('region', { name: 'Verbleib' });
    const posten = Array.from(verbleib.querySelectorAll<HTMLElement>('[data-verbleib]'));
    expect(posten.map((e) => [e.dataset.verbleib, e.textContent])).toEqual([
      ['transport', 'Transport2'],
      ['notunterkunft', 'Notunterkunft1'],
      ['uhs:7', 'Weserstadion1'],
      ['offen', 'offen1'],
    ]);
  });

  it('zählt eine Koordinate ohne Freitext NICHT als offenen Fundort', () => {
    zeige([
      p({
        aktuelle_verbleib_art: 'vor_ort',
        antreff_ort: null,
        antreff_lat: 52.2,
        antreff_lon: 9.1,
      }),
      p({ aktuelle_verbleib_art: 'vor_ort', antreff_ort: null }),
    ]);
    const offen = screen.getByRole('region', { name: 'Offene Felder' });
    expect(offen.querySelector('[data-lfh="offene-felder"]')).toHaveTextContent(
      /^0 ohne Verbleib, 1 ohne Fundort — 1 Datensatz\./,
    );
  });
});
