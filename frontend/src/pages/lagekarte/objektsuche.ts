import type { KarteMarker, MarkerTyp, NichtVerortet } from './marker';
import type { PersonenZugriff } from './personenEbene';
import type { BetreuungZugriff } from './betreuungEbene';
import type { BrZugriff } from './brEbene';
import type { TierZugriff } from './tierEbene';
import { EBENEN, OBJEKTART } from './leistenDaten';

/**
 * Objektsuche der Kartenleiste (Herleitung:
 * `openspec/changes/archive/2026-09-29-lfh-716-lagekarte-markersuche-zeichenpicker/design.md`). Rein, damit die
 * Modulsperre ohne Rendern als Paar prüfbar ist.
 */

/**
 * Die Menge, die die Suche sieht.
 *
 * Die Sperre hängt am Typ, nicht an der Herkunft: `alleVerortet` trägt Betreuungsstellen nur bei
 * freiem Modul, geprüft wird trotzdem — „kein Name ohne Recht" soll nicht an einem Nebeneffekt der
 * Datenquelle hängen.
 *
 * Betroffene nur bei eingeschalteter Ebene: ein Treffer wählt über `onMarkerWaehlen` aus, und das
 * findet nur, was die Karte zeichnet. Ein Treffer, der die Ebene einschaltete, änderte die
 * einsatzweit geteilte Ansicht.
 */
export function suchbareMarker(a: {
  /** `alleVerortet` — ohne Betroffene. */
  verortet: KarteMarker[];
  /** `personenVerortet` — die Betroffenen, getrennt geführt. */
  personen: KarteMarker[];
  personenZugriff: PersonenZugriff;
  personenEbeneAn: boolean;
  betreuungZugriff: BetreuungZugriff;
  /** Ebene „Bereitstellungsräume" (LLH-1107). */
  brZugriff: BrZugriff;
  /** Ebene „Tiere" (LLH-1123). */
  tierZugriff: TierZugriff;
}): KarteMarker[] {
  const personenFrei = a.personenZugriff === 'frei' && a.personenEbeneAn;
  const betreuungFrei = a.betreuungZugriff === 'frei';
  const brFrei = a.brZugriff === 'frei';
  const tierFrei = a.tierZugriff === 'frei';
  const erlaubt = (x: KarteMarker) =>
    x.typ === 'person'
      ? personenFrei
      : x.typ === 'betreuungsstelle'
        ? betreuungFrei
        : x.typ === 'bereitstellungsraum'
          ? brFrei
          : x.typ === 'tier'
            ? tierFrei
            : true;
  return [...a.verortet, ...(personenFrei ? a.personen : [])].filter(erlaubt);
}

/**
 * Gruppen der Objektliste in fester Reihenfolge (LLH-1033, Entwurf LLH-1023 D5): Kräfte vorn,
 * dann Versorgung und Lage, Betroffene am Ende. Der Einsatzort steht davor als eigene Zeile. Die
 * Namen sind die der Ebenen (`EBENEN`), damit dieselbe Sache in beiden Ansichten gleich heißt.
 * `nurVerortet`: Arten, die die Liste nur verortet führt — ihr Kopf zählt ohne „/gesamt“, sonst
 * behauptete „3/3“ bei Betroffenen, alle seien verortet.
 */
export const OBJEKT_GRUPPEN: readonly { typ: MarkerTyp; nurVerortet?: true }[] = [
  { typ: 'fuehrungsstelle', nurVerortet: true },
  { typ: 'einheit' },
  { typ: 'fahrzeug' },
  { typ: 'fuehrung' },
  { typ: 'abschnitt' },
  { typ: 'bereitstellungsraum' },
  { typ: 'uhs' },
  { typ: 'betreuungsstelle' },
  { typ: 'tier' },
  { typ: 'schaden' },
  { typ: 'lagemeldung', nurVerortet: true },
  { typ: 'freies_zeichen', nurVerortet: true },
  { typ: 'person', nurVerortet: true },
];

/**
 * Reihenfolge ohne Suchbegriff und bei Gleichstand der Trefferzahl — ausgeschrieben, weil die
 * Schlüsselreihenfolge von `OBJEKTART` keine erklärte Absicht ist. Dass beide dieselbe Menge
 * tragen, prüft ein Test.
 */
export const TYP_REIHENFOLGE: readonly MarkerTyp[] = [
  'einsatzort',
  ...OBJEKT_GRUPPEN.map((g) => g.typ),
];

/** Ein Objekt der Liste, verortet oder nicht. */
export interface ObjektEintrag {
  /** Schlüssel im Schema der Marker (`einsatzort`, `<typ>-<id>`) — auch für nicht verortete. */
  schluessel: string;
  typ: MarkerTyp;
  /** Objekt-id im Fachmodul (0 für den Einsatzort). */
  id: number;
  label: string;
  verortet: boolean;
}

/**
 * Die Menge der Objektliste: die verorteten aus {@link suchbareMarker}, die nicht verorteten aus
 * `nichtVerortetAlle` und der Einsatzort ohne Koordinate. Die Modulsperre gilt je Typ auch für die
 * nicht verorteten — dass die Datenquelle gesperrte Module gar nicht lädt (LFH-669), ist ein
 * Nebeneffekt, auf den „kein Name ohne Recht“ nicht bauen soll.
 */
export function objektEintraege(a: {
  /** Ergebnis von {@link suchbareMarker}. */
  suchbar: KarteMarker[];
  nichtVerortet: NichtVerortet[];
  /** Der Einsatz ist geladen, sein Einsatzort hat keine Koordinate. */
  einsatzortOhneOrt: boolean;
  betreuungZugriff: BetreuungZugriff;
  brZugriff: BrZugriff;
  tierZugriff: TierZugriff;
}): ObjektEintrag[] {
  const gesperrt = (typ: MarkerTyp) =>
    (typ === 'betreuungsstelle' && a.betreuungZugriff !== 'frei') ||
    (typ === 'bereitstellungsraum' && a.brZugriff !== 'frei') ||
    (typ === 'tier' && a.tierZugriff !== 'frei');
  const liste: ObjektEintrag[] = a.suchbar
    .filter((m) => !gesperrt(m.typ))
    .map((m) => ({
      schluessel: m.schluessel,
      typ: m.typ,
      id: m.id,
      label: m.label,
      verortet: true,
    }));
  if (a.einsatzortOhneOrt)
    liste.push({
      schluessel: 'einsatzort',
      typ: 'einsatzort',
      id: 0,
      label: OBJEKTART.einsatzort,
      verortet: false,
    });
  for (const o of a.nichtVerortet) {
    if (gesperrt(o.typ)) continue;
    liste.push({
      schluessel: `${o.typ}-${o.id}`,
      typ: o.typ,
      id: o.id,
      label: o.label,
      verortet: false,
    });
  }
  return liste;
}

/** Schlüssel des laufenden Platzierungsziels in der Liste; `null` ohne Ziel. */
export function zielSchluessel(ziel: { typ: string; id: number } | null): string | null {
  if (!ziel) return null;
  return ziel.typ === 'einsatzort' ? 'einsatzort' : `${ziel.typ}-${ziel.id}`;
}

/**
 * Ist die Zeile selbst ein Auswahlziel? Verortete immer (Tipp fliegt hin und wählt aus). Von den
 * nicht verorteten nur der Abschnitt ohne Fläche (Übergabe LLH-1057): er hat keinen Marker, sein
 * Inspector trägt „Abschnitt fokussieren“. Die übrigen tragen nur „Platzieren“.
 */
export function istWaehlbar(e: ObjektEintrag): boolean {
  return e.verortet || e.typ === 'abschnitt';
}

export interface ObjektGruppe {
  typ: MarkerTyp;
  label: string;
  eintraege: ObjektEintrag[];
  /** Zahl der verorteten unter den gezeigten Einträgen. */
  verortet: number;
  gesamt: number;
  /** Die Art steht nur verortet in der Liste: der Kopf zählt ohne „/gesamt“. */
  nurVerortet: boolean;
  /** Die Gruppe trägt das laufende Platzierungsziel (sie steht dann immer offen). */
  angeheftet: boolean;
}

export interface ObjektListe {
  /** Die Zeile des Einsatzorts, falls sie zu Begriff und Filter passt (oder platziert wird). */
  einsatzort: ObjektEintrag | null;
  gruppen: ObjektGruppe[];
  /** Nicht verortete Objekte der ganzen Liste — die Zahl der Marke, unabhängig vom Filter. */
  nichtVerortet: number;
}

const GRUPPEN_NAME: Partial<Record<MarkerTyp, string>> = Object.fromEntries(
  EBENEN.map((z) => [z.key, z.name]),
);
const nameDerGruppe = (typ: MarkerTyp) => GRUPPEN_NAME[typ] ?? OBJEKTART[typ];
const sortierer = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/**
 * Gruppiert die Objektliste nach Art. Gesucht wird in Name, Objektart und Gruppenname, ohne Rücksicht
 * auf Groß- und Kleinschreibung („takt“ findet ein unbenanntes Zeichen, „fahrzeuge“ alle
 * Fahrzeuge). Der Filter `nurNichtVerortet` lässt nur nicht verortete stehen. Das laufende
 * Platzierungsziel (`angeheftet`) bleibt bei jedem Begriff und Filter stehen: seine Zeile zeigt,
 * was gerade platziert wird. Leere Gruppen fallen weg.
 *
 * Ohne Begriff in fester Reihenfolge ({@link OBJEKT_GRUPPEN}); mit Begriff nach Trefferzahl
 * absteigend, bei Gleichstand fest — sonst entschiede die Ladereihenfolge der Module.
 */
export function gruppiereObjekte(
  eintraege: ObjektEintrag[],
  opt: { suche: string; nurNichtVerortet: boolean; angeheftet: string | null },
): ObjektListe {
  const begriff = opt.suche.trim().toLocaleLowerCase();
  const passt = (x: ObjektEintrag) => {
    if (x.schluessel === opt.angeheftet) return true;
    if (opt.nurNichtVerortet && x.verortet) return false;
    if (begriff === '') return true;
    return `${x.label} ${OBJEKTART[x.typ]} ${nameDerGruppe(x.typ)}`
      .toLocaleLowerCase()
      .includes(begriff);
  };
  let einsatzort: ObjektEintrag | null = null;
  let nichtVerortet = 0;
  const nachTyp = new Map<MarkerTyp, ObjektEintrag[]>();
  for (const x of eintraege) {
    if (!x.verortet) nichtVerortet++;
    if (!passt(x)) continue;
    if (x.typ === 'einsatzort') {
      einsatzort = x;
      continue;
    }
    const bisher = nachTyp.get(x.typ);
    if (bisher) bisher.push(x);
    else nachTyp.set(x.typ, [x]);
  }
  const rang = (typ: MarkerTyp) => TYP_REIHENFOLGE.indexOf(typ);
  const gruppen = [...nachTyp.entries()].map(([typ, liste]): ObjektGruppe => {
    liste.sort((a, b) => sortierer.compare(a.label, b.label));
    const verortet = liste.filter((x) => x.verortet).length;
    return {
      typ,
      label: nameDerGruppe(typ),
      eintraege: liste,
      verortet,
      gesamt: liste.length,
      nurVerortet: OBJEKT_GRUPPEN.find((g) => g.typ === typ)?.nurVerortet === true,
      angeheftet: liste.some((x) => x.schluessel === opt.angeheftet),
    };
  });
  gruppen.sort((a, b) => (begriff === '' ? 0 : b.gesamt - a.gesamt) || rang(a.typ) - rang(b.typ));
  return { einsatzort, gruppen, nichtVerortet };
}
