import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { ladeEinsatzbericht } from './abruf';
import { QUELLEN, type QuellenFreigabe, type QuellenSchluessel } from './quellen';

const api = vi.hoisted(() => ({
  ladeEinsatz: vi.fn(),
  ladeMitglieder: vi.fn(),
  ladeStab: vi.fn(),
  ladeLagebesprechungen: vi.fn(),
  listeEinheiten: vi.fn(),
  listeEinheitenPerioden: vi.fn(),
  listeEinsatzPersonal: vi.fn(),
  listePersonalPerioden: vi.fn(),
  listeEinsatzFahrzeuge: vi.fn(),
  listeLageberichte: vi.fn(),
  listePersonen: vi.fn(),
  listeSchaeden: vi.fn(),
  ladeBetreuung: vi.fn(),
  ladeVerpflegung: vi.fn(),
  ladeEtbZaehler: vi.fn(),
  ladeEtbVollstaendig: vi.fn(),
}));

vi.mock('../../api/einsaetze', () => ({
  ladeEinsatz: api.ladeEinsatz,
  ladeMitglieder: api.ladeMitglieder,
}));
vi.mock('../../api/stab', () => ({
  ladeStab: api.ladeStab,
  ladeLagebesprechungen: api.ladeLagebesprechungen,
}));
vi.mock('../../api/einheiten', () => ({ listeEinheiten: api.listeEinheiten }));
vi.mock('../../api/kraefteZeitachse', () => ({
  listeEinheitenPerioden: api.listeEinheitenPerioden,
  listePersonalPerioden: api.listePersonalPerioden,
}));
vi.mock('../../api/einsatzPersonal', () => ({ listeEinsatzPersonal: api.listeEinsatzPersonal }));
vi.mock('../../api/einsatzFahrzeuge', () => ({ listeEinsatzFahrzeuge: api.listeEinsatzFahrzeuge }));
vi.mock('../../api/lageberichte', () => ({ listeLageberichte: api.listeLageberichte }));
vi.mock('../../api/einsatzPerson', () => ({ listePersonen: api.listePersonen }));
vi.mock('../../api/einsatzSchaden', () => ({ listeSchaeden: api.listeSchaeden }));
vi.mock('../../api/betreuung', () => ({ ladeBetreuung: api.ladeBetreuung }));
vi.mock('../../api/verpflegung', () => ({ ladeVerpflegung: api.ladeVerpflegung }));
vi.mock('../../api/etb', () => ({ ladeEtbZaehler: api.ladeEtbZaehler }));
vi.mock('../../etb/druckAbruf', () => ({ ladeEtbVollstaendig: api.ladeEtbVollstaendig }));

function alle(zustand: QuellenFreigabe): Record<QuellenSchluessel, QuellenFreigabe> {
  return Object.fromEntries(QUELLEN.map((q) => [q.schluessel, zustand])) as Record<
    QuellenSchluessel,
    QuellenFreigabe
  >;
}

beforeEach(() => {
  for (const [name, fn] of Object.entries(api)) {
    fn.mockReset();
    fn.mockResolvedValue({ quelle: name });
  }
});

describe('ladeEinsatzbericht', () => {
  it('lädt jede freigegebene Quelle für den Einsatz und setzt einen Stand', async () => {
    const bericht = await ladeEinsatzbericht(5, alle('abrufen'));
    for (const fn of Object.values(api)) expect(fn).toHaveBeenCalledTimes(1);
    expect(api.ladeEinsatz).toHaveBeenCalledWith(5);
    expect(api.ladeEtbVollstaendig).toHaveBeenCalledWith(5, { typ: 'entscheidung' });
    expect(bericht.quellen.lageberichte).toEqual({
      zustand: 'daten',
      daten: { quelle: 'listeLageberichte' },
    });
    expect(Number.isNaN(Date.parse(bericht.geladenAt))).toBe(false);
  });

  it('ruft eine nicht genutzte Quelle nicht ab', async () => {
    const freigabe = { ...alle('abrufen'), betreuung: 'nicht-genutzt' as const };
    const bericht = await ladeEinsatzbericht(5, freigabe);
    expect(api.ladeBetreuung).not.toHaveBeenCalled();
    expect(bericht.quellen.betreuung).toEqual({ zustand: 'nicht-genutzt' });
  });

  it('ruft eine gesperrte Quelle nicht ab und meldet kein-zugriff', async () => {
    const freigabe = { ...alle('abrufen'), personen: 'gesperrt' as const };
    const bericht = await ladeEinsatzbericht(5, freigabe);
    expect(api.listePersonen).not.toHaveBeenCalled();
    expect(bericht.quellen.personen).toEqual({ zustand: 'kein-zugriff' });
  });

  it('ein 403 ist kein-zugriff, nie ein leerer Bestand', async () => {
    api.listeSchaeden.mockRejectedValue(new ApiError(403, 'verboten'));
    const bericht = await ladeEinsatzbericht(5, alle('abrufen'));
    expect(bericht.quellen.schaeden).toEqual({ zustand: 'kein-zugriff' });
  });

  it('ein Serverfehler ist fehler, die übrigen Quellen bleiben daten', async () => {
    const fehler = new ApiError(500, 'kaputt');
    api.listeLageberichte.mockRejectedValue(fehler);
    const bericht = await ladeEinsatzbericht(5, alle('abrufen'));
    expect(bericht.quellen.lageberichte).toEqual({ zustand: 'fehler', fehler });
    expect(bericht.quellen.personen.zustand).toBe('daten');
    expect(bericht.quellen.einsatz.zustand).toBe('daten');
  });
});
