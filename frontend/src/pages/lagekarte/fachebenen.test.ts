import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { FachebeneQuelle } from '../../api/fachebenen';
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
  mergeEnergieFeatures,
  energieNennung,
  fachebeneAlter,
} from './fachebenen';
import { faerbeHochwasser, hochwasserRadius } from './hochwasserStil';
import { faerbeLuftqualitaet, luftqualitaetRadius } from './luftqualitaetStil';
import { faerbeOdl, odlRadius } from './odlStil';
import { hochwasserKlasse, luftqualitaetIndex, odlStufe } from '../../theme/statusFarben';

// Minimaler Feature-Builder für die Merge-Tests.
const feat = (lon: number, lat: number) => ({
  type: 'Feature' as const,
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: {},
});

describe('Fachebenen-Registry', () => {
  it('enthält die vier v1-Quellen, Hochwasser, ODL, Luftqualität, KRITIS/Energie und die BAB-Lage', () => {
    // Reihenfolge = Anzeigereihenfolge im Panel. `hochwasser` steht neben `pegelonline` (roher
    // Wasserstand vs. amtliche Bewertung), `odl` und `luftqualitaet` folgen als weitere Messnetze,
    // `energie` steht neben `kritis` (beides Infrastruktur), `autobahn` hinten.
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
  it('trägt keinen Farbwert — die Ebenenfarbe steht im Farbvertrag (LFH-593)', () => {
    // Töne, Modus und Unterscheidbarkeit prüft `theme/statusFarben.test.ts` (`fachebeneFarbe`).
    const quelle = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'fachebenen.ts'),
      'utf8',
    );
    expect(quelle).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(quelle).not.toMatch(/rgba?\(/);
    for (const e of Object.values(FACHEBENEN)) expect(e).not.toHaveProperty('farbe');
  });
  it('führt die Hochwasserebene als Punktebene mit Hintergrund-Polling', () => {
    expect(FACHEBENEN.hochwasser.geometrieTyp).toBe('punkt');
    expect(FACHEBENEN.hochwasser.bboxAbhaengig).toBe(false);
    expect(FACHEBENEN.hochwasser.pollMs).toBeGreaterThan(0);
  });
  it('führt die Luftqualitätsebene als Punktebene unter der Server-TTL (LFH-79, LFH-856)', () => {
    const def = FACHEBENEN.luftqualitaet;
    expect(def.geometrieTyp).toBe('punkt');
    expect(def.bboxAbhaengig).toBe(false);
    // Ein Drittel der Server-TTL (900 s): Stundenwerte mit ~2 h Verzug, schneller bringt nichts.
    expect(def.pollMs).toBe(300_000);
    // Messpunkte, keine Fläche — die Einschränkung steht als Text, nicht als Tooltip.
    expect(def.geltung).toMatch(/Messstationen/);
  });
  it('führt die ODL-Ebene bundesweit, im Takt der Quelle und mit sichtbarem Geltungsbereich', () => {
    expect(FACHEBENEN.odl.geometrieTyp).toBe('punkt');
    // Keine bbox-Pflicht wie bei KRITIS (~358 KB, 1 676 Sonden).
    expect(FACHEBENEN.odl.bboxAbhaengig).toBe(false);
    // Die halbe Server-TTL (600 s): die Quelle hat Stundentakt, häufiger zu fragen wird nicht
    // frischer.
    expect(FACHEBENEN.odl.pollMs).toBe(300_000);
    // Als Text, nicht als Tooltip: wer die Ebene für Einsatzmessungen hält, liest eine
    // Messtrupp-Lücke als „alles unauffällig".
    expect(FACHEBENEN.odl.geltung).toMatch(/ortsfeste/);
    expect(FACHEBENEN.odl.geltung).toMatch(/keine Einsatzmessungen/);
  });
  it('führt genau Hochwasser, ODL und Luftqualität als klassenabhängig gefärbt (LFH-592)', () => {
    // Handgeschrieben: eine neue Ebene mit eigener Einfärbung soll hier auffallen, nicht still
    // einen Panel-Punkt tragen, den die Karte nicht zeichnet.
    expect(fachebeneKeys().filter((k) => FACHEBENEN[k].klassenfarben)).toEqual([
      'hochwasser',
      'odl',
      'luftqualitaet',
    ]);
  });
  it('liest die Legende einer klassenabhängigen Ebene aus dem Vertrag (LFH-592)', () => {
    // Reihenfolge, Wort, Rolle und Durchmesser genau wie die Karte sie zeichnet — nichts neu
    // erfunden.
    const legende = <K extends string>(vertrag: Record<K, unknown>, radius: (k: K) => number) =>
      (Object.keys(vertrag) as K[]).map((schluessel) => ({
        schluessel,
        darstellung: vertrag[schluessel],
        radius: radius(schluessel),
      }));
    expect(FACHEBENEN.hochwasser.klassenfarben?.legende).toEqual(
      legende(hochwasserKlasse, hochwasserRadius),
    );
    expect(FACHEBENEN.odl.klassenfarben?.legende).toEqual(legende(odlStufe, odlRadius));
    expect(FACHEBENEN.luftqualitaet.klassenfarben?.legende).toEqual(
      legende(luftqualitaetIndex, luftqualitaetRadius),
    );
  });
  it('färbt über dieselbe Funktion, die auch die Legende trägt (LFH-592)', () => {
    // Legende und Einfärbung hängen an EINER Eigenschaft: eine Ebene kann nicht färben, ohne dass
    // das Panel ihre Legende zeigt.
    expect(FACHEBENEN.hochwasser.klassenfarben?.faerbe).toBe(faerbeHochwasser);
    expect(FACHEBENEN.odl.klassenfarben?.faerbe).toBe(faerbeOdl);
    expect(FACHEBENEN.luftqualitaet.klassenfarben?.faerbe).toBe(faerbeLuftqualitaet);
  });
  it('markiert genau kritis und energie als bbox-abhängig', () => {
    expect(istBboxAbhaengig('kritis')).toBe(true);
    expect(istBboxAbhaengig('energie')).toBe(true);
    expect(istBboxAbhaengig('dwd')).toBe(false);
    expect(fachebeneKeys().filter(istBboxAbhaengig)).toEqual(['kritis', 'energie']);
    // Die Autobahn-Ebene aggregiert serverseitig — im bbox-Zweig bliebe sie ohne Viewport-Meldung
    // leer.
    expect(istBboxAbhaengig('autobahn')).toBe(false);
  });
  it('jeder fachebeneKeys()-Eintrag hat auch eine Definition (und umgekehrt)', () => {
    // Beide Richtungen: ein Key ohne Def stürzt beim Rendern ab, eine Def ohne Key ist
    // unerreichbar.
    expect([...fachebeneKeys()].sort()).toEqual(Object.keys(FACHEBENEN).sort());
  });
  it('taktet die Autobahn-Ebene kurz, solange sie aufwärmt (LFH-80)', () => {
    // Der erste Lauf hängt serverseitig an keinem Request; bis er durch ist, meldet die Ebene
    // `offline`. Mit dem regulären Takt sähe der Bediener zwei Minuten nichts.
    const kurz = FACHEBENEN.autobahn.aufwaermPollMs!;
    const lang = FACHEBENEN.autobahn.pollMs;
    expect(kurz).toBeLessThan(lang);
    expect(fachebeneTakt('autobahn', undefined)).toBe(kurz);
    expect(fachebeneTakt('autobahn', 'offline')).toBe(kurz);

    // Gegenaussage: ein erreichter Zustand (auch `leer`) fällt auf den regulären Takt zurück.
    expect(fachebeneTakt('autobahn', 'ok')).toBe(lang);
    expect(fachebeneTakt('autobahn', 'leer')).toBe(lang);
  });

  it('taktet KRITIS nur in der Aufwärmphase und sonst gar nicht (LFH-83)', () => {
    // Der erste Import des OSM-Extrakts läuft minutenlang; ohne kurzen Takt erschiene der Bestand
    // erst beim nächsten Pannen.
    const kurz = FACHEBENEN.kritis.aufwaermPollMs!;
    expect(kurz).toBeGreaterThan(0);
    expect(fachebeneTakt('kritis', undefined)).toBe(kurz);
    expect(fachebeneTakt('kritis', 'offline')).toBe(kurz);
    // Mit Bestand ist die Ebene bbox-getrieben und pollt nicht: `0` schaltet in react-query den
    // Timer ab.
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
    // Wer die Ebene für die amtliche KRITIS-Liste hält, liest eine Lücke als „hier ist nichts".
    expect(FACHEBENEN.kritis.geltung).toMatch(/OpenStreetMap/);
    expect(FACHEBENEN.kritis.geltung).toMatch(/wöchentlich/);
    expect(FACHEBENEN.kritis.geltung).toMatch(/keine amtliche KRITIS-Liste/);
  });

  it('nur ODL, Luftqualität, KRITIS und Autobahn nennen einen einschränkenden Geltungsbereich', () => {
    // „Nur BAB" als Zusicherung, mit Gegenaussage: stünde der Satz an jeder Ebene, sagte er nichts.
    expect(FACHEBENEN.autobahn.geltung).toMatch(/Bundesautobahn/i);
    const mitGeltung = fachebeneKeys().filter((k) => FACHEBENEN[k].geltung);
    expect(mitGeltung).toEqual(['odl', 'luftqualitaet', 'kritis', 'autobahn']);
  });
  it('pollt jede Hintergrund-Ebene schneller als ihre Server-TTL (LFH-856)', () => {
    // Seit LFH-594 kostet ein Poll ohne neuen Stand nur ein 304. Mit `pollMs == TTL` verschenkte
    // der Takt bis zu eine TTL, bevor der Abruf nach Ablauf die Erneuerung anstößt, und eine
    // weitere, bis der neue Stand ankommt. Die TTL steht im Backend; gelesen wird die Quelle,
    // damit eine dort geänderte Zahl hier rot wird statt still auseinanderzulaufen.
    const quellen = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../../src/karte/quellen.rs'),
      'utf8',
    );
    const ttlKonstante: Partial<Record<FachebeneQuelle, string>> = {
      nina: 'NINA_TTL',
      dwd: 'DWD_TTL',
      pegelonline: 'PEGEL_TTL',
      hochwasser: 'HOCHWASSER_TTL',
      odl: 'ODL_TTL',
      luftqualitaet: 'LUFTQUALITAET_TTL',
      autobahn: 'AUTOBAHN_TTL',
    };
    // Handgeschrieben: eine neue Ebene mit Hintergrund-Takt braucht hier ihre TTL.
    const pollend = fachebeneKeys().filter((k) => FACHEBENEN[k].pollMs > 0);
    expect(pollend.sort()).toEqual(Object.keys(ttlKonstante).sort());
    for (const k of pollend) {
      const name = ttlKonstante[k]!;
      const treffer = quellen.match(
        new RegExp(`const ${name}: Duration = Duration::from_secs\\(([\\d_]+)\\);`),
      );
      expect(treffer, `${name} in src/karte/quellen.rs`).not.toBeNull();
      const ttlMs = Number(treffer![1].replace(/_/g, '')) * 1000;
      expect(FACHEBENEN[k].pollMs, k).toBeLessThan(ttlMs);
    }
  });
  it('jede Ebene hat Label, Geometrietyp und Poll-Intervall', () => {
    for (const e of Object.values(FACHEBENEN)) {
      expect(e.label).toBeTruthy();
      expect(['polygon', 'punkt']).toContain(e.geometrieTyp);
      expect(e.pollMs).toBeGreaterThanOrEqual(0);
    }
  });
  it('BBOX_MIN_ZOOM bleibt die bisherige KRITIS-Schwelle 10', () => {
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
    // Deutschland-Ansicht, ~12° breit: mit dem Stadtraster (0,05°) erzeugte jede Verschiebung um
    // mehr als ~5 km eine neue Abfrage übers ganze Land. Um 0,3° verschoben bleibt der Schlüssel
    // gleich.
    const a = rasterBbox('4.1,46.6,16.1,55.3');
    const b = rasterBbox('4.4,46.8,16.4,55.5');
    expect(a).toBe(b);
  });
  it('wechselt den Schlüssel, wenn die Ansicht die Rasterzelle wirklich verlässt', () => {
    // Gegenaussage — „stabil" erfüllte auch eine Funktion, die immer denselben String liefert.
    expect(rasterBbox('6.96,50.91,6.99,50.94')).not.toBe(rasterBbox('7.06,50.91,7.09,50.94'));
    expect(rasterBbox('4.1,46.6,16.1,55.3')).not.toBe(rasterBbox('9.1,46.6,21.1,55.3'));
  });
  it('wechselt das Raster mit der Zoomstufe: Stadt- und Landesausschnitt am selben Ort', () => {
    // Die Leiterstufe hängt an der Breite: derselbe Mittelpunkt auf zwei Zoomstufen liefert zwei
    // Schlüssel, sonst lüde das Herauszoomen nie.
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
    // Auf kleinster Zoomstufe meldet MapLibre Längen jenseits ±180 (Weltkopien); das Backend lehnte
    // solche bboxes mit 400 ab.
    const [w, s, e, n] = rasterBbox('-250.3,-88.1,250.7,88.4').split(',').map(Number);
    expect(w).toBeGreaterThanOrEqual(-180);
    expect(e).toBeLessThanOrEqual(180);
    expect(s).toBeGreaterThanOrEqual(-90);
    expect(n).toBeLessThanOrEqual(90);
  });
  // Nur Kappen reichte nicht: eine Weltkopie wurde zu „180,…,180,…" (west = ost → 400). Geprüft
  // wird die Invariante, an der das Backend scheitert.
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
  it('rastert mit fester Weite, wenn eine übergeben wird (Energie, LFH-81)', () => {
    expect(rasterBbox('7.01,51.51,7.12,51.58', 0.05)).toBe('7,51.5,7.15,51.6');
    // Ein Zoom-10-Ausschnitt: die Leiter rundet auf 0,25° nach außen und vergrößert die
    // Overpass-Abfrage merklich — deshalb nimmt Energie nicht die Leiter.
    const zoom10 = '7.13,51.21,8.03,51.76';
    const breite = (b: string) => {
      const [w, , e] = b.split(',').map(Number);
      return e - w;
    };
    expect(breite(rasterBbox(zoom10))).toBeGreaterThan(1);
    expect(breite(rasterBbox(zoom10, 0.05))).toBeLessThanOrEqual(1);
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

// Energie-Feature mit Properties: Koordinate + Herkunft + MaStR-Angaben.
const energie = (lon: number, lat: number, props: Record<string, unknown>) => ({
  type: 'Feature' as const,
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: props,
});

describe('mergeEnergieFeatures (LFH-81)', () => {
  it('überschreibt ein Feature an derselben Koordinate mit der neueren Fassung', () => {
    // Teilausfall: zuerst kam nur der OSM-Teil, danach dieselbe Anlage mit amtlichen Angaben.
    const m = new Map();
    mergeEnergieFeatures(m, [energie(7, 51, { herkunft: 'osm', leistung_mw: null })], 100);
    const neu = energie(7, 51, {
      herkunft: 'osm+mastr',
      leistung_mw: 690,
      mastr_nummer: 'SEE1',
      mastr_nummern: 'SEE1',
    });
    expect(mergeEnergieFeatures(m, [neu], 100)).toBe(true);
    expect(m.size).toBe(1);
    expect(m.get(JSON.stringify([7, 51]))?.properties).toEqual(neu.properties);
  });

  it('meldet keine Änderung, wenn dieselbe Fassung noch einmal kommt', () => {
    const m = new Map();
    mergeEnergieFeatures(m, [energie(7, 51, { herkunft: 'osm' })], 100);
    expect(mergeEnergieFeatures(m, [energie(7, 51, { herkunft: 'osm' })], 100)).toBe(false);
  });

  it('entfernt reine MaStR-Punkte, deren Nummer ein osm+mastr-Punkt schon trägt', () => {
    // Im Teilausfall stand die Einheit als eigener MaStR-Punkt da; später ordnet das Backend sie
    // einer OSM-Anlage zu — ohne Bereinigung stünde die Anlage doppelt.
    const m = new Map();
    mergeEnergieFeatures(
      m,
      [
        energie(7.01, 51.01, { herkunft: 'mastr', mastr_nummer: 'SEE2' }),
        energie(8, 52, { herkunft: 'mastr', mastr_nummer: 'SEE9' }),
      ],
      100,
    );
    expect(
      mergeEnergieFeatures(
        m,
        [
          energie(7, 51, {
            herkunft: 'osm+mastr',
            mastr_nummer: 'SEE1',
            mastr_nummern: 'SEE1,SEE2',
          }),
        ],
        100,
      ),
    ).toBe(true);
    expect(m.has(JSON.stringify([7.01, 51.01]))).toBe(false);
    // Eine fremde Nummer bleibt stehen.
    expect(m.has(JSON.stringify([8, 52]))).toBe(true);
    expect(m.size).toBe(2);
  });

  it('entfernt auch, wenn der MaStR-Punkt erst NACH dem osm+mastr-Punkt eintrifft', () => {
    const m = new Map();
    mergeEnergieFeatures(
      m,
      [
        energie(7, 51, {
          herkunft: 'osm+mastr',
          mastr_nummer: 'SEE1',
          mastr_nummern: 'SEE1, SEE2',
        }),
      ],
      100,
    );
    mergeEnergieFeatures(
      m,
      [energie(7.01, 51.01, { herkunft: 'mastr', mastr_nummer: 'SEE2' })],
      100,
    );
    expect(m.size).toBe(1);
  });
});

describe('mergeFeatures bleibt first-wins (KRITIS)', () => {
  it('behält das zuerst gesehene Feature an einer Koordinate', () => {
    const m = new Map();
    mergeFeatures(m, [energie(7, 51, { name: 'alt' })], 100);
    expect(mergeFeatures(m, [energie(7, 51, { name: 'neu' })], 100)).toBe(false);
    expect(m.get(JSON.stringify([7, 51]))?.properties).toEqual({ name: 'alt' });
  });
});

describe('energieNennung (LFH-81)', () => {
  const OSM = '© OpenStreetMap-Beitragende (ODbL)';
  const MASTR = 'Marktstammdatenregister, Bundesnetzagentur – dl-de/by-2-0';

  it('nennt MaStR, solange die Sammlung einen Punkt mit MaStR-Anteil hat', () => {
    const fs = [energie(7, 51, { herkunft: 'osm' }), energie(8, 52, { herkunft: 'mastr' })];
    expect(energieNennung([OSM, MASTR], fs)).toEqual([OSM, MASTR]);
  });

  it('osm+mastr trägt beide Nennungen', () => {
    expect(energieNennung([OSM, MASTR], [energie(7, 51, { herkunft: 'osm+mastr' })])).toEqual([
      OSM,
      MASTR,
    ]);
  });

  it('ohne jeden MaStR-Punkt keine MaStR-Nennung', () => {
    expect(energieNennung([OSM, MASTR], [energie(7, 51, { herkunft: 'osm' })])).toEqual([OSM]);
  });

  it('ein Punkt ohne Herkunft trägt beide Nennungen (lieber zu viel als zu wenig)', () => {
    expect(energieNennung([OSM, MASTR], [energie(7, 51, {})])).toEqual([OSM, MASTR]);
  });

  it('ohne Punkte keine Nennung', () => {
    expect(energieNennung([OSM, MASTR], [])).toEqual([]);
  });
});

describe('fachebeneAlter (LFH-591)', () => {
  const MIN = 60_000;
  const jetzt = Date.parse('2026-09-30T12:00:00Z');
  const vorMin = (min: number) => new Date(jetzt - min * MIN).toISOString();

  it('schreibt die Schwellen je Ebene fest (Tabelle in design.md, D3)', () => {
    // Literale statt Rechnung: wer eine Schwelle ändert, ändert auch die Doku-Tabelle.
    expect(
      Object.fromEntries(fachebeneKeys().map((k) => [k, FACHEBENEN[k].veraltetNachMin])),
    ).toEqual({
      nina: 15,
      dwd: 30,
      pegelonline: 60,
      hochwasser: 60,
      odl: 180,
      luftqualitaet: 240,
      kritis: 14 * 24 * 60,
      energie: 36 * 60,
      autobahn: 60,
    });
  });

  it('genau auf der Schwelle ist noch nicht veraltet, eine Minute darüber schon', () => {
    expect(fachebeneAlter('hochwasser', vorMin(60), jetzt)?.veraltet).toBe(false);
    expect(fachebeneAlter('hochwasser', vorMin(61), jetzt)?.veraltet).toBe(true);
    expect(fachebeneAlter('nina', vorMin(15), jetzt)?.veraltet).toBe(false);
    expect(fachebeneAlter('nina', vorMin(16), jetzt)?.veraltet).toBe(true);
  });

  it('bewertet je Ebene gegen ihre eigene Schwelle', () => {
    // 40 h: Hochwasser längst veraltet, KRITIS nicht.
    expect(fachebeneAlter('hochwasser', vorMin(40 * 60), jetzt)?.veraltet).toBe(true);
    expect(fachebeneAlter('kritis', vorMin(40 * 60), jetzt)?.veraltet).toBe(false);
  });

  it('reicht den Abrufzeitpunkt unverändert durch', () => {
    expect(fachebeneAlter('dwd', '2026-09-30T11:50:00Z', jetzt)).toEqual({
      abgerufen: '2026-09-30T11:50:00Z',
      veraltet: false,
    });
  });

  it('ein Zeitpunkt in der Zukunft (Uhrenversatz) zählt als frisch', () => {
    expect(fachebeneAlter('nina', vorMin(-90), jetzt)?.veraltet).toBe(false);
  });

  it('ohne oder mit unlesbarem Zeitpunkt gibt es keine Angabe', () => {
    expect(fachebeneAlter('dwd', undefined, jetzt)).toBeNull();
    expect(fachebeneAlter('dwd', '', jetzt)).toBeNull();
    expect(fachebeneAlter('dwd', 'gestern', jetzt)).toBeNull();
  });
});
