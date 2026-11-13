import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { einsatzKeys } from '../api/queryKeys';
import type { Person, PersonAuswahl } from '../api/types';
import { erzeugeLiveSammler, LIVE_SAMMELFENSTER_MS } from './liveInvalidierung';
import { erzeugeZeilenSammler, ZEILEN_GRENZE } from './zeilenAbgleich';

const api = vi.hoisted(() => ({ ladePersonZeile: vi.fn() }));

vi.mock('../api/einsatzPerson', async (orig) => ({
  ...(await orig<typeof import('../api/einsatzPerson')>()),
  ladePersonZeile: api.ladePersonZeile,
}));

const E = 7;

/** Die Prefixe, mit denen der Sammler alle Personenlisten auf einmal abgleicht. */
const SAMMEL_KEYS = [einsatzKeys.personen(E), einsatzKeys.personenAuswahl(E)];

const person = (id: number, registrier_nr: number, extra: Partial<Person> = {}) =>
  ({
    id,
    registrier_nr,
    status: 'betroffen',
    name: `Name ${id}`,
    vorname: 'Vorname',
    pat_nummer: null,
    notiz: 'Freitext',
    herkunft_adresse: 'Adresse',
    storniert_at: null,
    aktuelle_verbleib_art: null,
    aktuelle_verbleib_betreuungsstelle_id: null,
    ...extra,
  }) as unknown as Person;

const auswahl = (p: Person): PersonAuswahl => ({
  id: p.id,
  registrier_nr: p.registrier_nr,
  status: p.status,
  name: p.name,
  vorname: p.vorname,
  pat_nummer: p.pat_nummer,
});

const inStelle = (stelle: number): Partial<Person> => ({
  aktuelle_verbleib_art: 'notunterkunft',
  aktuelle_verbleib_betreuungsstelle_id: stelle,
});

function aufbau() {
  const qc = new QueryClient();
  const inval = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
  const sammler = erzeugeLiveSammler(qc);
  const zeilen = erzeugeZeilenSammler(qc, sammler, E);
  return { qc, inval, zeilen };
}

const invalidierteKeys = (inval: ReturnType<typeof aufbau>['inval']) =>
  inval.mock.calls.map((c) => c[0]?.queryKey);

const ids = (liste: { id: number }[] | undefined) => liste?.map((z) => z.id);

async function fenster() {
  await vi.advanceTimersByTimeAsync(LIVE_SAMMELFENSTER_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
  api.ladePersonZeile.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Zeilenabgleich der Personen (LLH-1682)', () => {
  it('lädt nur die geänderte Person und ersetzt sie in Liste und Auswahl, ohne Listenabruf', async () => {
    const { qc, inval, zeilen } = aufbau();
    const p1 = person(1, 1);
    const p2 = person(2, 2);
    qc.setQueryData(einsatzKeys.personen(E), [p1, p2]);
    qc.setQueryData(einsatzKeys.personenAuswahl(E), [auswahl(p1), auswahl(p2)]);
    api.ladePersonZeile.mockResolvedValue(person(2, 2, { status: 'vermisst', name: 'Neu' }));

    zeilen.vormerken('personen', 2);
    await fenster();

    expect(api.ladePersonZeile).toHaveBeenCalledTimes(1);
    expect(api.ladePersonZeile).toHaveBeenCalledWith(E, 2);
    const liste = qc.getQueryData<Person[]>(einsatzKeys.personen(E));
    expect(liste?.map((p) => [p.id, p.status, p.name])).toEqual([
      [1, 'betroffen', 'Name 1'],
      [2, 'vermisst', 'Neu'],
    ]);
    expect(qc.getQueryData<PersonAuswahl[]>(einsatzKeys.personenAuswahl(E))?.[1]).toEqual({
      id: 2,
      registrier_nr: 2,
      status: 'vermisst',
      name: 'Neu',
      vorname: 'Vorname',
      pat_nummer: null,
    });
    await fenster();
    expect(inval).not.toHaveBeenCalled();
  });

  it('ordnet eine neue Person nach der Registriernummer aufsteigend wie das SQL', async () => {
    const { qc, zeilen } = aufbau();
    qc.setQueryData(einsatzKeys.personen(E), [person(1, 1), person(3, 3)]);
    qc.setQueryData(einsatzKeys.personenAuswahl(E), [auswahl(person(1, 1)), auswahl(person(3, 3))]);
    api.ladePersonZeile.mockResolvedValue(person(2, 2));

    zeilen.vormerken('personen', 2);
    await fenster();

    expect(ids(qc.getQueryData<Person[]>(einsatzKeys.personen(E)))).toEqual([1, 2, 3]);
    expect(ids(qc.getQueryData<PersonAuswahl[]>(einsatzKeys.personenAuswahl(E)))).toEqual([
      1, 2, 3,
    ]);
  });

  it('die Auswahl trägt keine Freitexte der Zeile', async () => {
    const { qc, zeilen } = aufbau();
    qc.setQueryData(einsatzKeys.personenAuswahl(E), []);
    api.ladePersonZeile.mockResolvedValue(person(1, 1));

    zeilen.vormerken('personen', 1);
    await fenster();

    const [eintrag] = qc.getQueryData<PersonAuswahl[]>(einsatzKeys.personenAuswahl(E)) ?? [];
    expect(Object.keys(eintrag).sort()).toEqual(
      ['id', 'name', 'pat_nummer', 'registrier_nr', 'status', 'vorname'].sort(),
    );
  });

  it('ein Storno entfernt die Person aus Liste, Auswahl und den Betroffenen ihrer Stelle', async () => {
    const { qc, zeilen } = aufbau();
    const p = person(1, 1, inStelle(3));
    qc.setQueryData(einsatzKeys.personen(E), [p, person(2, 2)]);
    qc.setQueryData(einsatzKeys.personenAuswahl(E), [auswahl(p), auswahl(person(2, 2))]);
    qc.setQueryData(einsatzKeys.personenDerStelle(E, 3), [p]);
    api.ladePersonZeile.mockResolvedValue({ ...p, storniert_at: '2026-11-13 10:00:00' });

    zeilen.vormerken('personen', 1);
    await fenster();

    expect(ids(qc.getQueryData<Person[]>(einsatzKeys.personen(E)))).toEqual([2]);
    expect(ids(qc.getQueryData<PersonAuswahl[]>(einsatzKeys.personenAuswahl(E)))).toEqual([2]);
    expect(qc.getQueryData<Person[]>(einsatzKeys.personenDerStelle(E, 3))).toEqual([]);
  });

  it('ein Verbleib in eine Notunterkunft trägt die Person in deren Betroffene ein, nicht in andere', async () => {
    const { qc, inval, zeilen } = aufbau();
    const andere = person(5, 5, inStelle(3));
    qc.setQueryData(einsatzKeys.personenDerStelle(E, 3), [andere]);
    qc.setQueryData(einsatzKeys.personenDerStelle(E, 4), []);
    api.ladePersonZeile.mockResolvedValue(person(2, 2, inStelle(3)));

    zeilen.vormerken('personen', 2);
    await fenster();

    expect(ids(qc.getQueryData<Person[]>(einsatzKeys.personenDerStelle(E, 3)))).toEqual([2, 5]);
    expect(qc.getQueryData<Person[]>(einsatzKeys.personenDerStelle(E, 4))).toEqual([]);
    await fenster();
    expect(inval).not.toHaveBeenCalled();
  });

  it('verlässt die Person die Notunterkunft, fällt sie aus deren Betroffenen', async () => {
    const { qc, zeilen } = aufbau();
    const p = person(2, 2, inStelle(3));
    qc.setQueryData(einsatzKeys.personenDerStelle(E, 3), [p]);
    api.ladePersonZeile.mockResolvedValue({
      ...p,
      aktuelle_verbleib_art: 'entlassung',
      aktuelle_verbleib_betreuungsstelle_id: null,
    });

    zeilen.vormerken('personen', 2);
    await fenster();

    expect(qc.getQueryData<Person[]>(einsatzKeys.personenDerStelle(E, 3))).toEqual([]);
  });

  it('scheitert der Zeilenabruf (etwa 404 am Gerät), gleicht sie die Listen als Ganzes ab', async () => {
    const { qc, inval, zeilen } = aufbau();
    const vorher = [person(1, 1)];
    qc.setQueryData(einsatzKeys.personen(E), vorher);
    api.ladePersonZeile.mockRejectedValue(new Error('404'));

    zeilen.vormerken('personen', 2);
    await fenster();
    await fenster();

    expect(qc.getQueryData(einsatzKeys.personen(E))).toBe(vorher);
    expect(invalidierteKeys(inval)).toEqual(SAMMEL_KEYS);
  });

  it(`über ${ZEILEN_GRENZE} Personen im Fenster ruft sie die Listen einmal ab`, async () => {
    const { qc, inval, zeilen } = aufbau();
    qc.setQueryData(einsatzKeys.personen(E), []);

    for (let id = 1; id <= ZEILEN_GRENZE + 1; id += 1) zeilen.vormerken('personen', id);
    await fenster();
    await fenster();

    expect(api.ladePersonZeile).not.toHaveBeenCalled();
    expect(invalidierteKeys(inval)).toEqual(SAMMEL_KEYS);
  });
});
