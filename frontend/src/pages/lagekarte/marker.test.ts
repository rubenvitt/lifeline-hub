import { describe, expect, it } from 'vitest';
import { baueMarker, baueTaktischeMarker } from './marker';
import type { EinsatzAnzeige, Schaden, Uhs } from '../../api/types';

function uhs(partial: Partial<Uhs>): Uhs {
  return {
    id: 1, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
    bezeichnung: 'BHP 50', standort: null, notiz: null, status: 'aktiv',
    lat: null, lon: null, erfasst_at: '', erfasst_von: 1, geaendert_at: '',
    geaendert_von: 1, storniert_at: null, ...partial,
  };
}
function schaden(partial: Partial<Schaden>): Schaden {
  return {
    id: 1, einsatz_id: 1, registrier_nr: 7, status: 'offen', typ: 'sachschaden',
    ausmass: 'gross', ort: 'Hauptstr.', lat: null, lon: null, beschreibung: '',
    geschaedigt_person_id: null, geschaedigt_personal_id: null,
    geschaedigt_organisation_id: null, geschaedigt_kontakt: null,
    uebergeben_an: null, uebergeben_at: null, abschluss_grund: null, abschluss_at: null,
    erfasst_at: '', erfasst_von: 1, geaendert_at: '', geaendert_von: 1,
    storniert_at: null, storniert_von: null, geschaedigt_registrier_nr: null,
    geschaedigt_storniert_at: null, geschaedigt_personal_name: null,
    geschaedigt_organisation_name: null, ...partial,
  };
}

describe('baueMarker', () => {
  it('trennt verortete von nicht-verorteten Objekten', () => {
    const einsatz = { einsatzort: 'ELW', einsatzort_lat: 50, einsatzort_lon: 8 } as EinsatzAnzeige;
    const { verortet, nichtVerortet } = baueMarker(
      einsatz,
      [uhs({ id: 5, lat: 50.1, lon: 8.1 }), uhs({ id: 6, bezeichnung: 'PA', lat: null, lon: null })],
      [schaden({ id: 9, registrier_nr: 3, lat: 51, lon: 7 }), schaden({ id: 10, registrier_nr: 4 })],
    );
    expect(verortet.map((m) => m.schluessel)).toEqual(['einsatzort', 'uhs-5', 'schaden-9']);
    expect(nichtVerortet).toEqual([
      { typ: 'uhs', id: 6, label: 'PA' },
      { typ: 'schaden', id: 10, label: 'S-004' },
    ]);
  });

  it('lässt den Einsatzort weg, wenn er keine Koordinate hat', () => {
    const einsatz = { einsatzort: null, einsatzort_lat: null, einsatzort_lon: null } as EinsatzAnzeige;
    const { verortet } = baueMarker(einsatz, [], []);
    expect(verortet).toHaveLength(0);
  });

  it('färbt Schaden-Marker nach Ausmaß', () => {
    const { verortet } = baueMarker(undefined, [], [schaden({ id: 1, ausmass: 'katastrophal', lat: 51, lon: 7 })]);
    expect(verortet[0].farbe).toBe('#f5222d');
  });

  it('nutzt Fallback-Farbe bei unbekanntem Ausmaß', () => {
    const { verortet } = baueMarker(undefined, [], [
      schaden({ id: 1, ausmass: 'unbekannt' as never, lat: 51, lon: 7 }),
    ]);
    expect(verortet[0].farbe).toBe('#8c8c8c');
  });

  it('kommt mit undefined-Einsatz klar', () => {
    expect(baueMarker(undefined, [], [])).toEqual({ verortet: [], nichtVerortet: [] });
  });
});

describe('baueTaktischeMarker', () => {
  it('leitet taktische Marker + nicht-verortet ab', () => {
    const einheiten = [
      { id: 1, name: 'Zug 1', typ_label: 'Zug', lat: 50.1, lon: 8.6, tz_fachaufgabe: 'rettungswesen', tz_organisation: null },
      { id: 2, name: 'Gruppe 2', typ_label: 'Gruppe', lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null },
    ] as any;
    const { verortet, nichtVerortet } = baueTaktischeMarker(
      { einheiten, fahrzeuge: [], fuehrungskraefte: [], orgDefault: 'hilfsorganisation' });
    expect(verortet.find((m) => m.schluessel === 'einheit-1')?.tz?.grundzeichen).toBe('taktische-formation');
    expect(nichtVerortet.some((o) => o.typ === 'einheit' && o.id === 2)).toBe(true);
  });
});
