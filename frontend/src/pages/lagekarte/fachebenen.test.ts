import { describe, it, expect } from 'vitest';
import {
  autobahnTakt,
  FACHEBENEN,
  fachebeneKeys,
  istBboxAbhaengig,
  KRITIS_MIN_ZOOM,
  rasterBbox,
  mergeFeatures,
} from './fachebenen';

// Minimaler Feature-Builder für die Merge-Tests.
const feat = (lon: number, lat: number) => ({
  type: 'Feature' as const,
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: {},
});

describe('Fachebenen-Registry', () => {
  it('enthält die vier v1-Quellen, Hochwasser, ODL, Luftqualität und die BAB-Lage', () => {
    // Reihenfolge = Anzeigereihenfolge im Panel. `hochwasser` steht neben `pegelonline`,
    // weil es dieselbe Frage beantwortet: dort der rohe Wasserstand, hier die amtliche
    // Bewertung (LFH-77). `odl` (LFH-78) folgt als zweite bewertete Messnetz-Ebene,
    // `luftqualitaet` (LFH-79) als dritte. `autobahn` (LFH-80) hängt hinten an — eigene
    // Fragestellung.
    expect(fachebeneKeys()).toEqual([
      'nina',
      'dwd',
      'pegelonline',
      'hochwasser',
      'odl',
      'luftqualitaet',
      'kritis',
      'autobahn',
    ]);
  });
  it('führt die Hochwasserebene als Punktebene mit Hintergrund-Polling', () => {
    expect(FACHEBENEN.hochwasser.geometrieTyp).toBe('punkt');
    expect(FACHEBENEN.hochwasser.bboxAbhaengig).toBe(false);
    expect(FACHEBENEN.hochwasser.pollMs).toBeGreaterThan(0);
  });
  it('führt die Luftqualitätsebene als Punktebene im Takt der Server-TTL (LFH-79)', () => {
    const def = FACHEBENEN.luftqualitaet;
    expect(def.geometrieTyp).toBe('punkt');
    expect(def.bboxAbhaengig).toBe(false);
    // = serverseitige TTL (900 s); häufiger abzufragen liefert nichts Frischeres.
    expect(def.pollMs).toBe(900_000);
    // Messpunkte, keine Fläche — die Einschränkung steht als Text, nicht als Tooltip.
    expect(def.geltung).toMatch(/Messstationen/);
  });
  it('gibt jeder Ebene einen eigenen Rückfallton', () => {
    const farben = fachebeneKeys().map((k) => FACHEBENEN[k].farbe.toLowerCase());
    expect(new Set(farben).size).toBe(farben.length);
  });
  it('führt die ODL-Ebene bundesweit, im Takt der Quelle und mit sichtbarem Geltungsbereich', () => {
    expect(FACHEBENEN.odl.geometrieTyp).toBe('punkt');
    // ~358 KB normalisiert, 1 676 Sonden — keine bbox-Pflicht wie bei KRITIS (design.md, E7).
    expect(FACHEBENEN.odl.bboxAbhaengig).toBe(false);
    // = serverseitige TTL: die Quelle hat Stundentakt, häufiger zu fragen wird nicht frischer.
    expect(FACHEBENEN.odl.pollMs).toBe(600_000);
    // Als TEXT, nicht als Tooltip (LFH-80): wer die Ebene für Einsatzmessungen hält, liest
    // eine Messtrupp-Lücke als „alles unauffällig".
    expect(FACHEBENEN.odl.geltung).toMatch(/ortsfeste/);
    expect(FACHEBENEN.odl.geltung).toMatch(/keine Einsatzmessungen/);
  });
  it('gibt der ODL-Ebene einen eigenen Ebenenton', () => {
    const andere = fachebeneKeys()
      .filter((k) => k !== 'odl')
      .map((k) => FACHEBENEN[k].farbe);
    expect(andere).not.toContain(FACHEBENEN.odl.farbe);
  });
  it('markiert nur kritis als bbox-abhängig', () => {
    expect(istBboxAbhaengig('kritis')).toBe(true);
    expect(istBboxAbhaengig('dwd')).toBe(false);
    // Die Autobahn-Ebene aggregiert das ganze Netz serverseitig — sie darf NICHT in den
    // bbox-Zweig geraten, sonst bliebe sie ohne Viewport-Meldung dauerhaft leer.
    expect(istBboxAbhaengig('autobahn')).toBe(false);
  });
  it('jeder fachebeneKeys()-Eintrag hat auch eine Definition (und umgekehrt)', () => {
    // Beide Richtungen: ein Key ohne Def stürzt beim Rendern ab, eine Def ohne Key ist
    // unerreichbar und fällt sonst niemandem auf.
    expect([...fachebeneKeys()].sort()).toEqual(Object.keys(FACHEBENEN).sort());
  });
  it('taktet die Autobahn-Ebene kurz, solange sie aufwärmt (LFH-80)', () => {
    // Der erste Lauf hängt serverseitig an keinem Request; bis er durch ist, meldet die
    // Ebene `offline`. Mit dem regulären 600-s-Takt sähe der Bediener zehn Minuten lang
    // nichts, obwohl die Daten nach ~30 s bereitstehen.
    const kurz = FACHEBENEN.autobahn.aufwaermPollMs!;
    const lang = FACHEBENEN.autobahn.pollMs;
    expect(kurz).toBeLessThan(lang);
    expect(autobahnTakt(undefined)).toBe(kurz);
    expect(autobahnTakt('offline')).toBe(kurz);

    // Und die Gegenaussage, die die Regel erst scharf macht: ein ERREICHTER Zustand fällt
    // auf den regulären Takt zurück. `leer` gehört dazu — „Quelle erreichbar, gerade nichts
    // zu melden" ist ein gültiges Ende, kurz zu takten brächte dort nichts.
    expect(autobahnTakt('ok')).toBe(lang);
    expect(autobahnTakt('leer')).toBe(lang);
  });

  it('nur ODL, Luftqualität und Autobahn nennen einen einschränkenden Geltungsbereich', () => {
    // Das ist das Akzeptanzkriterium „Limitation (nur BAB) transparent" als Zusicherung;
    // LFH-78 setzt den zweiten (nur ortsfestes Messnetz, keine Einsatzmessungen), LFH-79 den
    // dritten (Messpunkte, keine Aussage zwischen den Stationen).
    // Die Gegenaussage trägt sie mit: stünde der Satz an jeder Ebene, sagte er nichts.
    // Luftqualität (LFH-79) zeigt Messpunkte, keine Fläche — wer eine Station fern vom
    // Einsatzort sieht, darf daraus nicht die Luft am Einsatzort lesen.
    expect(FACHEBENEN.autobahn.geltung).toMatch(/Bundesautobahn/i);
    const mitGeltung = fachebeneKeys().filter((k) => FACHEBENEN[k].geltung);
    expect(mitGeltung).toEqual(['odl', 'luftqualitaet', 'autobahn']);
  });
  it('jede Ebene hat Label, Farbe, Geometrietyp und Poll-Intervall', () => {
    for (const e of Object.values(FACHEBENEN)) {
      expect(e.label).toBeTruthy();
      expect(e.farbe).toMatch(/^#/);
      expect(['polygon', 'punkt']).toContain(e.geometrieTyp);
      expect(e.pollMs).toBeGreaterThanOrEqual(0);
    }
  });
  it('KRITIS_MIN_ZOOM ist eine sinnvolle Zoom-Schwelle (>= 10)', () => {
    expect(KRITIS_MIN_ZOOM).toBeGreaterThanOrEqual(10);
    expect(typeof KRITIS_MIN_ZOOM).toBe('number');
  });
});

describe('rasterBbox', () => {
  it('rastert nach außen auf das Gitter (benachbarte Pans → gleicher Schlüssel)', () => {
    // zwei leicht verschiedene Viewports in derselben Rasterzelle → identischer String
    const a = rasterBbox('6.96,50.91,6.99,50.94');
    const b = rasterBbox('6.97,50.92,6.98,50.93');
    expect(a).toBe(b);
    expect(a).toBe('6.95,50.9,7,50.95');
  });
  it('deckt den Ausschnitt vollständig ab (floor west/sued, ceil ost/nord)', () => {
    const [w, s, e, n] = rasterBbox('6.96,50.91,6.99,50.94').split(',').map(Number);
    expect(w).toBeLessThanOrEqual(6.96);
    expect(s).toBeLessThanOrEqual(50.91);
    expect(e).toBeGreaterThanOrEqual(6.99);
    expect(n).toBeGreaterThanOrEqual(50.94);
  });
  it('gibt ungültige Eingabe unverändert zurück', () => {
    expect(rasterBbox('kaputt')).toBe('kaputt');
  });
});

describe('mergeFeatures', () => {
  it('akkumuliert über mehrere Aufrufe und dedupliziert per Koordinate', () => {
    const m = new Map();
    expect(mergeFeatures(m, [feat(6.9, 50.9), feat(7.0, 51.0)], 100)).toBe(true);
    // anderer Ausschnitt mit einem überlappenden Punkt → nur der neue kommt dazu
    expect(mergeFeatures(m, [feat(7.0, 51.0), feat(8.0, 52.0)], 100)).toBe(true);
    expect(m.size).toBe(3); // 6.9/7.0/8.0, der doppelte 7.0 nur einmal
  });
  it('meldet keine Änderung, wenn nichts Neues dazukommt', () => {
    const m = new Map();
    mergeFeatures(m, [feat(6.9, 50.9)], 100);
    expect(mergeFeatures(m, [feat(6.9, 50.9)], 100)).toBe(false);
  });
  it('begrenzt die Größe (älteste zuerst raus)', () => {
    const m = new Map();
    mergeFeatures(m, [feat(1, 1), feat(2, 2), feat(3, 3)], 2);
    expect(m.size).toBe(2);
    expect(m.has(JSON.stringify([1, 1]))).toBe(false); // ältester entfernt
    expect(m.has(JSON.stringify([3, 3]))).toBe(true);
  });
});
