import { describe, expect, it } from 'vitest';
import {
  EINPASS_RAND,
  ZOOM_MAX,
  ZOOM_SCHRITT,
  eingepasst,
  kleinsterMassstab,
  radFaktor,
  verschiebeAnsicht,
  viewBoxAus,
  zeige,
  zoome,
  zuFlaeche,
  zuSkizze,
  zweiFinger,
} from './ansicht';

const FLAECHE = { breite: 1000, hoehe: 500 };
const INHALT = { breite: 2016, hoehe: 984 };

describe('Ansicht der Skizze (LFH-893 D1)', () => {
  it('eingepasst: die ganze Skizze steht mittig in der Fläche', () => {
    const a = eingepasst(INHALT, FLAECHE);
    const lo = zuFlaeche(a, { x: 0, y: 0 });
    const ru = zuFlaeche(a, { x: INHALT.breite, y: INHALT.hoehe });
    expect(lo.x).toBeGreaterThanOrEqual(EINPASS_RAND - 1e-9);
    expect(lo.y).toBeGreaterThanOrEqual(EINPASS_RAND - 1e-9);
    expect(ru.x).toBeLessThanOrEqual(FLAECHE.breite - EINPASS_RAND + 1e-9);
    expect(ru.y).toBeLessThanOrEqual(FLAECHE.hoehe - EINPASS_RAND + 1e-9);
    // mittig
    expect(lo.x + ru.x).toBeCloseTo(FLAECHE.breite);
    expect(lo.y + ru.y).toBeCloseTo(FLAECHE.hoehe);
  });

  it('Pixel und Skizzeneinheiten sind Umkehrungen', () => {
    const a = { x: 40, y: -12, skala: 0.7 };
    const p = { x: 123, y: 456 };
    const zurueck = zuFlaeche(a, zuSkizze(a, p));
    expect(zurueck.x).toBeCloseTo(p.x);
    expect(zurueck.y).toBeCloseTo(p.y);
  });

  it('Zoomen ohne Ziehen: zweimal „+“ vergrößert zweimal, um die Mitte', () => {
    const start = eingepasst(INHALT, FLAECHE);
    const mitteVorher = zuSkizze(start, { x: 500, y: 250 });
    const zweimal = zoome(
      zoome(start, ZOOM_SCHRITT, FLAECHE, INHALT),
      ZOOM_SCHRITT,
      FLAECHE,
      INHALT,
    );
    expect(zweimal.skala).toBeCloseTo(start.skala * ZOOM_SCHRITT ** 2);
    const mitteNachher = zuSkizze(zweimal, { x: 500, y: 250 });
    expect(mitteNachher.x).toBeCloseTo(mitteVorher.x);
    expect(mitteNachher.y).toBeCloseTo(mitteVorher.y);
  });

  it('Zoomen hält den Punkt unter dem Zeiger fest', () => {
    const a = { x: 100, y: 50, skala: 1 };
    const zeiger = { x: 200, y: 100 };
    const vorher = zuSkizze(a, zeiger);
    const b = zoome(a, 2, FLAECHE, INHALT, zeiger);
    const nachher = zuSkizze(b, zeiger);
    expect(nachher.x).toBeCloseTo(vorher.x);
    expect(nachher.y).toBeCloseTo(vorher.y);
  });

  it('begrenzt nach oben auf ZOOM_MAX und nach unten auf das Einpassen bzw. ZOOM_MIN', () => {
    const a = { x: 0, y: 0, skala: 3 };
    expect(zoome(a, 10, FLAECHE, INHALT).skala).toBe(ZOOM_MAX);
    const klein = zoome(a, 0.0001, FLAECHE, INHALT);
    expect(klein.skala).toBeCloseTo(kleinsterMassstab(INHALT, FLAECHE));
    // Eine riesige Skizze darf weiter heraus als ZOOM_MIN, sonst ginge „Einpassen“ nicht.
    const riesig = { breite: 20000, hoehe: 10000 };
    expect(kleinsterMassstab(riesig, FLAECHE)).toBeCloseTo(eingepasst(riesig, FLAECHE).skala);
  });

  it('Verschieben: der Inhalt folgt dem Zeiger', () => {
    const a = { x: 10, y: 10, skala: 2 };
    const b = verschiebeAnsicht(a, 40, -20);
    expect(zuFlaeche(b, { x: 10, y: 10 })).toEqual({ x: 40, y: -20 });
  });

  it('viewBox aus der Ansicht', () => {
    expect(viewBoxAus({ x: 10, y: 20, skala: 2 }, FLAECHE)).toBe('10 20 500 250');
  });

  it('Mausrad mit Strg: hinein bei negativem deltaY, ein Rastschritt = ein Knopfdruck', () => {
    expect(radFaktor(-100)).toBeCloseTo(ZOOM_SCHRITT);
    expect(radFaktor(100)).toBeCloseTo(1 / ZOOM_SCHRITT);
    expect(radFaktor(0)).toBe(1);
    expect(radFaktor(-10000)).toBeCloseTo(ZOOM_SCHRITT ** 3);
  });

  it('zwei Finger: Abstand doppelt → Maßstab doppelt, der Punkt unter der Mitte folgt', () => {
    const start = { ansicht: { x: 0, y: 0, skala: 1 }, abstand: 100, mitte: { x: 300, y: 200 } };
    const b = zweiFinger(start, { abstand: 200, mitte: { x: 320, y: 210 } }, FLAECHE, INHALT);
    expect(b.skala).toBeCloseTo(2);
    const p = zuSkizze(b, { x: 320, y: 210 });
    expect(p.x).toBeCloseTo(300);
    expect(p.y).toBeCloseTo(200);
  });

  it('zeige: ein sichtbares Element lässt die Ansicht stehen, ein verdecktes rückt ins Bild', () => {
    const a = { x: 0, y: 0, skala: 1 };
    expect(zeige(a, FLAECHE, { x: 100, y: 100, breite: 50, hoehe: 50 })).toEqual(a);
    const b = zeige(a, FLAECHE, { x: 1500, y: 900, breite: 100, hoehe: 40 });
    const lo = zuFlaeche(b, { x: 1500, y: 900 });
    const ru = zuFlaeche(b, { x: 1600, y: 940 });
    expect(lo.x).toBeGreaterThanOrEqual(0);
    expect(ru.x).toBeLessThanOrEqual(FLAECHE.breite);
    expect(lo.y).toBeGreaterThanOrEqual(0);
    expect(ru.y).toBeLessThanOrEqual(FLAECHE.hoehe);
    expect(b.skala).toBe(1);
  });
});
