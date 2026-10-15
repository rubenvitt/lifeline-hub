import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import type {
  Einheit,
  VorlageVorschau,
  VorschauFahrzeug,
  VorschauKnoten,
  VorschauPersonal,
} from '../api/types';
import {
  LEERE_WAHL,
  reconcileWahl,
  buildAnfrage,
  deckelGrund,
  gruendeJeZeile,
  isGesperrt,
  isNameVergeben,
  kommtMit,
  offersUmhaengen,
  ohneFahrzeug,
  setWahl,
  umhaengenText,
  verlaesstFahrzeug,
  showsUmhaengen,
  zeilenSchluessel,
  zusammenfassung,
  zustandWort,
} from './ausVorlageKern';

const fz = (fahrzeug_id: number, funkrufname: string, extra: Partial<VorschauFahrzeug> = {}) =>
  ({ fahrzeug_id, funkrufname, fahrzeugtyp: null, zustand: 'neu', ...extra }) as VorschauFahrzeug;
const ps = (personal_id: number, name: string, extra: Partial<VorschauPersonal> = {}) =>
  ({ personal_id, name, zustand: 'neu', ...extra }) as VorschauPersonal;
const knoten = (
  vorlage_id: number,
  name: string,
  typ_label: string,
  fahrzeuge: VorschauFahrzeug[],
  personal: VorschauPersonal[],
  ueber_vorlage_id?: number,
) =>
  ({
    vorlage_id,
    ueber_vorlage_id,
    name,
    typ_id: 1,
    typ_label,
    soll_eigen: false,
    fahrzeuge,
    personal,
  }) as VorschauKnoten;

/** Der Demo-„Sanitätszug Musterstadt“ ohne Kräfte im Einsatz (Spec, „Vorgaben der Häkchen“). */
function sanitaetszug(
  fahrzeuge: Partial<Record<number, Partial<VorschauFahrzeug>>> = {},
  personal: Partial<Record<number, Partial<VorschauPersonal>>> = {},
): VorlageVorschau {
  return {
    vorlage_id: 1,
    fahrzeuge_gesperrt: false,
    personal_gesperrt: false,
    knoten: [
      knoten(
        1,
        'Sanitätszug Musterstadt',
        'Zug',
        [fz(10, 'ELW 1', fahrzeuge[10])],
        [
          ps(100, 'Zugführer', { fahrzeug_id: 10, staerke_position: 'fuehrer', ...personal[100] }),
          ps(101, 'Funker', { fahrzeug_id: 10, ...personal[101] }),
        ],
      ),
      knoten(
        2,
        'Rettungsstaffel',
        'Staffel',
        [fz(20, 'RTW 1', fahrzeuge[20]), fz(21, 'RTW 2', fahrzeuge[21])],
        [
          ps(200, 'Anna', { fahrzeug_id: 20, ...personal[200] }),
          ps(201, 'Bert', { fahrzeug_id: 20, ...personal[201] }),
          ps(202, 'Cleo', { fahrzeug_id: 21, ...personal[202] }),
          ps(203, 'Dirk', { ...personal[203] }),
        ],
        1,
      ),
    ],
  };
}

describe('Vorgaben der Häkchen (D4)', () => {
  it('hakt jedes freie Fahrzeug an, keine Person; die Zusammenfassung zählt den Baum', () => {
    const v = sanitaetszug();
    const wahl = reconcileWahl(LEERE_WAHL, v);
    expect([...wahl.fahrzeuge].filter(([, e]) => e.an).map(([id]) => id)).toEqual([10, 20, 21]);
    expect([...wahl.personal].some(([, e]) => e.an)).toBe(false);
    expect(zusammenfassung(v, wahl)).toBe('1 Zug, 1 Staffel, 3 Fahrzeuge, 0 Kräfte');
  });

  it('nimmt „im Einsatz“ an, „gebunden“, „außer Dienst“ und ein entlassenes Fahrzeug nicht', () => {
    const v = sanitaetszug({
      10: { zustand: 'frei', ef_id: 5 },
      20: { zustand: 'gebunden', einheit_id: 9, einheit_name: '2. Zug' },
      21: { zustand: 'ausser_dienst' },
    });
    const wahl = reconcileWahl(LEERE_WAHL, v);
    expect(wahl.fahrzeuge.get(10)?.an).toBe(true);
    expect(wahl.fahrzeuge.get(20)?.an).toBe(false);
    expect(wahl.fahrzeuge.get(21)?.an).toBe(false);
    // Fahrzeuge erneut zu disponieren kommt erst mit LLH-1079 Teil II; bis dahin lehnt der Server ab.
    expect(isGesperrt('fahrzeug', 'entlassen')).toBe(true);
    expect(isGesperrt('personal', 'entlassen')).toBe(false);
    expect(isGesperrt('fahrzeug', 'ausser_dienst')).toBe(true);
    expect(isGesperrt('personal', 'ausser_dienst')).toBe(true);
    expect(isGesperrt('fahrzeug', 'gebunden')).toBe(false);
  });

  it('zählt mehrere Einheiten desselben Typs mit Mal-Zeichen, eine Kraft im Singular', () => {
    const v = sanitaetszug();
    v.knoten.push(knoten(3, 'Zweite Staffel', 'Staffel', [], [], 1));
    let wahl = reconcileWahl(LEERE_WAHL, v);
    wahl = setWahl(wahl, 'fahrzeug', fz(20, 'RTW 1'), false);
    wahl = setWahl(wahl, 'fahrzeug', fz(21, 'RTW 2'), false);
    wahl = setWahl(wahl, 'personal', ps(203, 'Dirk'), true);
    expect(zusammenfassung(v, wahl)).toBe('1 Zug, 2 × Staffel, 1 Fahrzeug, 1 Kraft');
  });

  it('lässt einen gesperrten Teil aus der Zusammenfassung', () => {
    const v = { ...sanitaetszug(), personal_gesperrt: true };
    expect(zusammenfassung(v, reconcileWahl(LEERE_WAHL, v))).toBe('1 Zug, 1 Staffel, 3 Fahrzeuge');
  });
});

describe('Wahl je Stamm-ID über Abgleiche hinweg (D14)', () => {
  it('behält eine getroffene Wahl, eine neue Zeile bekommt ihre Vorgabe', () => {
    const v = sanitaetszug();
    let wahl = reconcileWahl(LEERE_WAHL, v);
    wahl = setWahl(wahl, 'fahrzeug', fz(20, 'RTW 1'), false);
    wahl = setWahl(wahl, 'personal', ps(200, 'Anna'), true);
    const neu = sanitaetszug();
    neu.knoten[1].fahrzeuge.push(fz(22, 'RTW 3'));
    const danach = reconcileWahl(wahl, neu);
    expect(danach.fahrzeuge.get(20)?.an).toBe(false);
    expect(danach.personal.get(200)?.an).toBe(true);
    expect(danach.fahrzeuge.get(22)?.an).toBe(true);
  });

  it('eine gebunden gewordene Kraft verliert ihr Häkchen nicht und wird nicht still umgehängt', () => {
    const v = sanitaetszug();
    const wahl = reconcileWahl(LEERE_WAHL, v);
    const gebunden = sanitaetszug({ 21: { zustand: 'gebunden', einheit_name: '2. Zug' } });
    const danach = reconcileWahl(wahl, gebunden);
    expect(danach.fahrzeuge.get(21)).toEqual({ an: true, umhaengen: false });
    expect(showsUmhaengen(gebunden.knoten[1].fahrzeuge[1], danach.fahrzeuge.get(21))).toBe(false);
    const body = buildAnfrage({
      vorlageId: 1,
      name: 'Zug',
      abschnittId: null,
      vorschau: gebunden,
      wahl: danach,
    });
    expect(body.fahrzeuge).toContainEqual({ fahrzeug_id: 21, umhaengen: false });
  });

  it('bietet an einer gebunden gewordenen, angehakten Kraft „umhängen“ an; ein Klick setzt es (LLH-1237)', () => {
    const gebunden = sanitaetszug({ 21: { zustand: 'gebunden', einheit_name: '2. Zug' } });
    const f = gebunden.knoten[1].fahrzeuge[1];
    const danach = reconcileWahl(reconcileWahl(LEERE_WAHL, sanitaetszug()), gebunden);
    expect(offersUmhaengen(f, danach.fahrzeuge.get(21))).toBe(true);
    const umgehaengt = setWahl(danach, 'fahrzeug', f, true);
    expect(umgehaengt.fahrzeuge.get(21)).toEqual({ an: true, umhaengen: true });
    expect(offersUmhaengen(f, umgehaengt.fahrzeuge.get(21))).toBe(false);
    expect(showsUmhaengen(f, umgehaengt.fahrzeuge.get(21))).toBe(true);
    // Nicht angehakt trägt das Kästchen selbst „umhängen“; eine freie Kraft braucht keinen Griff.
    expect(offersUmhaengen(f, { an: false, umhaengen: false })).toBe(false);
    expect(offersUmhaengen(f, undefined)).toBe(false);
    expect(offersUmhaengen(fz(20, 'RTW 1'), { an: true, umhaengen: false })).toBe(false);
  });

  it('ein Häkchen an einer gebundenen Kraft heißt umhängen', () => {
    const f = fz(21, 'RTW 2', { zustand: 'gebunden', einheit_name: '2. Zug' });
    const p = ps(202, 'Cleo', { zustand: 'gebunden', fahrzeug_name: '83-4' });
    let wahl = setWahl(LEERE_WAHL, 'fahrzeug', f, true);
    wahl = setWahl(wahl, 'personal', p, true);
    expect(wahl.fahrzeuge.get(21)).toEqual({ an: true, umhaengen: true });
    expect(wahl.personal.get(202)).toEqual({ an: true, umhaengen: true });
    expect(showsUmhaengen(f, wahl.fahrzeuge.get(21))).toBe(true);
    expect(showsUmhaengen(f, undefined)).toBe(true);
    expect(umhaengenText('fahrzeug', f)).toBe('umhängen aus «2. Zug»');
    expect(umhaengenText('personal', p)).toBe('umhängen von «83-4»');
    expect(umhaengenText('personal', { ...p, einheit_name: '1. Zug' })).toBe(
      'umhängen aus «1. Zug»',
    );
    expect(umhaengenText('fahrzeug', fz(1, 'X'))).toBeNull();
  });
});

describe('Zustand als Wort (D4)', () => {
  it('nennt jeden Zustand', () => {
    expect(zustandWort('fahrzeug', fz(1, 'X'))).toBe('neu');
    expect(zustandWort('fahrzeug', fz(1, 'X', { zustand: 'frei' }))).toBe('im Einsatz');
    expect(
      zustandWort('fahrzeug', fz(1, 'X', { zustand: 'gebunden', einheit_name: '2. Zug' })),
    ).toBe('in «2. Zug»');
    expect(
      zustandWort('personal', ps(1, 'X', { zustand: 'gebunden', fahrzeug_name: '83-4' })),
    ).toBe('auf «83-4»');
    expect(zustandWort('personal', ps(1, 'X', { zustand: 'ausser_dienst' }))).toBe('außer Dienst');
    expect(zustandWort('personal', ps(1, 'X', { zustand: 'entlassen' }))).toBe('entlassen');
  });
});

describe('Fahrzeugbindung (D4, Entscheidung 14.10.2026)', () => {
  it('eine Person, deren Fahrzeug abgewählt ist, zeigt „ohne Fahrzeug“', () => {
    const v = sanitaetszug();
    let wahl = reconcileWahl(LEERE_WAHL, v);
    const anna = v.knoten[1].personal[0];
    expect(ohneFahrzeug(anna, v, wahl)).toBe(false);
    wahl = setWahl(wahl, 'fahrzeug', v.knoten[1].fahrzeuge[0], false);
    wahl = setWahl(wahl, 'personal', anna, true);
    expect(ohneFahrzeug(anna, v, wahl)).toBe(true);
    // Ohne Fahrzeug in der Vorlage gibt es nichts zu verlieren.
    expect(ohneFahrzeug(v.knoten[1].personal[3], v, wahl)).toBe(false);
  });

  it('außer Dienst, gebunden ohne Umhängen und ein gesperrtes Modul nehmen das Fahrzeug nicht mit', () => {
    const v = sanitaetszug({
      10: { zustand: 'ausser_dienst' },
      20: { zustand: 'gebunden', einheit_name: '2. Zug' },
    });
    const wahl = reconcileWahl(LEERE_WAHL, v);
    expect(kommtMit(v.knoten[0].fahrzeuge[0], wahl)).toBe(false);
    expect(kommtMit(v.knoten[1].fahrzeuge[0], wahl)).toBe(false);
    expect(ohneFahrzeug(v.knoten[0].personal[0], v, wahl)).toBe(true);
    const umgehaengt = setWahl(wahl, 'fahrzeug', v.knoten[1].fahrzeuge[0], true);
    expect(kommtMit(v.knoten[1].fahrzeuge[0], umgehaengt)).toBe(true);
    const gesperrt = { ...sanitaetszug(), fahrzeuge_gesperrt: true };
    gesperrt.knoten = gesperrt.knoten.map((k) => ({ ...k, fahrzeuge: [] }));
    expect(
      ohneFahrzeug(gesperrt.knoten[1].personal[0], gesperrt, reconcileWahl(LEERE_WAHL, gesperrt)),
    ).toBe(true);
  });

  it('eine freie Person auf ihrem Vorlagen-Fahrzeug verlässt es, wenn es abgewählt ist', () => {
    const v = sanitaetszug(
      { 20: { zustand: 'frei', ef_id: 7 } },
      {
        200: { zustand: 'frei', ep_id: 70, ef_id: 7, fahrzeug_name: 'RTW 1' },
      },
    );
    const anna = v.knoten[1].personal[0];
    let wahl = reconcileWahl(LEERE_WAHL, v);
    wahl = setWahl(wahl, 'personal', anna, true);
    expect(verlaesstFahrzeug(anna, v, wahl)).toBeNull();
    wahl = setWahl(wahl, 'fahrzeug', v.knoten[1].fahrzeuge[0], false);
    expect(verlaesstFahrzeug(anna, v, wahl)).toBe('RTW 1');
    // Nicht gewählt: sie bleibt, wo sie ist.
    expect(verlaesstFahrzeug(anna, v, setWahl(wahl, 'personal', anna, false))).toBeNull();
  });
});

describe('Deckel (D7)', () => {
  it('nennt mehr als 50 gewählte Personen oder Fahrzeuge', () => {
    const viele = Array.from({ length: 51 }, (_, i) => ps(1000 + i, `P${i}`));
    const v: VorlageVorschau = {
      vorlage_id: 1,
      fahrzeuge_gesperrt: false,
      personal_gesperrt: false,
      knoten: [knoten(1, 'Bereitschaft', 'Bereitschaft', [], viele)],
    };
    let wahl = reconcileWahl(LEERE_WAHL, v);
    for (const p of viele.slice(0, 50)) wahl = setWahl(wahl, 'personal', p, true);
    expect(deckelGrund(v, wahl)).toBeNull();
    wahl = setWahl(wahl, 'personal', viele[50], true);
    expect(deckelGrund(v, wahl)).toBe('Höchstens 50 Personen je Bildung');
  });
});

describe('Namenswarnung (D15)', () => {
  const einheiten = [
    { id: 1, name: 'Sanitätszug Musterstadt', aufgeloest_at: null },
    { id: 2, name: '2. Zug', aufgeloest_at: '2026-10-14T08:00:00Z' },
  ] as Einheit[];
  it('warnt bei gleichem Namen einer aktiven Einheit, ohne Rücksicht auf Groß- und Leerzeichen', () => {
    expect(isNameVergeben(' sanitätszug musterstadt ', einheiten)).toBe(true);
    expect(isNameVergeben('2. Zug', einheiten)).toBe(false);
    expect(isNameVergeben('', einheiten)).toBe(false);
  });
});

describe('Anfrage und Gründe (D3, D6)', () => {
  it('schickt nur gewählte Zeilen der Vorschau, den getrimmten Namen und nichts aus gesperrten Modulen', () => {
    const v = sanitaetszug({ 21: { zustand: 'gebunden', einheit_name: '2. Zug' } });
    let wahl = reconcileWahl(LEERE_WAHL, v);
    wahl = setWahl(wahl, 'fahrzeug', v.knoten[1].fahrzeuge[1], true);
    wahl = setWahl(wahl, 'personal', v.knoten[1].personal[3], true);
    // Eine Wahl ohne Zeile in der Vorschau (aus der Vorlage gefallen) geht nicht mit.
    wahl = setWahl(wahl, 'personal', ps(999, 'Weg'), true);
    expect(
      buildAnfrage({ vorlageId: 1, name: ' 1. Zug ', abschnittId: 4, vorschau: v, wahl }),
    ).toEqual({
      vorlage_id: 1,
      name: '1. Zug',
      abschnitt_id: 4,
      fahrzeuge: [
        { fahrzeug_id: 10, umhaengen: false },
        { fahrzeug_id: 20, umhaengen: false },
        { fahrzeug_id: 21, umhaengen: true },
      ],
      personal: [{ personal_id: 203, umhaengen: false }],
    });
    const ohnePersonal = { ...v, personal_gesperrt: true };
    expect(
      buildAnfrage({ vorlageId: 1, name: 'Zug', abschnittId: null, vorschau: ohnePersonal, wahl })
        .personal,
    ).toEqual([]);
  });

  it('liest die Gründe je Zeile aus der Ablehnung, Stamm-IDs beider Arten getrennt', () => {
    const fehler = new ApiError(422, 'Nicht alle Kräfte lassen sich übernehmen', {
      zeilen: [
        { art: 'fahrzeug', id: 21, grund: 'in «2. Zug»' },
        { art: 'personal', id: 21, grund: 'außer Dienst' },
      ],
    });
    expect(gruendeJeZeile(fehler)).toEqual(
      new Map([
        [zeilenSchluessel('fahrzeug', 21), 'in «2. Zug»'],
        [zeilenSchluessel('personal', 21), 'außer Dienst'],
      ]),
    );
    expect(gruendeJeZeile(new Error('x')).size).toBe(0);
  });
});
