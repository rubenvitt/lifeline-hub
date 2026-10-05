import { describe, it, expect, vi } from 'vitest';
import { wendeKartenDatenAn } from './kartenDaten';

/**
 * Regressionsschutz: Solange der Kartenstil nicht angewandt ist, wirft `addSource`/`addLayer`
 * (terra-draw, `setStyle`). Die Anwendung muss auf den ersten Frame mit angewandtem Stil
 * nachgezogen werden — nicht verworfen und nicht erst bei `idle`. Je Karte und Schlüssel wartet
 * höchstens eine Anwendung (LFH-943).
 */
describe('wendeKartenDatenAn', () => {
  /** Minimale Karte mit den von wendeKartenDatenAn genutzten Feldern. */
  type FakeMap = Parameters<typeof wendeKartenDatenAn>[0];
  function fakeMap(stilAngewandt: () => boolean, kachelnGeladen: () => boolean = () => true) {
    const handler: Record<string, Array<() => void>> = {};
    let entfernt = false;
    const map = {
      // Wie maplibre: `isStyleLoaded()` verlangt zusätzlich alle Kacheln.
      isStyleLoaded: () => stilAngewandt() && kachelnGeladen(),
      get style() {
        return entfernt ? undefined : { _loaded: stilAngewandt() };
      },
      on: vi.fn((ev: string, cb: () => void) => {
        (handler[ev] ??= []).push(cb);
      }),
      off: vi.fn((ev: string, cb: () => void) => {
        handler[ev] = (handler[ev] ?? []).filter((h) => h !== cb);
      }),
    };
    const feuere = (ev: string) => (handler[ev] ?? []).slice().forEach((h) => h());
    const hoerer = (ev: string) => (handler[ev] ?? []).length;
    const entferne = () => {
      entfernt = true;
    };
    return {
      map: map as unknown as FakeMap,
      on: map.on,
      off: map.off,
      feuere,
      hoerer,
      entferne,
    };
  }

  it('wendet sofort an, wenn der Stil angewandt ist', () => {
    const anwenden = vi.fn();
    const { map, on } = fakeMap(() => true);
    wendeKartenDatenAn(map, 'abschnitte', anwenden);

    expect(anwenden).toHaveBeenCalledTimes(1);
    expect(on).not.toHaveBeenCalled();
  });

  it('vertagt auf den ersten render-Frame mit angewandtem Stil (verwirft NICHT)', () => {
    const anwenden = vi.fn();
    let geladen = false;
    const { map, on, off, feuere, hoerer } = fakeMap(() => geladen);

    wendeKartenDatenAn(map, 'abschnitte', anwenden);

    // Kern des Bugs: NICHT sofort anwenden, aber auch nicht verlieren.
    expect(anwenden).not.toHaveBeenCalled();
    expect(on).toHaveBeenCalledWith('render', expect.any(Function));

    // Frame, während der Stil noch lädt → weiter warten, nicht abmelden.
    feuere('render');
    expect(anwenden).not.toHaveBeenCalled();
    expect(off).not.toHaveBeenCalled();

    // Erster Frame mit angewandtem Stil → anwenden und abmelden.
    geladen = true;
    feuere('render');
    expect(anwenden).toHaveBeenCalledTimes(1);
    expect(hoerer('render')).toBe(0);
  });

  it('50 Aufrufe mit demselben Schlüssel: ein Hörer, nur der letzte Stand läuft', () => {
    let geladen = false;
    const { map, on, feuere, hoerer } = fakeMap(() => geladen);
    const laeufe: number[] = [];

    for (let i = 0; i < 50; i += 1) wendeKartenDatenAn(map, 'eigenposition', () => laeufe.push(i));

    expect(on).toHaveBeenCalledTimes(1);
    expect(hoerer('render')).toBe(1);

    geladen = true;
    feuere('render');
    expect(laeufe).toEqual([49]);
    expect(hoerer('render')).toBe(0);
  });

  it('verschiedene Schlüssel teilen einen Hörer und laufen in der Folge ihrer letzten Anmeldung', () => {
    let geladen = false;
    const { map, on, feuere } = fakeMap(() => geladen);
    const laeufe: string[] = [];

    wendeKartenDatenAn(map, 'marker', () => laeufe.push('marker-alt'));
    wendeKartenDatenAn(map, 'eigenposition', () => laeufe.push('eigenposition'));
    // Ersetzen rückt ans Ende: so lief es auch mit gestapelten Hörern zuletzt (Ebenenfolge).
    wendeKartenDatenAn(map, 'marker', () => laeufe.push('marker-neu'));

    expect(on).toHaveBeenCalledTimes(1);
    geladen = true;
    feuere('render');
    expect(laeufe).toEqual(['eigenposition', 'marker-neu']);
  });

  it('wartet nicht auf Kacheln: bereit ist der angewandte Stil, nicht isStyleLoaded()', () => {
    const anwenden = vi.fn();
    const { map, on } = fakeMap(
      () => true,
      () => false,
    );

    wendeKartenDatenAn(map, 'eigenposition', anwenden);

    expect(anwenden).toHaveBeenCalledTimes(1);
    expect(on).not.toHaveBeenCalled();
  });

  it('bereit, aber etwas steht noch aus: reiht sich hinten an statt zu überholen', () => {
    let geladen = false;
    const { map, feuere } = fakeMap(() => geladen);
    const laeufe: string[] = [];

    wendeKartenDatenAn(map, 'stil-neuaufbau', () => laeufe.push('neuaufbau'));
    // `style.load` ist durch, der Neuaufbau läuft erst im nächsten Frame. Der Zonen-Start
    // meldet sich am `style.load` an und darf ihn nicht überholen (LFH-825 D6).
    geladen = true;
    wendeKartenDatenAn(map, 'zonen-start', () => laeufe.push('zonen-start'));
    expect(laeufe).toEqual([]);

    feuere('render');
    expect(laeufe).toEqual(['neuaufbau', 'zonen-start']);
  });

  it('was ein Eintrag beim Abarbeiten anmeldet, läuft im selben Durchgang mit', () => {
    let geladen = false;
    const { map, feuere, hoerer } = fakeMap(() => geladen);
    const laeufe: string[] = [];

    wendeKartenDatenAn(map, 'a', () => {
      laeufe.push('a');
      wendeKartenDatenAn(map, 'b', () => laeufe.push('b'));
    });
    geladen = true;
    feuere('render');
    expect(laeufe).toEqual(['a', 'b']);
    expect(hoerer('render')).toBe(0);
  });

  it('auf einer entfernten Karte läuft nichts mehr', () => {
    let geladen = false;
    const anwenden = vi.fn();
    const { map, feuere, entferne } = fakeMap(() => geladen);

    wendeKartenDatenAn(map, 'abschnitte', anwenden);
    entferne();
    geladen = true;
    feuere('render');
    wendeKartenDatenAn(map, 'zonen', anwenden);

    expect(anwenden).not.toHaveBeenCalled();
  });

  it('zwei Karten haben getrennte Warteschlangen', () => {
    let geladen = false;
    const a = fakeMap(() => geladen);
    const b = fakeMap(() => geladen);
    const laeufe: string[] = [];

    wendeKartenDatenAn(a.map, 'marker', () => laeufe.push('a'));
    wendeKartenDatenAn(b.map, 'marker', () => laeufe.push('b'));
    geladen = true;
    a.feuere('render');
    expect(laeufe).toEqual(['a']);
    b.feuere('render');
    expect(laeufe).toEqual(['a', 'b']);
  });
});
