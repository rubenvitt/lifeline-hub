import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beendeHuelle,
  starteAndroidHuelle,
  starteIosHuelle,
  starteMacHuelle,
} from '../test/huelle';
import type { RouteObject } from 'react-router';
import { RUECKMELDUNG_FORMULAR, routenMuster, rueckmeldungsAdresse } from './adresse';

const routen: RouteObject[] = [
  {
    path: '/',
    children: [
      { path: '/login' },
      {
        path: '/einsatz/:id',
        children: [{ index: true }, { path: 'etb' }, { path: 'personen/:personId' }],
      },
      { path: '/geraet', children: [{ path: ':id', children: [{ path: 'br/:brId' }] }] },
      { path: '*' },
    ],
  },
];

describe('routenMuster (LLH-1549)', () => {
  it('ersetzt Kennungen durch die Platzhalter der Route', () => {
    expect(routenMuster(routen, '/einsatz/7f3a/etb')).toBe('/einsatz/:id/etb');
    expect(routenMuster(routen, '/einsatz/7f3a/personen/p-99')).toBe(
      '/einsatz/:id/personen/:personId',
    );
    expect(routenMuster(routen, '/geraet/abc/br/42')).toBe('/geraet/:id/br/:brId');
  });

  it('Index- und Fangrouten', () => {
    expect(routenMuster(routen, '/einsatz/7f3a')).toBe('/einsatz/:id');
    expect(routenMuster(routen, '/gibt/es/nicht')).toBe('/*');
    expect(routenMuster([{ path: '/login' }], '/anderes')).toBe('');
  });
});

describe('rueckmeldungsAdresse (LLH-1549)', () => {
  it('Formular mit Version, Oberfläche und Muster, ohne Kennungen', () => {
    const adresse = new URL(
      rueckmeldungsAdresse({
        version: '1.0.0-beta.1',
        pfad: '/einsatz/7f3a/etb',
        routen,
        huelle: true,
      }),
    );
    expect(adresse.origin + adresse.pathname).toBe(
      'https://github.com/rubenvitt/lifeline-hub/issues/new',
    );
    expect(adresse.searchParams.get('template')).toBe('rueckmeldung.yml');
    expect(adresse.searchParams.get('version')).toBe('1.0.0-beta.1');
    expect(adresse.searchParams.get('oberflaeche')).toBe('Desktop-App');
    expect(adresse.searchParams.get('seite')).toBe('/einsatz/:id/etb');
    expect(adresse.toString()).not.toContain('7f3a');
  });

  it('ohne Routen fehlt nur der Bereich', () => {
    const adresse = rueckmeldungsAdresse({
      version: '1.0.0',
      pfad: '/einsatz/7f3a',
      routen: null,
      huelle: false,
    });
    expect(adresse).toBe(`${RUECKMELDUNG_FORMULAR}&version=1.0.0&oberflaeche=Browser`);
  });
});

describe('Oberfläche der Rückmeldung je Hülle (t39ltxxi)', () => {
  afterEach(beendeHuelle);

  const oberflaeche = () =>
    new URL(rueckmeldungsAdresse({ version: '1.0.0', pfad: '/', routen: null })).searchParams.get(
      'oberflaeche',
    );

  it('nennt in der iOS-Hülle die iOS-App (ausgeliefertes Init-Skript)', () => {
    starteIosHuelle({ bruecke: { postMessage: vi.fn() } });
    expect(oberflaeche()).toBe('iOS-App');
  });

  it('nennt in der Android-Hülle die Android-App (ausgeliefertes Init-Skript)', () => {
    starteAndroidHuelle({ bruecke: { postMessage: vi.fn() } });
    expect(oberflaeche()).toBe('Android-App');
  });

  it('nennt in der Desktop-Hülle ohne Plattform weiter die Desktop-App', () => {
    starteMacHuelle();
    expect(oberflaeche()).toBe('Desktop-App');
  });

  it('nennt im Browser den Browser', () => {
    expect(oberflaeche()).toBe('Browser');
  });
});
