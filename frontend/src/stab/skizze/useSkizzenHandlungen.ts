import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { ApiError } from '../../api/client';
import type {
  Komponentenart,
  Schriftfeld,
  SkizzenLage,
  Verbindungsstatus,
} from '../../api/fernmeldeskizzeVertrag';
import type { Fernmeldenetz, NetzBereich, NetzVerbindung } from '../fernmeldeskizze';
import type {
  BereichsFelder,
  ExterneStellenart,
  SkizzenAktionen,
  VerbindungsFelder,
} from '../skizzenAktionen';
import {
  Befehlsstapel,
  befehlsGrund,
  type BefehlsStand,
  type SkizzenBefehl,
} from '../skizzenBefehle';
import { bedingungszeichenText } from '../skizzenZeichen';
import { bezugAus } from './bedienung';

/**
 * Die Handlungen der Fläche (LFH-893 D5, D6): jede ruft genau einen Schreibweg aus
 * `SkizzenAktionen`, legt bei Erfolg Handlung und Gegenhandlung auf den Befehlsstapel und meldet
 * ein Scheitern am Element. Die Fläche selbst ruft nie das API.
 *
 * - **Verschieben** zeigt die neue Lage sofort: die eigene Lage steht über dem Netz, solange die
 *   Anfrage läuft und bis ein neueres Netz kommt; danach gilt das Netz, auch wenn es die Zeile
 *   nicht mehr trägt („Neu anordnen“ an einem anderen Arbeitsplatz, Review S1). Erwartet wird die
 *   Version des Netzes (`null` ohne Zeile), bis das Netz nachzieht die der eigenen Antwort; ein
 *   409 setzt das Element zurück und meldet „von einem anderen Arbeitsplatz verschoben“ (D4).
 * - **Gegenhandlungen** von Lage und Bereich schicken genau die Version, die die eigene Handlung
 *   geschrieben hat (Review S3): hat ein anderer Arbeitsplatz dazwischen geändert, ist das ein
 *   409, der Eintrag fällt aus dem Stapel, und nichts wird still überschrieben. Stand das Element
 *   vor dem ersten Verschieben im Auto-Layout, verwirft Rückgängig seine Lage wieder (Review O3).
 *   IDs angelegter Datensätze lesen die Gegenhandlungen erst beim Aufruf.
 * - **Scheitern** steht am Element (`meldungen`) und, weil das Element verschwunden sein kann
 *   („Datensatz inzwischen gelöscht“), zusätzlich als letzte Meldung in der Statuszeile. Sie gilt
 *   bis zur nächsten Handlung an diesem Element oder bis sie quittiert ist (`quittiere`: Escape
 *   am Element, „Quittieren“ im Paneel; Prüfliste O4).
 */

export const VERSCHOBEN_MELDUNG = 'von einem anderen Arbeitsplatz verschoben';

export interface Lage {
  x: number;
  y: number;
  breite?: number | null;
}

export interface Meldung {
  element: string;
  text: string;
}

/** Eigene Lage über dem Netz; `lage: null` = Zeile verworfen (das Auto-Layout stellt). */
interface EigeneLage {
  lage: Lage | null;
  /** Die Anfrage läuft noch. */
  offen: boolean;
  /** Das Netz zur Zeit der Antwort: ein anderes Netz löst die eigene Lage ab. */
  basis: ReadonlyMap<string, SkizzenLage> | null;
}

/** Was die eigene Antwort geschrieben hat, solange das Netz noch das von damals ist. */
interface Bestaetigt {
  version: number | null;
  basis: ReadonlyMap<string, SkizzenLage>;
}

/** Ergebnis eines Lage-Schreibens: was erwartet und was danach gespeichert war. */
interface LageGeschrieben {
  erwartet: number | null;
  version: number | null;
}

interface EigenerBereich {
  felder: BereichsFelder;
  version: number;
}

function ist409(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}

export function useSkizzenHandlungen(
  netz: Fernmeldenetz,
  aktionen: SkizzenAktionen | null,
  befehle: Befehlsstapel,
) {
  const netzRef = useRef(netz);
  useLayoutEffect(() => {
    netzRef.current = netz;
  }, [netz]);
  const bestaetigt = useRef(new Map<string, Bestaetigt>());
  const [eigeneLagen, setEigeneLagen] = useState<ReadonlyMap<string, EigeneLage>>(new Map());
  const [eigeneBereiche, setEigeneBereiche] = useState<ReadonlyMap<string, EigenerBereich>>(
    new Map(),
  );
  const [meldungen, setMeldungen] = useState<ReadonlyMap<string, string>>(new Map());
  const [letzte, setLetzte] = useState<Meldung | null>(null);
  /** Was gerade gespeichert wird: Rückmeldung vor der Serverantwort (Prüfliste Kriterium 3). */
  const [laeuft, setLaeuft] = useState<string | null>(null);

  const stand: BefehlsStand = useSyncExternalStore(
    useCallback((h) => befehle.abonniere(h), [befehle]),
    () => befehle.stand(),
  );

  const melde = useCallback((element: string, text: string | null) => {
    setMeldungen((alt) => {
      const neu = new Map(alt);
      if (text == null) neu.delete(element);
      else neu.set(element, text);
      return neu;
    });
    if (text != null) setLetzte({ element, text });
  }, []);

  /** Nimmt die Meldung am Element zurück, in der Statuszeile nur die dieses Elements. */
  const quittiere = useCallback((element: string) => {
    setMeldungen((alt) => {
      if (!alt.has(element)) return alt;
      const neu = new Map(alt);
      neu.delete(element);
      return neu;
    });
    setLetzte((alt) => (alt?.element === element ? null : alt));
  }, []);

  const name = useCallback((key: string): string => {
    const n = netzRef.current;
    const s = n.stellen.find((x) => x.key === key);
    if (s) return s.bezeichnung;
    const sg = n.sprechgruppen.find((x) => `sg-${x.id}` === key);
    if (sg) return bedingungszeichenText(sg.betriebsart, sg.bezeichnung);
    return key;
  }, []);

  /**
   * Der erwartete Stand fürs nächste Schreiben: die eigene Antwort, solange das Netz noch das von
   * damals ist (zweimal Pfeil rechts, bevor der Cache nachzieht), sonst das Netz — `null`, wenn es
   * keine Zeile trägt.
   */
  const version = useCallback((key: string): number | null => {
    const n = netzRef.current;
    const eigen = bestaetigt.current.get(key);
    if (eigen && eigen.basis === n.lage) return eigen.version;
    bestaetigt.current.delete(key);
    return n.lage.get(key)?.version ?? null;
  }, []);

  /** Führt aus, legt ab und meldet ein Scheitern am Element; wirft weiter (für Inline-Felder). */
  const tue = useCallback(
    async (befehl: SkizzenBefehl) => {
      melde(befehl.element, null);
      setLaeuft(befehl.beschreibung);
      try {
        await befehl.ausfuehren();
      } catch (e) {
        melde(befehl.element, befehl.grund?.(e) ?? befehlsGrund(e));
        throw e;
      } finally {
        setLaeuft((alt) => (alt === befehl.beschreibung ? null : alt));
      }
      befehle.push(befehl);
    },
    [befehle, melde],
  );

  const pflicht = useCallback((): SkizzenAktionen => {
    if (!aktionen) throw new Error('Die Skizze ist schreibgeschützt.');
    return aktionen;
  }, [aktionen]);

  // ── Lage ──────────────────────────────────────────────────────────────────────────────────
  /**
   * Je Element eine Kette: ein zweites Verschieben (zweimal Pfeil rechts) wartet auf die Antwort
   * des ersten und schickt dann dessen Version, statt mit dem alten Stand ein 409 zu holen. Die
   * neue Lage steht sofort im Bild.
   */
  const ketten = useRef(new Map<string, Promise<unknown>>());
  /**
   * Schreibt die Lage (`null` = Zeile verwerfen) mit dem erwarteten Stand `erwartet`; fehlt er,
   * gilt {@link version} zur Zeit des Schreibens.
   */
  const schreibeLage = useCallback(
    (key: string, lage: Lage | null, erwartet?: number | null): Promise<LageGeschrieben> => {
      const a = pflicht();
      const eintrag: EigeneLage = { lage, offen: true, basis: null };
      setEigeneLagen((alt) => new Map(alt).set(key, eintrag));
      const vorher = ketten.current.get(key) ?? Promise.resolve();
      const jetzt = vorher
        .catch(() => {})
        .then(async (): Promise<LageGeschrieben> => {
          const v = erwartet === undefined ? version(key) : erwartet;
          try {
            let neu: number | null = null;
            if (lage) neu = (await a.verschiebe(key, lage, v)).version;
            else if (v != null) await a.entferneLage(key, v);
            const basis = netzRef.current.lage;
            bestaetigt.current.set(key, { version: neu, basis });
            setEigeneLagen((alt) => {
              // Ein späteres Schreiben desselben Elements hat schon eine neuere Lage gesetzt.
              if (alt.get(key) !== eintrag) return alt;
              return new Map(alt).set(key, { lage, offen: false, basis });
            });
            return { erwartet: v, version: neu };
          } catch (e) {
            setEigeneLagen((alt) => {
              if (alt.get(key) !== eintrag) return alt;
              const neu = new Map(alt);
              neu.delete(key);
              return neu;
            });
            if (ist409(e)) bestaetigt.current.delete(key);
            throw e;
          }
        });
      ketten.current.set(key, jetzt);
      return jetzt;
    },
    [pflicht, version],
  );

  const verschieben = useCallback(
    (key: string, ziel: Lage, vorher: Lage) => {
      // Die Version, die dieser Eintrag zuletzt geschrieben hat; `undefined` vor dem ersten Mal.
      // Rückgängig und Wiederholen erwarten genau sie (Review S3).
      let stand: number | null | undefined;
      // Stand das Element vorher im Auto-Layout (keine Zeile erwartet)? Dann verwirft Rückgängig
      // die Zeile wieder, statt die Auto-Lage festzuschreiben (Review O3).
      let ohneZeile = false;
      return tue({
        beschreibung: `Verschieben von ${name(key)}`,
        element: key,
        ausfuehren: async () => {
          const erstes = stand === undefined;
          const r = await schreibeLage(key, ziel, stand);
          if (erstes) ohneZeile = r.erwartet == null;
          stand = r.version;
        },
        zuruecknehmen: async () => {
          stand = (await schreibeLage(key, ohneZeile ? null : vorher, stand)).version;
        },
        grund: (e) => (ist409(e) ? VERSCHOBEN_MELDUNG : null),
      });
    },
    [tue, name, schreibeLage],
  );

  /**
   * Erste Lage einer Schiene aus der Palette. Ohne Rückgängig: weggezogen wird sie wie jede
   * Schiene, verworfen über „Neu anordnen“.
   */
  const setzeSchiene = useCallback(
    async (key: string, lage: Lage) => {
      melde(key, null);
      try {
        await schreibeLage(key, lage);
      } catch (e) {
        melde(key, ist409(e) ? VERSCHOBEN_MELDUNG : befehlsGrund(e));
        throw e;
      }
    },
    [melde, schreibeLage],
  );

  const neuAnordnen = useCallback(async () => {
    await pflicht().neuAnordnen();
    bestaetigt.current.clear();
    setEigeneLagen(new Map());
  }, [pflicht]);

  // ── Zuordnen und Lösen ────────────────────────────────────────────────────────────────────
  const zuordnen = useCallback(
    (stelle: string, sg: number, status?: Verbindungsstatus) =>
      tue({
        beschreibung: `Zuordnung ${name(`sg-${sg}`)} an ${name(stelle)}`,
        element: stelle,
        ausfuehren: () => pflicht().ordneZu(stelle, sg, status),
        zuruecknehmen: () => pflicht().loese(stelle, sg),
      }),
    [tue, name, pflicht],
  );

  const loesen = useCallback(
    (stelle: string, sg: number) => {
      const vorher =
        netzRef.current.schienen
          .find((s) => s.id === sg)
          ?.teilnehmer.find((t) => t.element === stelle)?.status ?? 'bestehend';
      const extern = stelle.startsWith('ks-');
      return tue({
        beschreibung: `Lösen ${name(`sg-${sg}`)} von ${name(stelle)}`,
        element: stelle,
        ausfuehren: () => pflicht().loese(stelle, sg),
        zuruecknehmen: () => pflicht().ordneZu(stelle, sg, extern ? vorher : undefined),
      });
    },
    [tue, name, pflicht],
  );

  /** Status eines Kanals einer externen Stelle (PUT mit `status`, idempotent). */
  const kanalStatus = useCallback(
    (stelle: string, sg: number, status: Verbindungsstatus, vorher: Verbindungsstatus) =>
      tue({
        beschreibung: `Status ${name(`sg-${sg}`)} an ${name(stelle)}`,
        element: stelle,
        ausfuehren: () => pflicht().ordneZu(stelle, sg, status),
        zuruecknehmen: () => pflicht().ordneZu(stelle, sg, vorher),
      }),
    [tue, name, pflicht],
  );

  // ── Verbindungen ──────────────────────────────────────────────────────────────────────────
  const verbinden = useCallback(
    (von: string, nach: string, felder: VerbindungsFelder) => {
      const a = bezugAus(von);
      const b = bezugAus(nach);
      if (!a || !b) return Promise.reject(new Error('Kein Bezug'));
      let id: number | null = null;
      return tue({
        beschreibung: `Verbindung ${name(von)} – ${name(nach)}`,
        element: von,
        ausfuehren: async () => {
          id = (await pflicht().legeVerbindungAn(a, b, felder)).id;
        },
        zuruecknehmen: async () => {
          if (id != null) await pflicht().entferneVerbindung(id);
        },
      });
    },
    [tue, name, pflicht],
  );

  const aendereVerbindung = useCallback(
    (v: NetzVerbindung, felder: Partial<VerbindungsFelder>) => {
      const vorher: Partial<VerbindungsFelder> = {};
      for (const k of Object.keys(felder) as (keyof VerbindungsFelder)[]) {
        (vorher as Record<string, unknown>)[k] = v[k];
      }
      return tue({
        beschreibung: `Verbindung ${name(v.von)} – ${name(v.nach)} ändern`,
        element: v.key,
        ausfuehren: async () => {
          await pflicht().aendereVerbindung(v.id, felder);
        },
        zuruecknehmen: async () => {
          await pflicht().aendereVerbindung(v.id, vorher);
        },
      });
    },
    [tue, name, pflicht],
  );

  const entferneVerbindung = useCallback(
    (v: NetzVerbindung) => {
      const a = bezugAus(v.von);
      const b = bezugAus(v.nach);
      let id = v.id;
      const felder: VerbindungsFelder = {
        art: v.art,
        medium: v.medium,
        status: v.status,
        verkehr: v.verkehr,
        hinweis: v.hinweis,
      };
      return tue({
        beschreibung: `Verbindung ${name(v.von)} – ${name(v.nach)} entfernen`,
        element: v.key,
        ausfuehren: () => pflicht().entferneVerbindung(id),
        zuruecknehmen: async () => {
          if (!a || !b) return;
          id = (await pflicht().legeVerbindungAn(a, b, felder)).id;
        },
      });
    },
    [tue, name, pflicht],
  );

  // ── Komponenten ───────────────────────────────────────────────────────────────────────────
  const legeKomponenteAn = useCallback(
    (art: Komponentenart, bezeichnung: string | null) => {
      let id: number | null = null;
      return tue({
        beschreibung: `Komponente anlegen`,
        element: 'komponente',
        ausfuehren: async () => {
          id = (await pflicht().legeKomponenteAn(art, bezeichnung)).id;
        },
        zuruecknehmen: async () => {
          if (id != null) await pflicht().entferneKomponente(id);
        },
      });
    },
    [tue, pflicht],
  );

  const aendereKomponente = useCallback(
    (
      key: string,
      id: number,
      felder: { art?: Komponentenart; bezeichnung?: string | null },
      vorher: { art?: Komponentenart; bezeichnung?: string | null },
    ) =>
      tue({
        beschreibung: `Komponente ${name(key)} ändern`,
        element: key,
        ausfuehren: async () => {
          await pflicht().aendereKomponente(id, felder);
        },
        zuruecknehmen: async () => {
          await pflicht().aendereKomponente(id, vorher);
        },
      }),
    [tue, name, pflicht],
  );

  /** Unumkehrbar am Server (neue ID); die Seite fragt vorher nach. Rückgängig legt neu an. */
  const entferneKomponente = useCallback(
    (
      key: string,
      id: number,
      art: Komponentenart,
      bezeichnung: string | null,
      kanaele: number[],
    ) => {
      let aktuell = id;
      return tue({
        beschreibung: `Komponente ${name(key)} entfernen`,
        element: key,
        ausfuehren: () => pflicht().entferneKomponente(aktuell),
        zuruecknehmen: async () => {
          const neu = await pflicht().legeKomponenteAn(art, bezeichnung);
          aktuell = neu.id;
          for (const sg of kanaele) await pflicht().ordneZu(`ko-${neu.id}`, sg);
        },
      });
    },
    [tue, name, pflicht],
  );

  /**
   * Legt die Stelle im Kommunikationsplan an (Review S4). Rückgängig entfernt genau die Stelle,
   * deren id der Server für DIESES Anlegen genannt hat — nie eine, die schon bestand.
   */
  const legeExterneStelleAn = useCallback(
    (stellenart: ExterneStellenart, bezeichnung: string) => {
      let id: number | null = null;
      return tue({
        beschreibung: `${bezeichnung} anlegen`,
        element: 'extern',
        ausfuehren: async () => {
          id = (await pflicht().legeExterneStelleAn(stellenart, bezeichnung)).id;
        },
        zuruecknehmen: async () => {
          if (id != null) await pflicht().entferneExterneStelle(id);
        },
      });
    },
    [tue, pflicht],
  );

  // ── Bereiche ──────────────────────────────────────────────────────────────────────────────
  const legeBereichAn = useCallback(
    (felder: { x: number; y: number; breite: number; hoehe: number; bezeichnung?: string }) => {
      let id: number | null = null;
      return tue({
        beschreibung: 'Bereich anlegen',
        element: 'bereich',
        ausfuehren: async () => {
          id = (await pflicht().legeBereichAn(felder)).id;
        },
        zuruecknehmen: async () => {
          if (id != null) await pflicht().entferneBereich(id);
        },
      });
    },
    [tue, pflicht],
  );

  /** Gibt die gespeicherte Version zurück; ohne `erwartet` gilt der jüngste bekannte Stand. */
  const schreibeBereich = useCallback(
    async (b: NetzBereich, felder: BereichsFelder, erwartet?: number): Promise<number> => {
      const a = pflicht();
      const v = eigeneBereiche.get(b.key)?.version;
      const bekannt = Math.max(b.version, Number.isFinite(v) ? (v as number) : -1);
      setEigeneBereiche((alt) => new Map(alt).set(b.key, { felder, version: Infinity }));
      try {
        const antwort = await a.aendereBereich(b.id, felder, erwartet ?? bekannt);
        setEigeneBereiche((alt) => new Map(alt).set(b.key, { felder, version: antwort.version }));
        return antwort.version;
      } catch (e) {
        setEigeneBereiche((alt) => {
          const neu = new Map(alt);
          neu.delete(b.key);
          return neu;
        });
        throw e;
      }
    },
    [pflicht, eigeneBereiche],
  );

  const aendereBereich = useCallback(
    (b: NetzBereich, felder: BereichsFelder) => {
      const vorher: BereichsFelder = {};
      for (const k of Object.keys(felder) as (keyof BereichsFelder)[]) {
        (vorher as Record<string, unknown>)[k] = b[k];
      }
      const aktuell = (): NetzBereich => netzRef.current.bereiche.find((x) => x.key === b.key) ?? b;
      // Wie beim Verschieben: Rückgängig und Wiederholen erwarten genau die Version, die dieser
      // Eintrag zuletzt geschrieben hat (Review S3).
      let stand: number | undefined;
      return tue({
        beschreibung: `Bereich ${b.bezeichnung} ändern`,
        element: b.key,
        ausfuehren: async () => {
          stand = await schreibeBereich(aktuell(), felder, stand);
        },
        zuruecknehmen: async () => {
          stand = await schreibeBereich(aktuell(), vorher, stand);
        },
        grund: (e) => (ist409(e) ? 'von einem anderen Arbeitsplatz geändert' : null),
      });
    },
    [tue, schreibeBereich],
  );

  const entferneBereich = useCallback(
    (b: NetzBereich) => {
      let id = b.id;
      return tue({
        beschreibung: `Bereich ${b.bezeichnung} entfernen`,
        element: b.key,
        ausfuehren: () => pflicht().entferneBereich(id),
        zuruecknehmen: async () => {
          id = (
            await pflicht().legeBereichAn({
              x: b.x,
              y: b.y,
              breite: b.breite,
              hoehe: b.hoehe,
              bezeichnung: b.bezeichnung,
            })
          ).id;
        },
      });
    },
    [tue, pflicht],
  );

  // ── Schriftfeld und Datensatz ─────────────────────────────────────────────────────────────
  const setzeSchriftfeld = useCallback(
    (felder: Partial<Schriftfeld>, vorher: Partial<Schriftfeld>) =>
      tue({
        beschreibung: 'Schriftfeld ändern',
        element: 'schriftfeld',
        ausfuehren: async () => {
          await pflicht().setzeSchriftfeld(felder);
        },
        zuruecknehmen: async () => {
          await pflicht().setzeSchriftfeld(vorher);
        },
      }),
    [tue, pflicht],
  );

  const setzeRufname = useCallback(
    (stelle: string, neu: string | null, alt: string | null) =>
      tue({
        beschreibung: `Rufname von ${name(stelle)}`,
        element: stelle,
        ausfuehren: () => pflicht().setzeRufname(stelle, neu),
        zuruecknehmen: () => pflicht().setzeRufname(stelle, alt),
      }),
    [tue, name, pflicht],
  );

  const setzeKommunikationsmittel = useCallback(
    (stelle: string, neu: string | null, alt: string | null) =>
      tue({
        beschreibung: `Kommunikationsmittel von ${name(stelle)}`,
        element: stelle,
        ausfuehren: () => pflicht().setzeKommunikationsmittel(stelle, neu),
        zuruecknehmen: () => pflicht().setzeKommunikationsmittel(stelle, alt),
      }),
    [tue, name, pflicht],
  );

  // ── Rückgängig ────────────────────────────────────────────────────────────────────────────
  const schritt = useCallback(
    async (richtung: 'rueckgaengig' | 'wiederholen') => {
      const ergebnis =
        richtung === 'rueckgaengig' ? await befehle.rueckgaengig() : await befehle.wiederholen();
      if (ergebnis.art === 'gescheitert') {
        const wort = richtung === 'rueckgaengig' ? 'Rückgängig' : 'Wiederholen';
        melde(ergebnis.element, ergebnis.grund);
        setLetzte({
          element: ergebnis.element,
          text: `${wort} nicht möglich: ${ergebnis.befehl.beschreibung} — ${ergebnis.grund}`,
        });
      } else if (ergebnis.art === 'ok') {
        melde(ergebnis.befehl.element, null);
      }
      return ergebnis;
    },
    [befehle, melde],
  );

  /**
   * Das Netz mit den eigenen Lagen und Bereichen darüber. Eine eigene Lage steht, solange ihre
   * Anfrage läuft und bis ein neueres Netz kommt; danach gilt das Netz (Review S1).
   */
  const angezeigt = useMemo((): Fernmeldenetz => {
    const offen = [...eigeneLagen].filter(([, e]) => e.offen || e.basis === netz.lage);
    const bereiche = [...eigeneBereiche].filter(([key, e]) => {
      const b = netz.bereiche.find((x) => x.key === key);
      return b != null && b.version < e.version;
    });
    if (offen.length === 0 && bereiche.length === 0) return netz;
    const lage = new Map(netz.lage);
    for (const [key, e] of offen) {
      if (!e.lage) {
        lage.delete(key);
        continue;
      }
      lage.set(key, {
        element: key,
        x: e.lage.x,
        y: e.lage.y,
        breite: e.lage.breite ?? netz.lage.get(key)?.breite ?? null,
        version: netz.lage.get(key)?.version ?? 0,
      });
    }
    const jeBereich = new Map(bereiche);
    return {
      ...netz,
      lage,
      bereiche: netz.bereiche.map((b) => {
        const e = jeBereich.get(b.key);
        return e ? { ...b, ...e.felder } : b;
      }),
    };
  }, [netz, eigeneLagen, eigeneBereiche]);

  return {
    angezeigt,
    stand,
    meldungen,
    letzte,
    laeuft,
    melde,
    quittiere,
    verschieben,
    setzeSchiene,
    neuAnordnen,
    zuordnen,
    loesen,
    kanalStatus,
    verbinden,
    aendereVerbindung,
    entferneVerbindung,
    legeKomponenteAn,
    aendereKomponente,
    entferneKomponente,
    legeExterneStelleAn,
    legeBereichAn,
    aendereBereich,
    entferneBereich,
    setzeSchriftfeld,
    setzeRufname,
    setzeKommunikationsmittel,
    rueckgaengig: () => schritt('rueckgaengig'),
    wiederholen: () => schritt('wiederholen'),
  };
}

export type SkizzenHandlungen = ReturnType<typeof useSkizzenHandlungen>;
