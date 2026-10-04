import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode, RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useBefehle } from './useBefehle';
import { useDatensatzTreffer } from './useDatensaetze';
import { useKoordinatenSprung } from './useKoordinatenSprung';
import { useAdressSprung } from './useAdressSprung';
import { useZuletztBefehle, type BefehlsGedaechtnis } from './useZuletztBefehle';
import { einsatzIdAusPfad } from './einsatzPfad';
import { modulAusPfad } from '../einsatz/modulRegistry';
import { CommandPalette } from './CommandPalette';
import { tastaturAktionFuerEreignis } from './befehle';
import { useAuthOptional } from '../auth/AuthContext';
import type { Oeffnung, PaletteModus, TastaturAktionen } from './typen';

interface TastaturEbene {
  id: symbol;
  name: string;
  wurzel: RefObject<HTMLElement | null>;
  aktionen: () => TastaturAktionen;
  reihenfolge: number;
  /**
   * Die Ebene wirkt nur, wenn der Fokus in ihrer Wurzel liegt, und scheidet aus dem
   * Anzeige-Fallback aus (LFH-507). Träger ist die Zeilenebene von `StatusWahl`: als Fallback böte
   * sie „Status setzen“ für eine BELIEBIGE Zeile an. `true` statt `boolean` wie `nichtMerkbar`: die
   * Marke kann nur abziehen.
   */
  nurMitFokus?: true;
}

interface PaletteWert {
  offen: boolean;
  oeffne: () => void;
  schliesse: () => void;
  toggle: () => void;
  registriereTastaturEbene: (ebene: Omit<TastaturEbene, 'id' | 'reihenfolge'>) => () => void;
  meldeTastaturAktionenAenderung: () => void;
}

const PaletteContext = createContext<PaletteWert | null>(null);

/**
 * Löst eine Ebenen-KETTE zu einer Aktionsmenge auf: die erste Ebene, die eine Aktion belegt,
 * gewinnt; die Kette kommt von TIEF nach FLACH. Rein und exportiert, damit „tief gewinnt“ als
 * Regel prüfbar ist.
 *
 * Ein Schlüssel mit `undefined` zählt NICHT als Belegung: Aufrufer schreiben
 * `speichern: darfSchreiben ? cb : undefined`, und das Loch darf die Aktion einer flacheren Ebene
 * nicht verdecken.
 */
export function verschmelzeAktionen(ketteVonTiefNachFlach: TastaturAktionen[]): TastaturAktionen {
  const verschmolzen: TastaturAktionen = {};
  for (const ebene of ketteVonTiefNachFlach) {
    for (const [id, callback] of Object.entries(ebene) as [
      keyof TastaturAktionen,
      (() => void) | undefined,
    ][]) {
      if (!callback || verschmolzen[id]) continue;
      verschmolzen[id] = callback;
    }
  }
  return verschmolzen;
}

/**
 * Die Wurzel der Ebene, wenn sie als ANZEIGE-Fallback taugt, sonst `null`. Ausgeschlossen:
 *
 *  - **nicht am Dokument** (`isConnected`): die Abmeldung läuft im Effekt-Cleanup, nach dem
 *    Aushängen.
 *  - **`[hidden]` / `[aria-hidden="true"]` an der Wurzel oder darüber**: antds `Tabs` lassen
 *    verlassene Reiter so im Baum; deren unsichtbare Liste böte sonst „Spalten“ an.
 *  - **keine belegte Aktion**: eine leere Ebene verdrängte die nützliche darunter.
 *  - **nur mit Fokus** (`nurMitFokus`, LFH-507): eine zeilengebundene Aktion ohne Fokuszeile
 *    hätte kein Objekt. Das hängt bewusst nicht an der DOM-Tiefe (heute läge die Zeile meist tiefer
 *    als die Werkzeugzeile); ohne flachere Ebene wäre die Zeile sonst selbst der Fallback.
 *
 * **Was der Filter NICHT sieht** (Vertragsteil): Unsichtbarkeit aus dem LAYOUT (`display: none`
 * aus einer Klasse, Höhe 0, `content-visibility`). jsdom rechnet kein Layout, ein Filter darauf
 * wäre im Vitest nicht prüfbar. Geprüft werden die zwei Attribute, die eine Bibliothek zum
 * absichtlichen Verstecken setzt.
 */
function fallbackWurzel(ebene: TastaturEbene): HTMLElement | null {
  if (ebene.nurMitFokus) return null;
  const wurzel = ebene.wurzel.current;
  if (!wurzel?.isConnected) return null;
  if (wurzel.closest('[hidden], [aria-hidden="true"]')) return null;
  if (Object.keys(verschmelzeAktionen([ebene.aktionen()])).length === 0) return null;
  return wurzel;
}

/**
 * Die flachste registrierte Ebene als einelementige Kette, Kandidat für den ANZEIGE-Fallback,
 * wenn kein Fokus-Containment greift. „Flachste“ = kleinste DOM-Tiefe, bei Gleichstand die zuerst
 * registrierte. GENAU EINE Ebene: mehrere stellten dieselbe Beschriftung mehrfach in die Liste,
 * ohne zu sagen, welche Fläche gemeint ist.
 */
function flachsteEbene(ebenen: Map<symbol, TastaturEbene>): TastaturEbene[] {
  let flachste: TastaturEbene | null = null;
  let kleinsteTiefe = Number.POSITIVE_INFINITY;
  for (const ebene of ebenen.values()) {
    const wurzel = fallbackWurzel(ebene);
    if (!wurzel) continue;
    let tiefe = 0;
    for (let el: HTMLElement | null = wurzel; el; el = el.parentElement) tiefe += 1;
    // Der `reihenfolge`-Vergleich entspricht heute der Iterationsreihenfolge der Map; er steht hier,
    // damit die Regel nicht an einer ungeschriebenen Eigenschaft der Map hängt.
    if (
      tiefe < kleinsteTiefe ||
      (tiefe === kleinsteTiefe && ebene.reihenfolge < (flachste?.reihenfolge ?? Infinity))
    ) {
      flachste = ebene;
      kleinsteTiefe = tiefe;
    }
  }
  return flachste ? [flachste] : [];
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [offen, setOffen] = useState(false);
  // Ein gekoppeltes Gerät hat keine Sprungpalette (LFH-892, Spec `feldgeraet-bedienung`): ihre
  // Sprünge führten in Module, die seine Ansicht nicht liest.
  const ohnePalette = useAuthOptional()?.geraet != null;
  /**
   * Das Befehls-Gedächtnis hängt HIER und nicht in `PaletteHost`: der Provider ist app-weit
   * montiert, der Stand ist beim ersten `Strg/⌘+K` meist schon da, und der Schreib-Callback
   * funktioniert noch nach dem Abhängen der Palette (Herleitung an `useZuletztBefehle`).
   */
  const gedaechtnis = useZuletztBefehle();
  const ebenenRef = useRef(new Map<symbol, TastaturEbene>());
  // Ketten statt einzelner Ebenen: eine Werkzeugleiste kennt „Filter zurücksetzen“, die Seite
  // darüber „Neue Zeile“. Beide Refs halten die Kette von TIEF nach FLACH; leer heißt „keine
  // registrierte Wurzel enthält den Fokus“.
  const aktiveKetteRef = useRef<TastaturEbene[]>([]);
  const vorPaletteKetteRef = useRef<TastaturEbene[]>([]);
  const naechsteReihenfolgeRef = useRef(0);
  const offenRef = useRef(false);
  const [, setAktionsRevision] = useState(0);
  const meldeTastaturAktionenAenderung = useCallback(() => {
    setAktionsRevision((revision) => revision + 1);
  }, []);
  const oeffne = useCallback(() => {
    if (offenRef.current || ohnePalette) return;
    // Bewusst die ROHE Kette merken: ein Anzeige-Fallback liefe sonst über `schliesse` in den
    // Tastenweg, und Strg+S feuerte auf einer Maske, die der Fokus verlassen hat.
    vorPaletteKetteRef.current = aktiveKetteRef.current;
    offenRef.current = true;
    setOffen(true);
  }, [ohnePalette]);
  const schliesse = useCallback(() => {
    if (!offenRef.current) return;
    aktiveKetteRef.current = vorPaletteKetteRef.current;
    vorPaletteKetteRef.current = [];
    offenRef.current = false;
    setOffen(false);
  }, []);
  const toggle = useCallback(() => {
    if (offenRef.current) schliesse();
    else oeffne();
  }, [oeffne, schliesse]);

  /**
   * Sammelt ALLE Ebenen, deren Wurzel das Ziel enthält, von tief nach flach (Gleichstand → später
   * registrierte zuerst). Strikt Fokus-Containment: enthält keine Wurzel das Ziel, ist die Kette
   * LEER. Ein Fallback gehört nicht hierher, er liefe in den Tastenweg.
   */
  const waehleEbene = useCallback((ziel: EventTarget | null) => {
    if (!(ziel instanceof Node)) return;
    const enthaltend: { ebene: TastaturEbene; tiefe: number }[] = [];
    for (const ebene of ebenenRef.current.values()) {
      const wurzel = ebene.wurzel.current;
      if (!wurzel?.contains(ziel)) continue;
      let tiefe = 0;
      for (let el: HTMLElement | null = wurzel; el; el = el.parentElement) tiefe += 1;
      enthaltend.push({ ebene, tiefe });
    }
    enthaltend.sort((a, b) => b.tiefe - a.tiefe || b.ebene.reihenfolge - a.ebene.reihenfolge);
    aktiveKetteRef.current = enthaltend.map((x) => x.ebene);
  }, []);

  const registriereTastaturEbene = useCallback(
    (ebene: Omit<TastaturEbene, 'id' | 'reihenfolge'>) => {
      const id = Symbol(ebene.name);
      const registriert: TastaturEbene = {
        ...ebene,
        id,
        reihenfolge: naechsteReihenfolgeRef.current++,
      };
      ebenenRef.current.set(id, registriert);
      waehleEbene(document.activeElement);
      return () => {
        ebenenRef.current.delete(id);
        if (aktiveKetteRef.current.some((e) => e.id === id)) {
          aktiveKetteRef.current = [];
          waehleEbene(document.activeElement);
        }
        // FILTERN, nicht leeren: eine abgemeldete Ebene darf die übrigen der Kette nicht mitnehmen.
        vorPaletteKetteRef.current = vorPaletteKetteRef.current.filter((e) => e.id !== id);
        if (offenRef.current) meldeTastaturAktionenAenderung();
      };
    },
    [meldeTastaturAktionenAenderung, waehleEbene],
  );

  useEffect(() => {
    function aufFokus(e: FocusEvent) {
      waehleEbene(e.target);
    }
    window.addEventListener('focusin', aufFokus);
    return () => window.removeEventListener('focusin', aufFokus);
  }, [waehleEbene]);

  useEffect(() => {
    function aufTaste(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat || e.isComposing) return;
      if (
        !e.shiftKey &&
        !e.altKey &&
        (e.metaKey || e.ctrlKey) &&
        (e.key === 'k' || e.key === 'K')
      ) {
        e.preventDefault();
        toggle();
        return;
      }

      const aktion = tastaturAktionFuerEreignis(e);
      if (!aktion) return;
      if (offen) {
        e.preventDefault();
        if (aktion === 'verwerfen') schliesse();
        return;
      }

      // Eine registrierte Root kann ihr fokussiertes Kind remounten, ohne selbst zu
      // unmounten (ETB-Filterreset). Dann gibt es kein `focusin`, das die bisher aktive
      // Kette räumt. Vor jeder Ausführung deshalb gegen ein reales DOM-Ereignisziel
      // prüfen. Direkt auf `window` erzeugte Ereignisse behalten die explizit restaurierte
      // Vor-Palette-Kette; Browser-Tastaturereignisse stammen dagegen von einem DOM-Knoten.
      if (e.target instanceof Node) waehleEbene(e.target);
      const callback = verschmelzeAktionen(aktiveKetteRef.current.map((x) => x.aktionen()))[aktion];
      if (!callback) return;
      e.preventDefault();
      callback();
    }
    window.addEventListener('keydown', aufTaste);
    return () => window.removeEventListener('keydown', aufTaste);
  }, [offen, schliesse, toggle, waehleEbene]);

  const wert = useMemo(
    () => ({
      offen,
      oeffne,
      schliesse,
      toggle,
      registriereTastaturEbene,
      meldeTastaturAktionenAenderung,
    }),
    [offen, oeffne, schliesse, toggle, registriereTastaturEbene, meldeTastaturAktionenAenderung],
  );
  // Die KETTE wird beim Rendern festgehalten, die CALLBACKS erst beim Auslösen aufgelöst:
  //   - spät auflösen, weil eine Ebene ihre Aktionen bei offener Palette tauschen kann;
  //   - die Kette lokal halten, weil `CommandPalette.fuehreAus` erst `schliesse()` (leert
  //     `vorPaletteKetteRef`) und dann `ausfuehren()` ruft.
  // Anzeige-Fallback AUSSCHLIESSLICH hier: der Klick auf den „Suchen“-Trigger nimmt den Fokus aus
  // jeder Wurzel, die Gruppe „Aktionen“ bliebe sonst auf dem Berührungsweg leer. Eine
  // Palettenzeile ist ein bewusster Griff auf eine beschriftete Aktion, ein globales Tastenkürzel
  // nicht; im Tastenweg feuerte Strg+S sonst auf einer verlassenen Maske.
  const paletteKette =
    vorPaletteKetteRef.current.length > 0
      ? vorPaletteKetteRef.current
      : flachsteEbene(ebenenRef.current);
  const ketteAktionen = () => verschmelzeAktionen(paletteKette.map((e) => e.aktionen()));
  const aktiveAktionen: TastaturAktionen = {};
  for (const id of Object.keys(ketteAktionen()) as (keyof TastaturAktionen)[]) {
    aktiveAktionen[id] = () => ketteAktionen()[id]?.();
  }

  return (
    <PaletteContext.Provider value={wert}>
      {children}
      {offen && (
        <PaletteHost
          schliesse={schliesse}
          tastaturAktionen={aktiveAktionen}
          gedaechtnis={gedaechtnis}
        />
      )}
    </PaletteContext.Provider>
  );
}

/**
 * Lädt Befehle und Datensätze erst beim Öffnen. ZWEI HOOKS statt eines erweiterten `useBefehle`:
 * das memoisiert über viele Dependencies, eine tastenabhängige Quelle dort baute die ganze
 * Befehlsliste je Anschlag neu. Der Datensatz-Weg hängt am ENTPRELLTEN Stand.
 */
function PaletteHost({
  schliesse,
  tastaturAktionen,
  gedaechtnis,
}: {
  schliesse: () => void;
  tastaturAktionen: TastaturAktionen;
  gedaechtnis: BefehlsGedaechtnis;
}) {
  /**
   * EIN STANDBILD beim Öffnen: `useState` liest den Initialwert einmal, der Stand gilt für die ganze
   * Öffnung. Sonst entstünde bei später Serverantwort die OBERSTE Gruppe mitten in der offenen
   * Palette, und jede Zeile rückte unter dem Finger nach unten (WCAG 3.2.5).
   *
   * `PaletteHost` wird beim Schließen abgehängt, das Standbild gilt je Öffnung neu. Der SCHREIBweg
   * liest aus dem QueryClient, damit zwei Ausführungen sich nicht überschreiben. Preis: wer die
   * Palette vor der ersten Antwort öffnet, sieht das Gedächtnis erst beim nächsten Mal
   * (`e2e/palette-gedaechtnis.spec.ts` wartet deshalb auf die Antwort).
   */
  const [zuletztBefehlIds] = useState(gedaechtnis.ids);
  const gefroren = useMemo(
    () => ({ ids: zuletztBefehlIds, merke: gedaechtnis.merke }),
    [zuletztBefehlIds, gedaechtnis.merke],
  );
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const einsatzId = einsatzIdAusPfad(pathname);
  const [stand, setStand] = useState<{ modus: PaletteModus; rest: string }>({
    modus: 'alles',
    rest: '',
  });

  // Identitätsstabil, weil beide in `useMemo`-Dependencies der Hooks darunter stehen.
  //
  // Der NEUE TAB (Strg/⌘+↵) wird hier geöffnet und nirgends sonst: die Palette bleibt
  // präsentational, die Bauorte rein. Die Pfade sind App-absolut (Router ohne `basename`), also
  // direkt eine URL dieses Ursprungs. `noopener`, weil der neue Tab nichts teilen muss; die
  // Sitzung liegt im Cookie.
  const gehZu = useCallback(
    (pfad: string, oeffnung?: Oeffnung) => {
      if (oeffnung === 'neuerTab') window.open(pfad, '_blank', 'noopener');
      else navigate(pfad);
    },
    [navigate],
  );
  // ALLE drei Befehlsquellen öffnen über `gehZu` (feste Befehle, Datensätze, Koordinatensprung),
  // nur so gilt der neue Tab für jede Zeile mit Ziel.
  const befehle = useBefehle(tastaturAktionen, gefroren, gehZu);
  const melde = useCallback((modus: PaletteModus, rest: string) => {
    // Gleicher Stand → gleiches Objekt: die Frist läuft auch beim bloßen Öffnen ab.
    setStand((v) => (v.modus === modus && v.rest === rest ? v : { modus, rest }));
  }, []);

  const datensatzTreffer = useDatensatzTreffer({
    einsatzId,
    modus: stand.modus,
    suche: stand.rest,
    // Die AKTUELLE ROUTE als Modulschlüssel (aus der Registry): wer im Kräfte-Modul einen
    // Funkrufnamen tippt, meint das Fahrzeug.
    aktuellerModulKey: modulAusPfad(pathname)?.key ?? null,
    navigate: gehZu,
  });

  const koordinatenSprung = useKoordinatenSprung({
    einsatzId,
    modus: stand.modus,
    suche: stand.rest,
    navigate: gehZu,
  });
  const adressSprung = useAdressSprung({
    einsatzId,
    modus: stand.modus,
    suche: stand.rest,
    navigate: gehZu,
  });

  return (
    <CommandPalette
      befehle={befehle}
      datensatzTreffer={datensatzTreffer}
      onSucheEntprellt={melde}
      // Außerhalb eines Einsatzes gibt es keine Lagekarte, also auch keinen Fußhinweis.
      koordinatenSprung={einsatzId == null ? undefined : koordinatenSprung}
      adressSprung={einsatzId == null ? undefined : adressSprung}
      // Vorschauen gibt es nur für Datensätze, Datensätze nur im Einsatz.
      vorschauVerfuegbar={einsatzId != null}
      schliesse={schliesse}
    />
  );
}

export function useCommandPalette(): PaletteWert {
  const w = useContext(PaletteContext);
  if (!w)
    throw new Error(
      'useCommandPalette muss innerhalb von <CommandPaletteProvider> verwendet werden',
    );
  return w;
}

export function useTastaturEbene({
  name,
  wurzel,
  aktionen,
  aktiv = true,
  nurMitFokus,
}: {
  name: string;
  wurzel: RefObject<HTMLElement | null>;
  aktionen: TastaturAktionen;
  aktiv?: boolean;
  /** Siehe {@link TastaturEbene.nurMitFokus}. */
  nurMitFokus?: true;
}) {
  const wert = useContext(PaletteContext);
  // Die Ebene ist progressive Tastaturbedienung: isolierte Komponenten, Tests und
  // Vorschauen dürfen ohne den App-Provider rendern; dort bleibt der Hook ein No-op.
  const registriereTastaturEbene = wert?.registriereTastaturEbene;
  const meldeTastaturAktionenAenderung = wert?.meldeTastaturAktionenAenderung;
  const aktionenRef = useRef(aktionen);
  aktionenRef.current = aktionen;
  const aktionsSignatur = Object.entries(aktionen)
    .filter(([, callback]) => typeof callback === 'function')
    .map(([id]) => id)
    .sort()
    .join('|');

  useEffect(() => {
    if (!aktiv || !registriereTastaturEbene) return;
    return registriereTastaturEbene({
      name,
      wurzel,
      aktionen: () => aktionenRef.current,
      nurMitFokus,
    });
  }, [aktiv, name, nurMitFokus, registriereTastaturEbene, wurzel]);

  useEffect(() => {
    if (aktiv) meldeTastaturAktionenAenderung?.();
  }, [aktiv, aktionsSignatur, meldeTastaturAktionenAenderung]);
}
