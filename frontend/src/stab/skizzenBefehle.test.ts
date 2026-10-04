import { describe, expect, it, vi } from 'vitest';
import { ApiError, AusgangUnbekannt, NetzFehler } from '../api/client';
import { Befehlsstapel, befehlsGrund, type SkizzenBefehl } from './skizzenBefehle';

/**
 * Befehlsstapel der Fernmeldeskizze (LFH-893 D6): Szenarien „Zuordnung zurücknehmen“ und
 * „Datensatz inzwischen gelöscht“ aus `stab-fernmeldeskizze-bearbeitung`.
 */

/** Ein Befehl über einer Menge, wie eine Zuordnung am Datensatz: Handlung fügt hinzu, Gegenhandlung nimmt weg. */
function zuordnung(menge: Set<string>, eintrag: string, element = 'eh-1'): SkizzenBefehl {
  return {
    beschreibung: `Zuordnung ${eintrag}`,
    element,
    ausfuehren: vi.fn(async () => {
      menge.add(eintrag);
    }),
    zuruecknehmen: vi.fn(async () => {
      menge.delete(eintrag);
    }),
  };
}

function scheitert(fehler: unknown, element = 'eh-1'): SkizzenBefehl {
  return {
    beschreibung: 'Zuordnung DMO 314_F*',
    element,
    ausfuehren: vi.fn(() => Promise.reject(fehler)),
    zuruecknehmen: vi.fn(() => Promise.reject(fehler)),
  };
}

describe('Befehlsstapel', () => {
  it('Zuordnung zurücknehmen: Strg+Z ruft die Gegenhandlung, danach lässt sie sich wiederholen', async () => {
    const zugeordnet = new Set(['DMO 314_F*']);
    const stapel = new Befehlsstapel();
    const b = zuordnung(zugeordnet, 'DMO 314_F*');
    stapel.push(b);
    expect(stapel.stand()).toMatchObject({
      rueckgaengig: 1,
      wiederholen: 0,
      oben: 'Zuordnung DMO 314_F*',
    });

    await expect(stapel.rueckgaengig()).resolves.toEqual({ art: 'ok', befehl: b });
    expect(zugeordnet.has('DMO 314_F*')).toBe(false);
    expect(b.ausfuehren).not.toHaveBeenCalled();
    expect(stapel.stand()).toMatchObject({ rueckgaengig: 0, wiederholen: 1 });

    await expect(stapel.wiederholen()).resolves.toEqual({ art: 'ok', befehl: b });
    expect(zugeordnet.has('DMO 314_F*')).toBe(true);
    expect(stapel.stand()).toMatchObject({ rueckgaengig: 1, wiederholen: 0 });
  });

  it('nimmt in umgekehrter Reihenfolge zurück', async () => {
    const menge = new Set<string>();
    const stapel = new Befehlsstapel();
    const reihenfolge: string[] = [];
    for (const name of ['a', 'b', 'c']) {
      menge.add(name);
      const b = zuordnung(menge, name);
      b.zuruecknehmen = async () => {
        reihenfolge.push(name);
        menge.delete(name);
      };
      stapel.push(b);
    }
    await stapel.rueckgaengig();
    await stapel.rueckgaengig();
    expect(reihenfolge).toEqual(['c', 'b']);
    expect([...menge]).toEqual(['a']);
  });

  it('verwirft das Wiederholen, sobald eine neue Handlung kommt', async () => {
    const menge = new Set<string>();
    const stapel = new Befehlsstapel();
    stapel.push(zuordnung(menge, 'a'));
    await stapel.rueckgaengig();
    stapel.push(zuordnung(menge, 'b'));
    expect(stapel.stand()).toMatchObject({ rueckgaengig: 1, wiederholen: 0 });
    await expect(stapel.wiederholen()).resolves.toEqual({ art: 'leer' });
  });

  it('meldet einen leeren Stapel, ohne etwas zu tun', async () => {
    const stapel = new Befehlsstapel();
    await expect(stapel.rueckgaengig()).resolves.toEqual({ art: 'leer' });
    await expect(stapel.wiederholen()).resolves.toEqual({ art: 'leer' });
  });

  it('Datensatz inzwischen gelöscht: der Grund kommt zurück, der Eintrag fällt weg, sonst ändert sich nichts', async () => {
    const menge = new Set(['a']);
    const stapel = new Befehlsstapel();
    const vorher = zuordnung(menge, 'a', 'ab-1');
    stapel.push(vorher);
    const geloescht = scheitert(new ApiError(404, 'Einheit nicht gefunden'), 'eh-7');
    stapel.push(geloescht);

    await expect(stapel.rueckgaengig()).resolves.toEqual({
      art: 'gescheitert',
      befehl: geloescht,
      element: 'eh-7',
      grund: 'besteht nicht mehr',
      verworfen: true,
    });
    expect(stapel.stand()).toMatchObject({ rueckgaengig: 1, wiederholen: 0, oben: 'Zuordnung a' });
    expect([...menge]).toEqual(['a']);
    expect(vorher.zuruecknehmen).not.toHaveBeenCalled();
  });

  it('verwirft auch einen Eintrag, dessen Wiederholen scheitert', async () => {
    const stapel = new Befehlsstapel();
    const b = scheitert(new ApiError(409, 'Konflikt'));
    b.zuruecknehmen = vi.fn(async () => {});
    stapel.push(b);
    await stapel.rueckgaengig();
    const ergebnis = await stapel.wiederholen();
    expect(ergebnis).toMatchObject({
      art: 'gescheitert',
      grund: 'von einem anderen Arbeitsplatz geändert',
      verworfen: true,
    });
    expect(stapel.stand()).toMatchObject({ rueckgaengig: 0, wiederholen: 0 });
  });

  it('behält den Eintrag, wenn die Anfrage den Server nicht erreicht hat', async () => {
    const stapel = new Befehlsstapel();
    stapel.push(scheitert(new NetzFehler()));
    const ergebnis = await stapel.rueckgaengig();
    expect(ergebnis).toMatchObject({ art: 'gescheitert', verworfen: false });
    expect(stapel.stand()).toMatchObject({ rueckgaengig: 1 });
  });

  it('lässt einen eigenen Grund des Befehls vor dem allgemeinen gelten', async () => {
    const stapel = new Befehlsstapel();
    stapel.push({
      ...scheitert(new ApiError(404, 'x')),
      grund: (f) =>
        f instanceof ApiError && f.status === 404 ? '„1. Zug“ besteht nicht mehr' : null,
    });
    await expect(stapel.rueckgaengig()).resolves.toMatchObject({
      grund: '„1. Zug“ besteht nicht mehr',
    });
  });

  it('nimmt keinen zweiten Schritt an, solange einer läuft', async () => {
    const stapel = new Befehlsstapel();
    let loesen = () => {};
    stapel.push({
      beschreibung: 'langsam',
      element: 'eh-1',
      ausfuehren: async () => {},
      zuruecknehmen: () =>
        new Promise<void>((r) => {
          loesen = r;
        }),
    });
    stapel.push(zuordnung(new Set(), 'b'));
    const zweiter = stapel.rueckgaengig();
    expect(stapel.stand().laeuft).toBe(true);
    const nochmal = stapel.rueckgaengig();
    const vor = stapel.wiederholen();
    await expect(nochmal).resolves.toEqual({ art: 'beschaeftigt' });
    await expect(vor).resolves.toEqual({ art: 'beschaeftigt' });
    await zweiter;
    expect(stapel.stand().laeuft).toBe(false);
    const erster = stapel.rueckgaengig();
    loesen();
    await expect(erster).resolves.toMatchObject({ art: 'ok' });
  });

  it('begrenzt die Tiefe und vergisst die ältesten Einträge', async () => {
    const stapel = new Befehlsstapel({ tiefe: 2 });
    const menge = new Set<string>();
    for (const n of ['a', 'b', 'c']) stapel.push(zuordnung(menge, n));
    expect(stapel.stand()).toMatchObject({ rueckgaengig: 2, oben: 'Zuordnung c' });
  });

  it('benachrichtigt Abonnenten und hält den Stand zwischen Änderungen gleich', async () => {
    const stapel = new Befehlsstapel();
    const hoerer = vi.fn();
    const ab = stapel.abonniere(hoerer);
    const s0 = stapel.stand();
    expect(stapel.stand()).toBe(s0);
    stapel.push(zuordnung(new Set(), 'a'));
    expect(hoerer).toHaveBeenCalledTimes(1);
    expect(stapel.stand()).not.toBe(s0);
    await stapel.rueckgaengig();
    // Beginn und Ende des Schritts.
    expect(hoerer).toHaveBeenCalledTimes(3);
    ab();
    stapel.leeren();
    expect(hoerer).toHaveBeenCalledTimes(3);
    expect(stapel.stand()).toMatchObject({ rueckgaengig: 0, wiederholen: 0 });
  });
});

describe('befehlsGrund', () => {
  it('nennt gelöschte Datensätze, fremde Änderungen und sonst die Meldung des Servers', () => {
    expect(befehlsGrund(new ApiError(404, 'nicht gefunden'))).toBe('besteht nicht mehr');
    expect(befehlsGrund(new ApiError(409, 'Version'))).toBe(
      'von einem anderen Arbeitsplatz geändert',
    );
    expect(befehlsGrund(new ApiError(403, 'Keine Berechtigung für Einheiten'))).toBe(
      'Keine Berechtigung für Einheiten',
    );
    expect(befehlsGrund(new AusgangUnbekannt())).toMatch(/unklar/);
    expect(befehlsGrund(new Error('x'))).toBe('Rücknahme fehlgeschlagen');
  });
});
