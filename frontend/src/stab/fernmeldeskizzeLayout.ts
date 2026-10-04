import type { Fernmeldenetz, NetzBaumKnoten, NetzSchiene, NetzStelle } from './fernmeldeskizze';
import {
  SCHIENE_RAND,
  ZEICHEN_GROESSE,
  bedingungszeichenBreite,
  sammelschienenMindestbreite,
  schaetzeTextbreite,
} from './skizzenZeichen';

/**
 * Auto-Layout der taktischen Fernmeldeskizze (LFH-893 D4), rein und ohne DOM: hängend nach der
 * Führungsorganisation, Ausgabe auf Rasterpunkten (Vielfache von {@link RASTER}, in
 * Benutzereinheiten des SVG).
 *
 * - **Ebenen:** oben die Führungsstelle, darunter je oberster Abschnitt eine Spalte (Einheiten
 *   ohne Abschnitt in einer eigenen Spalte), darin die Stellen jeder Baumtiefe untereinander.
 * - **Schienen** liegen waagerecht im Band unter der höchsten Ebene ihrer Teilnehmer und spannen
 *   über deren Steigleitungen; Schienen eines Bandes, die sich überdecken würden, bekommen je eine
 *   eigene Spur. Das Bedingungszeichen steht rechts neben der letzten Stichleitung, nie auf einer.
 *   Schienen ohne Teilnehmer stehen in einer Zeile unten.
 * - **Steigleitungen:** jede Stelle einer Spalte mit Schiene bekommt links neben den Kästen eine
 *   eigene senkrechte Spur (`steigX`), damit ihre Stichleitung keinen Kasten derselben Spalte
 *   kreuzt.
 * - **Externe Stellen** stehen in einer Spalte rechts; ihre Schienen reichen bis an diese Spalte.
 *   **Komponenten** sitzen auf der Linie ihrer ersten Schiene, rechts neben dem Bedingungszeichen;
 *   ohne Schiene unter den externen Stellen.
 * - **Vorrang:** gespeicherte Lage (`netz.lage`) vor gehaltener (`gehalten`, „ruhige Fläche“ unter
 *   Zeiger und Fokus) vor Auto-Layout. Mit `gehalten` ist jedes Element, das dort fehlt, `neu`.
 *
 * Maße und Abstände sind benannte Konstanten, die die Darstellung teilt; Textbreiten schätzt
 * `stab/skizzenZeichen.tsx` (`schaetzeTextbreite`), damit Layout und Bild dieselbe Zahl rechnen.
 * Die Werte sind vorläufig bis zur Messung (tasks.md 1.1, Nachtrag in design.md D4).
 */

// ── Maße (Benutzereinheiten, Raster 8) ─────────────────────────────────────────────────────

export const RASTER = 8;
/** Rand der Fläche rundum. */
export const RAND = 32;
/** Abstand zwischen zwei Spalten. */
export const SPALTEN_ABSTAND = 32;
/** Abstand zwischen zwei Stellen einer Spalte und zwischen Ebene und Schienenband. */
export const STAPEL_ABSTAND = 16;
/** Innenabstand eines Führungsstellen-Kastens. */
export const KASTEN_POLSTER = 8;
/** Breite des Führungsstellen-Kastens (Führungsstelle, Abschnitt). */
export const KASTEN_BREITE = 176;
/** Breite des Platzes einer Einheit (Zeichen ohne Kasten, Name und Rufname darunter). */
export const EINHEIT_BREITE = 144;
/** Breite des Platzes einer externen Stelle. */
export const EXTERN_BREITE = 160;
/** Breite des Platzes einer Komponente (Zeichen, Bezeichnung darunter). */
export const KOMPONENTE_BREITE = 96;
/** Höhe des taktischen Zeichens einer Stelle. */
export const TZ_HOEHE = 32;
/** Bezeichnung im Kasten in großer Schrift, Name einer Einheit und Rufname darunter. */
export const KASTEN_SCHRIFT = 14;
export const KASTEN_ZEILE = 18;
export const NAME_SCHRIFT = 12;
export const NAME_ZEILE = 16;
/** Eine Zeile für Rufname und eine für Lücke oder Status — immer reserviert, damit eine neue
 * Lücke kein Element verschiebt. */
export const RUFNAME_ZEILE = 16;
export const LUECKE_ZEILE = 16;
/** Höhe einer Schienenspur: Bedingungszeichen auf der Linie, Hinweis darunter. */
export const SPUR_HOEHE = 64;
/** Lage der Linie in ihrer Spur, von oben. */
export const SCHIENE_LINIE_VERSATZ = 24;
/** Abstand der Steigleitungen einer Spalte. */
export const STEIG_ABSTAND = RASTER;

const ZEICHEN_ABSTAND = 4;

export interface Platz {
  /** Linke obere Ecke; bei Schienen die der Spur, die Linie liegt bei `y + SCHIENE_LINIE_VERSATZ`. */
  x: number;
  y: number;
  breite: number;
  hoehe: number;
  quelle: 'gespeichert' | 'gehalten' | 'auto';
  /** Mit `gehalten`: das Element war vorher nicht da und wird als „neu“ markiert. */
  neu: boolean;
  /**
   * Stellen: x der senkrechten Stichleitung (eigene Steigleitung bzw. Mitte der Führungsstelle);
   * `null` = von der Mitte (verschoben) bzw. seitlich (externe Stelle, Komponente).
   */
  steigX: number | null;
  /** Schienen: Mitte des Bedingungszeichens; `null` = Vorgabe der Sammelschiene (Mitte). */
  zeichenX: number | null;
}

export interface SkizzenLayout {
  plaetze: Map<string, Platz>;
  /** Ausdehnung der ganzen Skizze samt Rand, für „Einpassen“. */
  breite: number;
  hoehe: number;
}

function rastere(v: number): number {
  return Math.round(v / RASTER) * RASTER;
}

function aufRaster(v: number): number {
  return Math.ceil(v / RASTER) * RASTER;
}

function zeilen(text: string, schrift: number, breite: number): number {
  return Math.max(1, Math.ceil(schaetzeTextbreite(text, schrift) / breite));
}

/** Breite und Höhe des Platzes einer Stelle; lange Bezeichnungen wachsen nach unten mit. */
export function stellenMasse(s: NetzStelle): { breite: number; hoehe: number } {
  switch (s.art) {
    case 'fuehrungsstelle':
    case 'abschnitt': {
      const innen = KASTEN_BREITE - 2 * KASTEN_POLSTER;
      // Die Führungsstelle trägt ohne Gegenstelle „Einsatzleitung: Gegenstelle nicht erfasst“.
      const text =
        s.art === 'fuehrungsstelle' && s.hinweis ? `${s.bezeichnung}: ${s.hinweis}` : s.bezeichnung;
      const hoehe =
        2 * KASTEN_POLSTER +
        TZ_HOEHE +
        ZEICHEN_ABSTAND +
        zeilen(text, KASTEN_SCHRIFT, innen) * KASTEN_ZEILE +
        RUFNAME_ZEILE +
        LUECKE_ZEILE;
      return { breite: KASTEN_BREITE, hoehe: aufRaster(hoehe) };
    }
    case 'einheit':
    case 'extern': {
      const breite = s.art === 'einheit' ? EINHEIT_BREITE : EXTERN_BREITE;
      const hoehe =
        TZ_HOEHE +
        ZEICHEN_ABSTAND +
        zeilen(s.bezeichnung, NAME_SCHRIFT, breite) * NAME_ZEILE +
        RUFNAME_ZEILE +
        LUECKE_ZEILE;
      return { breite, hoehe: aufRaster(hoehe) };
    }
    case 'komponente': {
      const hoehe =
        ZEICHEN_GROESSE +
        ZEICHEN_ABSTAND +
        zeilen(s.bezeichnung, NAME_SCHRIFT, KOMPONENTE_BREITE) * NAME_ZEILE;
      return { breite: KOMPONENTE_BREITE, hoehe: aufRaster(hoehe) };
    }
  }
}

interface Spalte {
  /** Knoten mit Tiefe (oberster Abschnitt = 1); `sammel` hat keinen Platz. */
  knoten: { key: string; tiefe: number }[];
}

function spalteAus(wurzel: NetzBaumKnoten): Spalte {
  const knoten: Spalte['knoten'] = [];
  const geh = (k: NetzBaumKnoten, tiefe: number) => {
    if (k.key !== 'sammel') knoten.push({ key: k.key, tiefe });
    for (const c of k.kinder) geh(c, tiefe + 1);
  };
  geh(wurzel, 1);
  return { knoten };
}

export function layoutFernmeldenetz(
  netz: Fernmeldenetz,
  opts: { gehalten?: ReadonlyMap<string, Platz> } = {},
): SkizzenLayout {
  const { gehalten } = opts;
  const stelleJeKey = new Map(netz.stellen.map((s) => [s.key, s]));
  const masse = new Map(netz.stellen.map((s) => [s.key, stellenMasse(s)]));
  /** Auto-Plätze der Stellen; y wird erst gesetzt, wenn die Spuren gezählt sind. */
  const auto = new Map<string, Roh>();
  const tiefe = new Map<string, number>([['fs', 0]]);
  const plaetze = new Map<string, Platz>();

  /** Vorrang: gespeicherte Lage, dann gehaltene, dann Auto-Layout. */
  const setze = (key: string, p: Roh) => {
    const lage = netz.lage.get(key);
    if (lage) {
      plaetze.set(key, {
        x: lage.x,
        y: lage.y,
        breite: lage.breite ?? p.breite,
        hoehe: p.hoehe,
        quelle: 'gespeichert',
        neu: false,
        steigX: null,
        zeichenX: null,
      });
    } else {
      const halt = gehalten?.get(key);
      plaetze.set(
        key,
        halt
          ? { ...halt, quelle: 'gehalten', neu: false }
          : { ...p, x: rastere(p.x), y: rastere(p.y), quelle: 'auto', neu: gehalten != null },
      );
    }
    return plaetze.get(key)!;
  };

  // Wer an mindestens einer Schiene hängt, bekommt eine Steigleitung.
  const angeschlossen = new Set(netz.schienen.flatMap((s) => s.teilnehmer.map((t) => t.element)));

  // ── Spalten des Baums: x ────────────────────────────────────────────────────────────────────
  const spalten = netz.baum.map(spalteAus);
  let x = RAND;
  for (const sp of spalten) {
    const mitSteig = sp.knoten.filter((k) => angeschlossen.has(k.key)).map((k) => k.key);
    const steigBreite = mitSteig.length * STEIG_ABSTAND;
    const kaesten = x + (steigBreite > 0 ? steigBreite + STEIG_ABSTAND : 0);
    for (const k of sp.knoten) {
      tiefe.set(k.key, k.tiefe);
      const m = masse.get(k.key)!;
      const i = mitSteig.indexOf(k.key);
      auto.set(k.key, {
        x: kaesten,
        y: 0,
        breite: m.breite,
        hoehe: m.hoehe,
        steigX: i < 0 ? null : x + i * STEIG_ABSTAND,
        zeichenX: null,
      });
    }
    x = kaesten + Math.max(0, ...sp.knoten.map((k) => masse.get(k.key)!.breite)) + SPALTEN_ABSTAND;
  }
  const fsMasse = masse.get('fs');
  const baumRechts = Math.max(x - SPALTEN_ABSTAND, RAND + (fsMasse?.breite ?? 0));
  if (fsMasse) {
    const fsX = rastere((RAND + baumRechts) / 2 - fsMasse.breite / 2);
    auto.set('fs', {
      x: fsX,
      y: 0,
      breite: fsMasse.breite,
      hoehe: fsMasse.hoehe,
      steigX: rastere(fsX + fsMasse.breite / 2),
      zeichenX: null,
    });
  }
  // Vorläufig setzen: die Spannweite der Schienen braucht nur x, und verschobene Stellen stehen
  // so schon dort, wo ihre Stichleitung beginnt.
  for (const [key, p] of auto) setze(key, p);
  const anschlussX = (key: string): number => {
    const p = plaetze.get(key)!;
    return p.steigX ?? p.x + p.breite / 2;
  };

  // ── Schienen: Band (Tiefe des höchsten Teilnehmers), Spannweite, Spur ───────────────────────
  const ersteSchiene = new Map<string, string>();
  for (const s of netz.schienen) {
    for (const t of s.teilnehmer) {
      if (stelleJeKey.get(t.element)?.art === 'komponente' && !ersteSchiene.has(t.element)) {
        ersteSchiene.set(t.element, s.key);
      }
    }
  }
  const komponentenAn = (s: NetzSchiene) =>
    s.teilnehmer.map((t) => t.element).filter((k) => ersteSchiene.get(k) === s.key);
  const komponentenBreite = (n: number) => n * (KOMPONENTE_BREITE + RASTER);

  const entwuerfe: Entwurf[] = [];
  const untenZeile: NetzSchiene[] = [];
  for (const s of netz.schienen) {
    const imBaum = s.teilnehmer.map((t) => t.element).filter((k) => tiefe.has(k));
    const bisRand = s.teilnehmer.some((t) => stelleJeKey.get(t.element)?.art === 'extern');
    // Ohne Teilnehmer im Baum und ohne externe Stelle (leer oder nur Komponenten): unten.
    if (imBaum.length === 0 && !bisRand) {
      untenZeile.push(s);
      continue;
    }
    const xs = imBaum.map(anschlussX);
    const zeichen = bedingungszeichenBreite(s.betriebsart, s.bezeichnung);
    const links = xs.length > 0 ? Math.min(...xs) - SCHIENE_RAND : baumRechts;
    const zeichenX = (xs.length > 0 ? Math.max(...xs) : links) + SCHIENE_RAND + zeichen / 2;
    const rechts = Math.max(
      zeichenX + zeichen / 2 + SCHIENE_RAND,
      links + sammelschienenMindestbreite(s.betriebsart, s.bezeichnung),
    );
    const komponenten = komponentenAn(s);
    entwuerfe.push({
      s,
      band: imBaum.length > 0 ? Math.min(...imBaum.map((k) => tiefe.get(k)!)) : 0,
      links,
      rechts,
      belegtBis: rechts + komponentenBreite(komponenten.length),
      zeichenX,
      komponenten,
      bisRand,
    });
  }

  // Spuren je Band. Die Schiene mit der Stichleitung am weitesten rechts kommt nach oben: so
  // kreuzt eine Steigleitung, die tiefer hinab muss, kein Bedingungszeichen darüber.
  const spurJe = new Map<string, number>();
  const spurenJeBand = new Map<number, [number, number][][]>();
  for (const e of entwuerfe
    .filter((e) => !netz.lage.has(e.s.key) && !gehalten?.has(e.s.key))
    .sort((a, b) => a.band - b.band || b.zeichenX - a.zeichenX)) {
    const spuren = spurenJeBand.get(e.band) ?? [];
    const von = e.links;
    const bis = e.bisRand ? Infinity : e.belegtBis;
    let i = spuren.findIndex((sp) =>
      sp.every(([a, b]) => bis + STAPEL_ABSTAND <= a || b + STAPEL_ABSTAND <= von),
    );
    if (i < 0) {
      i = spuren.length;
      spuren.push([]);
    }
    spuren[i].push([von, bis]);
    spurenJeBand.set(e.band, spuren);
    spurJe.set(e.s.key, i);
  }

  // ── y: Ebene 0, Band 0, Ebene 1, Band 1 … ───────────────────────────────────────────────────
  const maxTiefe = Math.max(0, ...spalten.flatMap((sp) => sp.knoten.map((k) => k.tiefe)));
  const ebeneY: number[] = [];
  const bandY: number[] = [];
  let y = RAND;
  for (let t = 0; t <= maxTiefe; t++) {
    const stapelHoehe =
      t === 0
        ? (fsMasse?.hoehe ?? 0)
        : Math.max(
            0,
            ...spalten.map((sp) => {
              const h = sp.knoten.filter((k) => k.tiefe === t).map((k) => masse.get(k.key)!.hoehe);
              return h.reduce((a, b) => a + b, 0) + Math.max(0, h.length - 1) * STAPEL_ABSTAND;
            }),
          );
    ebeneY.push(y);
    y += stapelHoehe + STAPEL_ABSTAND;
    bandY.push(y);
    const spuren = spurenJeBand.get(t)?.length ?? 0;
    if (spuren > 0) y += spuren * SPUR_HOEHE + STAPEL_ABSTAND;
  }

  for (const sp of spalten) {
    const naechstesY = new Map<number, number>();
    for (const k of sp.knoten) {
      const p = auto.get(k.key)!;
      p.y = naechstesY.get(k.tiefe) ?? ebeneY[k.tiefe];
      naechstesY.set(k.tiefe, p.y + p.hoehe + STAPEL_ABSTAND);
    }
  }
  const fsRoh = auto.get('fs');
  if (fsRoh) fsRoh.y = ebeneY[0];

  // ── Externe Spalte rechts von allem, was Baum, Schienen und Komponenten belegen ─────────────
  const externX = aufRaster(
    Math.max(baumRechts, ...entwuerfe.map((e) => e.belegtBis)) + SPALTEN_ABSTAND,
  );
  let externUnten = RAND;
  for (const s of netz.stellen) {
    const ohneSchiene = s.art === 'komponente' && !ersteSchiene.has(s.key);
    if (s.art !== 'extern' && !ohneSchiene) continue;
    const m = masse.get(s.key)!;
    auto.set(s.key, { x: externX, y: externUnten, ...m, steigX: null, zeichenX: null });
    externUnten += m.hoehe + STAPEL_ABSTAND;
  }

  // Komponenten sitzen auf der Linie ihrer ersten Schiene, rechts von deren belegtem Ende.
  const setzeKomponenten = (keys: string[], schiene: Platz, abX: number) => {
    keys.forEach((k, i) => {
      const m = masse.get(k)!;
      auto.set(k, {
        x: abX + RASTER + komponentenBreite(i),
        y: schiene.y + SCHIENE_LINIE_VERSATZ - ZEICHEN_GROESSE / 2,
        ...m,
        steigX: null,
        zeichenX: null,
      });
    });
  };

  // ── Schienen setzen ─────────────────────────────────────────────────────────────────────────
  for (const e of entwuerfe) {
    const spur = spurJe.get(e.s.key) ?? 0;
    const links = rastere(e.links);
    const rechts = e.bisRand ? externX - SPALTEN_ABSTAND / 2 : aufRaster(e.rechts);
    const p = setze(e.s.key, {
      x: links,
      y: bandY[e.band] + spur * SPUR_HOEHE,
      breite: rechts - links,
      hoehe: SPUR_HOEHE,
      steigX: null,
      zeichenX: e.zeichenX,
    });
    const abX = p.quelle === 'auto' ? aufRaster(e.rechts) : p.x + p.breite;
    setzeKomponenten(e.komponenten, p, abX);
  }
  // Unten eine Zeile, umbrochen an der Breite des Baums, unter der Spalte der externen Stellen.
  let ux = RAND;
  let uy = Math.max(y, untenZeile.length > 0 ? externUnten : 0);
  const zeilenEnde = Math.max(baumRechts, RAND + 4 * KASTEN_BREITE);
  for (const s of untenZeile) {
    const breite = aufRaster(sammelschienenMindestbreite(s.betriebsart, s.bezeichnung));
    const komponenten = komponentenAn(s);
    const belegt = breite + komponentenBreite(komponenten.length);
    if (ux > RAND && ux + belegt > zeilenEnde) {
      ux = RAND;
      uy += SPUR_HOEHE;
    }
    const p = setze(s.key, {
      x: ux,
      y: uy,
      breite,
      hoehe: SPUR_HOEHE,
      steigX: null,
      zeichenX: null,
    });
    setzeKomponenten(komponenten, p, p.quelle === 'auto' ? ux + breite : p.x + p.breite);
    ux = aufRaster(ux + belegt + SPALTEN_ABSTAND);
  }

  // Endgültig: Stellen mit den jetzt bekannten y.
  for (const [key, p] of auto) setze(key, p);

  const alle = [...plaetze.values()];
  const breite = aufRaster(
    Math.max(
      RAND,
      ...alle.map((p) => p.x + p.breite),
      ...netz.bereiche.map((b) => b.x + b.breite),
    ) + RAND,
  );
  const hoehe = aufRaster(
    Math.max(RAND, ...alle.map((p) => p.y + p.hoehe), ...netz.bereiche.map((b) => b.y + b.hoehe)) +
      RAND,
  );
  return { plaetze, breite, hoehe };
}

type Roh = Omit<Platz, 'quelle' | 'neu'>;

interface Entwurf {
  s: NetzSchiene;
  /** Tiefe des höchsten Teilnehmers: das Band darunter. */
  band: number;
  links: number;
  /** Ende der Linie samt Bedingungszeichen. */
  rechts: number;
  /** Ende samt der Komponenten, die auf ihr sitzen. */
  belegtBis: number;
  zeichenX: number;
  komponenten: string[];
  /** Eine externe Stelle hängt daran: die Linie reicht bis an deren Spalte. */
  bisRand: boolean;
}

/** Die Linie einer Schiene in Flächenkoordinaten. */
export function schienenLinieY(p: Platz): number {
  return p.y + SCHIENE_LINIE_VERSATZ;
}
