import { it, expect } from 'vitest';
import { baueKraeftebild, OHNE_ABSCHNITT_KEY } from './kraeftebild';
import type { Einheit, EinsatzPersonal, EinsatzFahrzeug, EinsatzMaterial, Einsatzabschnitt } from '../api/types';

const ab = (id: number, ueber: number | null = null, name = `A${id}`): Einsatzabschnitt =>
  ({ id, einsatz_id: 1, ueber_abschnitt_id: ueber, name, leiter_id: null, leiter_name: null,
     bemerkung: null, sortier: id, flaeche_geojson: null, tz_fachaufgabe: null, tz_organisation: null });
const eh = (id: number, abschnitt_id: number | null, ueber_einheit_id: number | null = null): Einheit =>
  ({ id, einsatz_id: 1, abschnitt_id, abschnitt_name: null, ueber_einheit_id, typ_id: null,
     typ_label: 'Gruppe', name: `E${id}`, fuehrer_id: null, fuehrer_name: null, bemerkung: null,
     sortier: id, soll: null, ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
     ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
     personal_mitglieder: [], fahrzeug_mitglieder: [], material_mitglieder: [],
     lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null });
const p = (id: number, einheit_id: number | null, pos: EinsatzPersonal['staerke_position'],
           kat: EinsatzPersonal['status_kategorie'] = 'gebunden'): EinsatzPersonal =>
  ({ id, einsatz_id: 1, personal_id: null, einheit_id, ist_adhoc: false, name: `P${id}`,
     funktion: null, traegerorganisation: null, staerke_position: pos, status_id: null,
     status_label: null, status_kategorie: kat, status_farbe: null, disponiert_at: '', disponiert_von: null, bemerkung: null });
const fz = (id: number, einheit_id: number | null, kat: EinsatzFahrzeug['status_kategorie'] = 'verfuegbar',
            fms: number | null = 2): EinsatzFahrzeug =>
  ({ id, einsatz_id: 1, fahrzeug_id: null, einheit_id, ist_adhoc: false, funkrufname: `F${id}`,
     kennzeichen: null, fahrzeugtyp: 'LF', opta: null, traegerorganisation: null, status_id: null,
     status_label: `${fms}`, status_kategorie: kat, status_farbe: null, bemerkung: null,
     disponiert_at: '', disponiert_von: null, lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null });

it('Invariante: Kopf zählt jede Kraft genau einmal', () => {
  const personal = [p(1, 10, 'fuehrer'), p(2, 10, 'mannschaft'), p(3, null, 'mannschaft')];
  const fahrzeuge = [fz(1, 10), fz(2, null)];
  const material: EinsatzMaterial[] = [];
  const bild = baueKraeftebild([ab(1)], [eh(10, 1)], personal, fahrzeuge, material);
  expect(bild.verdichtung.anzahlPersonal).toBe(3);
  expect(bild.verdichtung.anzahlFahrzeuge).toBe(2);
  expect(bild.verdichtung.staerke.gesamt).toBe(3);
  expect(bild.verdichtung.staerke.fuehrer).toBe(1);
  expect(bild.verdichtung.staerke.mannschaft).toBe(2);
});

it('verschachtelte Einheiten: keine Doppelzählung', () => {
  const personal = [p(1, 10, 'fuehrer'), p(2, 20, 'mannschaft'), p(3, 20, 'mannschaft')];
  const bild = baueKraeftebild([ab(1)], [eh(10, 1), eh(20, 1, 10)], personal, [], []);
  expect(bild.verdichtung.staerke.gesamt).toBe(3);
  const a1 = bild.baum.find((z) => z.key === 'ab-1')!;
  expect(a1.staerke.gesamt).toBe(3);
  const e10 = a1.children!.find((z) => z.key === 'eh-10')!;
  expect(e10.staerke.gesamt).toBe(3);
});

it('verschachtelte Abschnitte rollen hoch', () => {
  const bild = baueKraeftebild([ab(1), ab(2, 1)], [eh(10, 2)], [p(1, 10, 'mannschaft')], [], []);
  const a1 = bild.baum.find((z) => z.key === 'ab-1')!;
  expect(a1.staerke.gesamt).toBe(1);
});

it('Catch-all: Kräfte ohne Zuordnung erscheinen und zählen', () => {
  const bild = baueKraeftebild([ab(1)], [eh(10, null)], [p(1, null, 'mannschaft')], [fz(9, null)], []);
  expect(bild.verdichtung.anzahlPersonal).toBe(1);
  expect(bild.verdichtung.anzahlFahrzeuge).toBe(1);
  const ohne = bild.baum.find((z) => z.key === OHNE_ABSCHNITT_KEY);
  expect(ohne).toBeDefined();
  expect(ohne!.staerke.gesamt).toBe(1);
});

it('leerer Einsatz: alles 0, kein Crash', () => {
  const bild = baueKraeftebild([], [], [], [], []);
  expect(bild.verdichtung.staerke.gesamt).toBe(0);
  expect(bild.baum).toEqual([]);
});

it('verdichtet Fahrzeug-Status getrennt', () => {
  const fahrzeuge = [fz(1, null, 'verfuegbar'), fz(2, null, 'gebunden'), fz(3, null, 'nicht_verfuegbar')];
  const bild = baueKraeftebild([], [], [], fahrzeuge, []);
  expect(bild.verdichtung.fahrzeugStatus.verfuegbar).toBe(1);
  expect(bild.verdichtung.fahrzeugStatus.gebunden).toBe(1);
  expect(bild.verdichtung.fahrzeugStatus.nicht_verfuegbar).toBe(1);
});
