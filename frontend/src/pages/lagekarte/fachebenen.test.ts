import { describe, it, expect } from 'vitest';
import { defaultFachebenenSichtbar } from './fachebenenAuswahl';
import {
  FACHEBENEN,
  fachebeneKeys,
  fachebeneTakt,
  BBOX_MIN_ZOOM,
  braucheViewportBbox,
  istBboxAbhaengig,
  mergeFeatures,
  rasterBbox,
  WELT_BBOX,
  rasterWeite,
} from './fachebenen';

// Minimaler Feature-Builder für die Merge-Tests.
const feat = (lon: number, lat: number) => ({
  type: 'Feature' as const,
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: {},
});

describe('Fachebenen-Registry', () => {
  it('enthält die vier v1-Quellen, Hochwasser, ODL, Luftqualität, KRITIS/Energie und die BAB-Lage', () => {
    // Reihenfolge = Anzeigereihenfolge im Panel. `hochwasser` steht neben `pegelonline`,
    // weil es dieselbe Frage beantwortet: dort der rohe Wasserstand, hier die amtliche
    // Bewertung (LFH-77). `odl` (LFH-78) folgt als zweite bewertete Messnetz-Ebene,
    // `luftqualitaet` (LFH-79) als dritte. `energie` (LFH-81) steht neben `kritis`: beide
    // sind Infrastruktur im Kartenausschnitt, und KRITIS führt die Umspannwerke, die MaStR
    // nicht kennt. `autobahn` (LFH-80) hängt hinten an — eigene Fragestellung.
    expect(fachebeneKeys()).toEqual([
      'nina',
      'dwd',
      'pegelonline',
      'hochwasser',
      'odl',
      'luftqualitaet',
      'kritis',
      'energie',
      'autobahn',
    ]);
  });
  it('führt die Energieanlagen als bbox-abhängige Punktebene ohne Polling (LFH-81)', () => {
    expect(FACHEBENEN.energie.label).toBe('Energieanlagen');
    expect(FACHEBENEN.energie.geometrieTyp).toBe('punkt');
    expect(FACHEBENEN.energie.pollMs).toBe(0);
    expect(FACHEBENEN.energie.bboxAbhaengig).toBe(true);
  });
  it('Farbe der Energieanlagen fällt mit keiner Bestandsebene zusammen (LFH-81)', () => {
    // Handgeschriebene Literale der sechs Bestandsfarben, nicht aus FACHEBENEN gelesen:
    // sonst prüfte der Test die Registry gegen sich selbst.
    const bestand = ['#cf1322', '#d48806', '#096dd9', '#08979c', '#c41d7f', '#531dab'];
    expect(bestand).not.toContain(FACHEBENEN.energie.farbe.toLowerCase());
    // Und über alle Ebenen: jede Farbe genau einmal — gilt auch für eine achte Ebene.
    const farben = Object.values(FACHEBENEN).map((f) => f.farbe.toLowerCase());
    expect(new Set(farben).size).toBe(farben.length);
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
  it('markiert genau kritis und energie als bbox-abhängig', () => {
    expect(istBboxAbhaengig('kritis')).toBe(true);
    expect(istBboxAbhaengig('energie')).toBe(true);
    expect(istBboxAbhaengig('dwd')).toBe(false);
    expect(fachebeneKeys().filter(istBboxAbhaengig)).toEqual(['kritis', 'energie']);
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
    expect(fachebeneTakt('autobahn', undefined)).toBe(kurz);
    expect(fachebeneTakt('autobahn', 'offline')).toBe(kurz);

    // Und die Gegenaussage, die die Regel erst scharf macht: ein ERREICHTER Zustand fällt
    // auf den regulären Takt zurück. `leer` gehört dazu — „Quelle erreichbar, gerade nichts
    // zu melden" ist ein gültiges Ende, kurz zu takten brächte dort nichts.
    expect(fachebeneTakt('autobahn', 'ok')).toBe(lang);
    expect(fachebeneTakt('autobahn', 'leer')).toBe(lang);
  });

  it('taktet KRITIS nur in der Aufwärmphase und sonst gar nicht (LFH-83)', () => {
    // Der erste Import des OSM-Extrakts läuft minutenlang im Hintergrund; bis dahin meldet
    // die Ebene `offline`. Ohne kurzen Takt erschiene der erste Bestand erst beim nächsten
    // Pannen — wer die Karte nicht bewegt, sähe die Ebene nie.
    const kurz = FACHEBENEN.kritis.aufwaermPollMs!;
    expect(kurz).toBeGreaterThan(0);
    expect(fachebeneTakt('kritis', undefined)).toBe(kurz);
    expect(fachebeneTakt('kritis', 'offline')).toBe(kurz);
    // Gegenaussage: mit Bestand ist die Ebene bbox-getrieben und pollt NICHT. `0` schaltet
    // in react-query den Timer ab (queryObserver: `#currentRefetchInterval === 0` → return).
    expect(FACHEBENEN.kritis.pollMs).toBe(0);
    expect(fachebeneTakt('kritis', 'ok')).toBe(0);
    expect(fachebeneTakt('kritis', 'leer')).toBe(0);
  });

  it('taktet Ebenen ohne Aufwärmphase immer regulär', () => {
    expect(FACHEBENEN.nina.aufwaermPollMs).toBeUndefined();
    expect(fachebeneTakt('nina', undefined)).toBe(FACHEBENEN.nina.pollMs);
    expect(fachebeneTakt('nina', 'offline')).toBe(FACHEBENEN.nina.pollMs);
  });

  it('nennt bei KRITIS die Herkunft: OSM, wöchentlicher Stand, keine amtliche Liste (LFH-83)', () => {
    // Wer die Ebene für die amtliche KRITIS-Liste hält, liest eine Lücke als „hier ist
    // nichts" — dieselbe Falle wie bei ODL und Autobahn, deshalb dieselbe Textzeile.
    expect(FACHEBENEN.kritis.geltung).toMatch(/OpenStreetMap/);
    expect(FACHEBENEN.kritis.geltung).toMatch(/wöchentlich/);
    expect(FACHEBENEN.kritis.geltung).toMatch(/keine amtliche KRITIS-Liste/);
  });

  it('nur ODL, Luftqualität, KRITIS und Autobahn nennen einen einschränkenden Geltungsbereich', () => {
    // Das ist das Akzeptanzkriterium „Limitation (nur BAB) transparent" als Zusicherung.
    // Die Gegenaussage trägt sie mit: stünde der Satz an jeder Ebene, sagte er nichts.
    // ODL (LFH-78): nur ortsfestes Messnetz. Luftqualität (LFH-79): Messpunkte, keine Aussage
    // zwischen den Stationen. KRITIS (LFH-83): OSM-Stand, keine amtliche Liste.
    expect(FACHEBENEN.autobahn.geltung).toMatch(/Bundesautobahn/i);
    const mitGeltung = fachebeneKeys().filter((k) => FACHEBENEN[k].geltung);
    expect(mitGeltung).toEqual(['odl', 'luftqualitaet', 'kritis', 'autobahn']);
  });
  it('jede Ebene hat Label, Farbe, Geometrietyp und Poll-Intervall', () => {
    for (const e of Object.values(FACHEBENEN)) {
      expect(e.label).toBeTruthy();
      expect(e.farbe).toMatch(/^#/);
      expect(['polygon', 'punkt']).toContain(e.geometrieTyp);
      expect(e.pollMs).toBeGreaterThanOrEqual(0);
    }
  });
  it('BBOX_MIN_ZOOM bleibt die bisherige KRITIS-Schwelle 10', () => {
    // Der Wert ist beim Umbenennen unverändert geblieben (LFH-81, design.md Entscheidung 6).
    expect(BBOX_MIN_ZOOM).toBe(10);
  });
});

describe('rasterWeite', () => {
  it('wächst mit der bbox-Breite und bleibt auf Stadtebene beim bisherigen 0,05°-Raster', () => {
    expect(rasterWeite(0.03)).toBe(0.05);
    expect(rasterWeite(0.3)).toBe(0.05);
    // Ein Bundesland, dann ganz Deutschland (~9° West-Ost, je nach Seitenverhältnis mehr).
    expect(rasterWeite(3)).toBeGreaterThan(rasterWeite(0.3));
    expect(rasterWeite(12)).toBeGreaterThan(rasterWeite(3));
  });
  it('ist über die ganze Leiter monoton', () => {
    const breiten = [0.01, 0.1, 0.5, 1, 2, 4, 8, 16, 45, 180, 360];
    const weiten = breiten.map(rasterWeite);
    for (let i = 1; i < weiten.length; i++) expect(weiten[i]).toBeGreaterThanOrEqual(weiten[i - 1]);
  });
});

describe('braucheViewportBbox (LFH-81)', () => {
  it('ist aus, solange keine bbox-abhängige Ebene sichtbar ist', () => {
    expect(braucheViewportBbox(defaultFachebenenSichtbar())).toBe(false);
    // Eine sichtbare Ebene OHNE bbox zählt nicht.
    expect(braucheViewportBbox({ ...defaultFachebenenSichtbar(), autobahn: true })).toBe(false);
  });
  it('ist an, sobald irgendeine bbox-abhängige Ebene sichtbar ist — auch ohne KRITIS', () => {
    expect(braucheViewportBbox({ ...defaultFachebenenSichtbar(), kritis: true })).toBe(true);
    expect(braucheViewportBbox({ ...defaultFachebenenSichtbar(), energie: true })).toBe(true);
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
  it('hält den Schlüssel auf Deutschland-Ebene beim Pannen um einen Bruchteil der Breite stabil', () => {
    // Deutschland-Ansicht, ~12° breit. Mit dem Stadtraster (0,05°) erzeugte jede
    // Verschiebung um mehr als ~5 km einen neuen Query-Key und damit eine neue Abfrage
    // über das ganze Land. Um 0,3° verschoben (~20 km) bleibt der Schlüssel gleich.
    const a = rasterBbox('4.1,46.6,16.1,55.3');
    const b = rasterBbox('4.4,46.8,16.4,55.5');
    expect(a).toBe(b);
  });
  it('wechselt den Schlüssel, wenn die Ansicht die Rasterzelle wirklich verlässt', () => {
    // Gegenaussage — „stabil" allein erfüllte auch eine Funktion, die immer denselben
    // String liefert.
    expect(rasterBbox('6.96,50.91,6.99,50.94')).not.toBe(rasterBbox('7.06,50.91,7.09,50.94'));
    expect(rasterBbox('4.1,46.6,16.1,55.3')).not.toBe(rasterBbox('9.1,46.6,21.1,55.3'));
  });
  it('wechselt das Raster mit der Zoomstufe: Stadt- und Landesausschnitt am selben Ort', () => {
    // Die Leiterstufe hängt an der Breite, nicht an der Lage — derselbe Mittelpunkt auf
    // zwei Zoomstufen liefert zwei verschiedene Schlüssel, sonst lüde das Herauszoomen nie.
    expect(rasterBbox('6.96,50.91,6.99,50.94')).not.toBe(rasterBbox('5.5,50,8.5,52'));
  });
  it.each([
    ['Stadt', '6.96,50.91,6.99,50.94'],
    ['Region', '6.3,50.4,7.9,51.3'],
    ['Deutschland', '4.1,46.6,16.1,55.3'],
  ])('deckt den Ausschnitt vollständig ab (%s: floor west/sued, ceil ost/nord)', (_, bbox) => {
    const [w0, s0, e0, n0] = bbox.split(',').map(Number);
    const [w, s, e, n] = rasterBbox(bbox).split(',').map(Number);
    expect(w).toBeLessThanOrEqual(w0);
    expect(s).toBeLessThanOrEqual(s0);
    expect(e).toBeGreaterThanOrEqual(e0);
    expect(n).toBeGreaterThanOrEqual(n0);
  });
  it('bleibt im gültigen Koordinatenbereich, auch wenn die Karte über die Welt hinaus zeigt', () => {
    // Auf kleinster Zoomstufe meldet MapLibre Längen jenseits ±180 (Weltkopien). Das
    // Backend lehnt solche bboxes mit 400 ab — die Ebene stünde dann als `offline` da.
    const [w, s, e, n] = rasterBbox('-250.3,-88.1,250.7,88.4').split(',').map(Number);
    expect(w).toBeGreaterThanOrEqual(-180);
    expect(e).toBeLessThanOrEqual(180);
    expect(s).toBeGreaterThanOrEqual(-90);
    expect(n).toBeLessThanOrEqual(90);
  });
  // Review LFH-83: nur Kappen reichte nicht — eine Weltkopie jenseits ±180 wurde zu
  // „180,…,180,…" (west = ost → 400), und Deutschland in der Kopie bei 365–376° blieb leer.
  // Geprüft wird die Invariante, an der das Backend scheitert, über eine Tabelle.
  it.each([
    ['182,50,183,51'],
    ['365,47,376,56'],
    ['-190,50,-170,51'],
    ['-250.3,-88.1,250.7,88.4'],
    ['-540,-80,540,80'],
    ['179.99,50,180.01,50.01'],
    ['6.96,50.91,6.99,50.94'],
  ])('liefert für %s eine vom Backend annehmbare bbox', (eingabe) => {
    const [w, s, e, n] = rasterBbox(eingabe).split(',').map(Number);
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);
    expect(w).toBeGreaterThanOrEqual(-180);
    expect(e).toBeLessThanOrEqual(180);
    expect(s).toBeGreaterThanOrEqual(-90);
    expect(n).toBeLessThanOrEqual(90);
  });
  it('schiebt eine Weltkopie Deutschlands zurück statt sie wegzukappen', () => {
    expect(rasterBbox('365,47,376,56')).toBe(rasterBbox('5,47,16,56'));
  });
  it('gibt für einen Ausschnitt breiter als die Welt die ganze Welt', () => {
    expect(rasterBbox('-540,-80,540,80')).toBe(WELT_BBOX);
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
