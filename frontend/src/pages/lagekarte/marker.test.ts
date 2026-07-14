import { describe, expect, it } from 'vitest';
import { baueMarker, baueTaktischeMarker, baueLageMeldungMarker, type TaktischeQuelle } from './marker';
import type { EinsatzAnzeige, LageMeldung, Schaden, Uhs } from '../../api/types';

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

  it('setzt taktische Zeichen für Einsatzort, UHS (je Typ) und Schaden', () => {
    const einsatz = { einsatzort: 'ELW', einsatzort_lat: 50, einsatzort_lon: 8 } as EinsatzAnzeige;
    const { verortet } = baueMarker(
      einsatz,
      [uhs({ id: 5, typ: 'patientenablage', lat: 50.1, lon: 8.1 })],
      [schaden({ id: 9, ausmass: 'mittel', lat: 51, lon: 7 })],
    );
    const byKey = (k: string) => verortet.find((m) => m.schluessel === k);
    expect(byKey('einsatzort')?.tz?.grundzeichen).toBe('anlass');
    expect(byKey('uhs-5')?.tz).toEqual({ grundzeichen: 'stelle', symbol: 'sammelplatz-betroffene' });
    expect(byKey('schaden-9')?.tz).toEqual({ grundzeichen: 'gefahr', farbe: '#faad14' });
  });
});

function lageMeldung(partial: Partial<LageMeldung>): LageMeldung {
  return {
    id: 1, einsatz_id: 1, meldung_id: 3, text: 'Brücke gesperrt', lat: null, lon: null,
    erstellt_von_id: 1, erstellt_at: '', meldung_lfd_nr: 5, meldung_absender: 'Florian Nord 1', ...partial,
  };
}

describe('baueLageMeldungMarker', () => {
  it('erzeugt Marker nur für verortete Lagemeldungen, mit Herkunfts-Info', () => {
    const marker = baueLageMeldungMarker([
      lageMeldung({ id: 4, lat: 50.3, lon: 8.7 }),
      lageMeldung({ id: 5, lat: null, lon: null }),
    ]);
    expect(marker.map((m) => m.schluessel)).toEqual(['lagemeldung-4']);
    expect(marker[0].typ).toBe('lagemeldung');
    expect(marker[0].lageMeldung).toEqual({
      meldungId: 3, meldungLfdNr: 5, absender: 'Florian Nord 1', inhalt: 'Brücke gesperrt',
    });
  });

  it('setzt kein taktisches Zeichen (Lagemeldung bleibt Kreis)', () => {
    const marker = baueLageMeldungMarker([lageMeldung({ id: 4, lat: 50.3, lon: 8.7 })]);
    expect(marker[0].tz).toBeUndefined();
  });
});

describe('baueTaktischeMarker', () => {
  it('leitet taktische Marker + nicht-verortet ab', () => {
    const einheiten = [
      { id: 1, name: 'Zug 1', typ_label: 'Zug', lat: 50.1, lon: 8.6, tz_fachaufgabe: 'rettungswesen', tz_organisation: null },
      { id: 2, name: 'Gruppe 2', typ_label: 'Gruppe', lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null },
    ] as unknown as TaktischeQuelle['einheiten'];
    const { verortet, nichtVerortet } = baueTaktischeMarker(
      { einheiten, fahrzeuge: [], fuehrungskraefte: [], orgDefault: 'hilfsorganisation' });
    expect(verortet.find((m) => m.schluessel === 'einheit-1')?.tz?.grundzeichen).toBe('taktische-formation');
    expect(nichtVerortet.some((o) => o.typ === 'einheit' && o.id === 2)).toBe(true);
  });

  it('reicht Fahrzeugtyp/OPTA/Träger an die TZ-Ableitung durch (LFH-171)', () => {
    const fahrzeuge = [
      { id: 7, funkrufname: 'Florian 1', lat: 50.2, lon: 8.7, tz_fachaufgabe: null, tz_organisation: null,
        status_farbe: null, fahrzeugtyp: 'MZB', opta: null, traegerorganisation: 'Feuerwehr' },
    ] as unknown as TaktischeQuelle['fahrzeuge'];
    const { verortet } = baueTaktischeMarker(
      { einheiten: [], fahrzeuge, fuehrungskraefte: [], orgDefault: null });
    const tz = verortet.find((m) => m.schluessel === 'fahrzeug-7')?.tz;
    expect(tz?.grundzeichen).toBe('wasserfahrzeug');
    expect(tz?.organisation).toBe('feuerwehr');
  });
});
