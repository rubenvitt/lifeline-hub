import { describe, expect, it } from 'vitest';
import {
  EINPASS_RAND,
  ZOOM_MAX,
  ZOOM_SCHRITT,
  eingepasst,
  kleinsterMassstab,
  mindestMassstab,
  radFaktor,
  trefferboden,
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

describe('Mindestmaßstab je Dichte-Stufe (LFH-1038 D1, D2)', () => {
  const KOMPAKT = trefferboden({ controlHeight: 30 });
  const KOMFORTABEL = trefferboden({ controlHeight: 48 });
  const HANDSCHUH = trefferboden({ controlHeight: 72 });
  /** Eine Einheit (144 × 88) an der Stelle `y`. */
  const einheit = (y: number, key = `eh-${y}`) => ({
    key,
    x: 0,
    y,
    breite: 144,
    hoehe: 88,
    rand: 0,
  });
  /** Eine Schiene: Linie bei `y`, Band von 72 px. */
  const schiene = (key: string, x: number, y: number, breite = 400) => ({
    key,
    x,
    y,
    breite,
    hoehe: 0,
    rand: 36,
  });

  it('Böden: kompakt und komfortabel 24 px ohne Abstand, Handschuh 72 px mit 16 px', () => {
    expect(KOMPAKT).toEqual({ ziel: 24, abstand: 0 });
    expect(KOMFORTABEL).toEqual({ ziel: 24, abstand: 0 });
    expect(HANDSCHUH).toEqual({ ziel: 72, abstand: 16 });
  });

  it('die kurze Seite des kleinsten Ziels hält den Boden', () => {
    const ziele = [einheit(0), { key: 'ko-1', x: 200, y: 0, breite: 96, hoehe: 56, rand: 0 }];
    expect(mindestMassstab(ziele, KOMPAKT)).toBeCloseTo(24 / 56);
  });

  it('Handschuh: der Abstand zweier Stellen hält 16 px', () => {
    // Größe allein: 72 / 88 ≈ 0,82; der Abstand von 16 E. verlangt 1.
    expect(mindestMassstab([einheit(0), einheit(104)], HANDSCHUH)).toBeCloseTo(1);
  });

  it('Handschuh: eine Schiene zählt mit ihrem Band in Pixeln, senkrecht', () => {
    // Einheit unten bei 192, Linie bei 232: 40 · s − 36 ≥ 16 → s ≥ 1,3.
    expect(mindestMassstab([einheit(104), schiene('sg-1', 0, 232)], HANDSCHUH)).toBeCloseTo(
      52 / 40,
    );
    // Zwei Schienenspuren 64 E. auseinander: 64 · s − 72 ≥ 16 → s ≥ 1,375.
    expect(
      mindestMassstab([schiene('sg-1', 0, 232), schiene('sg-2', 0, 296)], HANDSCHUH),
    ).toBeCloseTo(88 / 64);
  });

  it('Handschuh: waagerecht trägt das Band nichts bei', () => {
    // Zwei Schienen in einer Spur, 16 E. auseinander: 16 · s ≥ 16 → s ≥ 1.
    expect(
      mindestMassstab([schiene('sg-1', 0, 232), schiene('sg-2', 416, 232)], HANDSCHUH),
    ).toBeCloseTo(1);
    // Schräg: 16 E. waagerecht, 40 E. senkrecht unter der Linie.
    const s = mindestMassstab(
      [schiene('sg-1', 0, 232), { key: 'eh-x', x: 416, y: 272, breite: 144, hoehe: 88, rand: 0 }],
      HANDSCHUH,
    );
    expect(Math.hypot(16 * s, Math.max(0, 40 * s - 36))).toBeCloseTo(16, 3);
  });

  it('kompakt verlangt keinen Abstand, auch bei dicht stehenden Zielen', () => {
    expect(mindestMassstab([einheit(0), einheit(90)], KOMPAKT)).toBeCloseTo(24 / 88);
  });

  it('überlappende und über eine Stichleitung verbundene Ziele zählen nicht', () => {
    // Komponente 8 E. rechts vom Ende ihrer Schiene, dazwischen die Stichleitung.
    const komponente = { key: 'ko-1', x: 408, y: 216, breite: 96, hoehe: 88, rand: 0 };
    const ziele = [komponente, schiene('sg-1', 0, 232), einheit(0), einheit(40)];
    const verbunden = (a: string, b: string) =>
      [a, b].sort().join('|') === ['ko-1', 'sg-1'].sort().join('|');
    expect(mindestMassstab(ziele, HANDSCHUH, verbunden)).toBe(72 / 88);
    // Ohne die Verbindung verlangten die 8 E. Lücke Maßstab 2.
    expect(mindestMassstab(ziele, HANDSCHUH)).toBeCloseTo(2);
  });

  it('gedeckelt auf ZOOM_MAX, leere Skizze ohne Boden', () => {
    const winzig = { key: 'eh-1', x: 0, y: 0, breite: 4, hoehe: 4, rand: 0 };
    expect(mindestMassstab([winzig], HANDSCHUH)).toBe(ZOOM_MAX);
    expect(mindestMassstab([], HANDSCHUH)).toBe(0);
  });
});
