// frontend/src/command-palette/CommandPaletteProvider.tsx
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
import { useZuletztBefehle, type BefehlsGedaechtnis } from './useZuletztBefehle';
import { einsatzIdAusPfad } from './einsatzPfad';
import { modulAusPfad } from '../einsatz/modulRegistry';
import { CommandPalette } from './CommandPalette';
import { tastaturAktionFuerEreignis } from './befehle';
import type { PaletteModus, TastaturAktionen } from './typen';

interface TastaturEbene {
  id: symbol;
  name: string;
  wurzel: RefObject<HTMLElement | null>;
  aktionen: () => TastaturAktionen;
  reihenfolge: number;
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
 * Löst eine Ebenen-KETTE zu einer Aktionsmenge auf: die erste Ebene, die eine Aktion
 * belegt, gewinnt — die Kette kommt von TIEF nach FLACH (LFH-391 · B).
 *
 * Rein und exportiert nach dem Repo-Muster von `bedienzielStil`/`aktionsabstand`: nur so
 * ist die Richtung „tief gewinnt" eine Aussage über die REGEL statt über eine zufällige
 * Verschachtelung im Test.
 *
 * Ein Schlüssel mit `undefined` zählt bewusst NICHT als Belegung. `TastaturAktionen` ist
 * ein Partial, und Aufrufer schreiben regelmäßig `speichern: darfSchreiben ? cb :
 * undefined` — würde das Loch als Belegung gelten, verdeckte eine tiefe Ebene die Aktion
 * einer flacheren, und die Aktion verschwände, statt durchzureichen.
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
 * Die Wurzel der Ebene, wenn sie als ANZEIGE-Fallback taugt — sonst `null`. Drei
 * Ausschlüsse, jeder mit eigenem Grund:
 *
 *  - **nicht am Dokument** (`isConnected`): eine ausgehängte Wurzel ist unerreichbar. Die
 *    Abmeldung läuft im Effekt-Cleanup und damit nach dem Aushängen; dazwischen steht die
 *    Ebene noch in der Map.
 *  - **`[hidden]` / `[aria-hidden="true"]` an der Wurzel oder darüber**: gemessen an antds
 *    `Tabs` — ein besuchter und wieder verlassener Reiter bleibt IM Baum
 *    (`class="ant-tabs-content ant-tabs-content-hidden"`, `aria-hidden="true"`). Auf der
 *    UHS-Detailseite gewann so die unsichtbare „Bewegungen"-Liste den Fallback und bot
 *    „Spalten" an, deren Portal-Menü an einem Auslöser ohne Layout hängt.
 *  - **keine belegte Aktion**: eine leere Ebene hat nichts anzubieten, verdrängte als
 *    flachste aber die nützliche darunter. Das ist die Verteidigung in der Tiefe hinter
 *    dem `aktiv`-Riegel von `EinsatzSeite`, nicht sein Ersatz.
 *
 * **Was der Filter NICHT sieht** (Vertragsteil, kein Beiwerk): jede Unsichtbarkeit, die
 * erst aus dem LAYOUT folgt — `display: none`/`visibility: hidden` aus einer Klasse, Höhe
 * 0, aus dem Sichtfeld geschoben, `content-visibility`. jsdom rechnet kein Layout,
 * `offsetParent` ist dort IMMER null und `getComputedStyle` liefert keine
 * Stylesheet-Regeln zurück; ein Filter darauf wäre im Vitest nicht prüfbar. Geprüft
 * werden deshalb die zwei ATTRIBUTE, die eine Bibliothek setzt, wenn sie etwas absichtlich
 * versteckt — sie tragen zugleich die Aussage, die für Vorlesende ohnehin gilt.
 */
function fallbackWurzel(ebene: TastaturEbene): HTMLElement | null {
  const wurzel = ebene.wurzel.current;
  if (!wurzel?.isConnected) return null;
  if (wurzel.closest('[hidden], [aria-hidden="true"]')) return null;
  if (Object.keys(verschmelzeAktionen([ebene.aktionen()])).length === 0) return null;
  return wurzel;
}

/**
 * Die flachste registrierte Ebene als einelementige Kette — Kandidat für den
 * ANZEIGE-Fallback, wenn kein Fokus-Containment greift (LFH-391 · B).
 *
 * „Flachste" heisst kleinste DOM-Tiefe der Wurzel, bei Gleichstand die zuerst
 * registrierte. Bewusst GENAU EINE Ebene und nicht „alle Ebenen der Seite": mehrere
 * gleichrangige Kandidaten stellten dieselbe Beschriftung mehrfach in die Liste
 * („Spalten", „Filter zurücksetzen"), ohne dass die Zeile sagt, welche Fläche sie meint —
 * und Mehrdeutigkeit ist an dieser Stelle schlechter als Abwesenheit. (Die früher hier
 * genannte Begründung „zwei gleich tiefe Datensichten nebeneinander, PersonenPage rendert
 * zwei" stimmt nicht und ist nachgezählt: deren beide `Datensicht`-Aufrufe stehen im
 * ENTWEDER/ODER an derselben Baumstelle, im Bestand rendert keine Seite zwei gleichzeitig.)
 */
function flachsteEbene(ebenen: Map<symbol, TastaturEbene>): TastaturEbene[] {
  let flachste: TastaturEbene | null = null;
  let kleinsteTiefe = Number.POSITIVE_INFINITY;
  for (const ebene of ebenen.values()) {
    const wurzel = fallbackWurzel(ebene);
    if (!wurzel) continue;
    let tiefe = 0;
    for (let el: HTMLElement | null = wurzel; el; el = el.parentElement) tiefe += 1;
    // Der `reihenfolge`-Vergleich sagt heute dasselbe wie die Iterationsreihenfolge der
    // Map: jede Registrierung bekommt ein frisches Symbol und hängt hinten an, gelöscht
    // wird ohne Umsortieren. Der Gleichstands-Test pinnt deshalb das ERGEBNIS („die zuerst
    // registrierte gewinnt"), nicht diesen Zweig; er steht trotzdem hier, damit die Regel
    // nicht an einer ungeschriebenen Eigenschaft der Map hängt.
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
  /**
   * Das Befehls-Gedächtnis hängt HIER und nicht in `PaletteHost` (LFH-391 · Etappe D) —
   * beide Hälften brauchen einen Träger, der die Palette überlebt bzw. ihr vorausgeht.
   * Die Herleitung steht an `useZuletztBefehle`; hier steht nur die Folge: der Provider
   * ist app-weit montiert, also ist der Stand beim ersten `Strg/⌘+K` in aller Regel schon
   * da, und der Schreib-Callback funktioniert noch, wenn die Palette längst abgehängt ist.
   */
  const gedaechtnis = useZuletztBefehle();
  const ebenenRef = useRef(new Map<symbol, TastaturEbene>());
  // Ketten statt einzelner Ebenen (LFH-391 · B): eine Werkzeugleiste kennt „Filter
  // zurücksetzen", die Seite darüber „Neue Zeile" — mit genau EINER aktiven Ebene
  // verdeckte die tiefere die flachere vollständig. Beide Refs halten die Kette von TIEF
  // nach FLACH; leer heißt „keine registrierte Wurzel enthält den Fokus".
  const aktiveKetteRef = useRef<TastaturEbene[]>([]);
  const vorPaletteKetteRef = useRef<TastaturEbene[]>([]);
  const naechsteReihenfolgeRef = useRef(0);
  const offenRef = useRef(false);
  const [, setAktionsRevision] = useState(0);
  const meldeTastaturAktionenAenderung = useCallback(() => {
    setAktionsRevision((revision) => revision + 1);
  }, []);
  const oeffne = useCallback(() => {
    if (offenRef.current) return;
    // Bewusst die ROHE Kette merken. Schliche hier ein Anzeige-Fallback ein, gäbe
    // `schliesse` ihn an den Tastenweg zurück — und Strg+S feuerte auf einer Maske, die
    // der Fokus längst verlassen hat.
    vorPaletteKetteRef.current = aktiveKetteRef.current;
    offenRef.current = true;
    setOffen(true);
  }, []);
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
   * Sammelt ALLE Ebenen, deren Wurzel das Ziel enthält, und ordnet sie von tief nach
   * flach (Gleichstand → später registrierte zuerst). Die Auswahlregel bleibt strikt
   * Fokus-Containment: enthält keine Wurzel das Ziel, ist die Kette LEER. Ein Fallback
   * gehört hier ausdrücklich nicht hin — er liefe in den Tastenweg.
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
        // FILTERN, nicht leeren: die gemerkte Kette trägt mehrere Ebenen, und eine
        // abgemeldete darf die übrigen nicht mitnehmen. (Mit einer einzelnen Ebene war
        // „nullen" dasselbe wie „filtern" — bei einer Kette ist es ein Datenverlust.)
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
  // Die KETTE wird beim Rendern festgehalten, die CALLBACKS erst beim Auslösen aufgelöst.
  // Beides ist nötig, und beides ist gemessen:
  //   - spät auflösen, weil eine Ebene ihre Aktionen tauschen kann, während die Palette
  //     offen steht (`meldeTastaturAktionenAenderung` rendert dann neu);
  //   - die Kette aber lokal halten, weil `CommandPalette.fuehreAus` erst `schliesse()`
  //     und dann `ausfuehren()` ruft — `schliesse` leert `vorPaletteKetteRef`, und ein
  //     Zugriff auf die Ref zur Aufrufzeit liefe deshalb ins Leere.
  // Anzeige-Fallback (LFH-391 · B) — und AUSSCHLIESSLICH hier, nie in `waehleEbene` und
  // nie in der gemerkten Kette. Im Browser gemessen: der Klick auf den sichtbaren
  // „Suchen"-Trigger nimmt den Fokus aus jeder registrierten Wurzel (perHotkey=1 gegen
  // perTrigger=0), die Gruppe „Aktionen" blieb also genau auf dem Berührungsweg leer, für
  // den der Trigger gebaut wurde.
  //
  // Der Unterschied zum Tastenweg ist inhaltlich, nicht kosmetisch: eine Palettenzeile
  // ist ein bewusster Griff auf eine sichtbar beschriftete Aktion, ein globales
  // Tastenkürzel ist es nicht. Läge der Fallback in der Auswahl, feuerte Strg+S das
  // `speichern` einer Maske, die der Fokus längst verlassen hat.
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
 * Lädt die Befehle erst beim Öffnen (Query läuft nicht im Leerlauf) — und seit LFH-391 · C3
 * auch die Datensätze.
 *
 * ZWEI HOOKS, nicht ein erweitertes `useBefehle`, und der Grund ist gemessen: `useBefehle`
 * memoisiert über elf Dependencies; eine tastenabhängige Quelle dort baute die ganze
 * Befehlsliste bei jedem Anschlag neu. Der Datensatz-Weg hängt dagegen ausschliesslich am
 * ENTPRELLTEN Stand, den die Palette selbst meldet.
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
   * EIN STANDBILD beim Öffnen (LFH-391 · Etappe D). `useState` liest den Initialwert genau
   * einmal — der Stand, den die Palette beim Öffnen vorfindet, gilt für ihre ganze Öffnung.
   *
   * Ohne das könnte die Antwort des Servers mitten in der offenen Palette eintreffen und die
   * OBERSTE Gruppe entstehen lassen: jede Zeile darunter rückte nach unten, während der
   * Finger schon unterwegs ist. Das ist derselbe Vertrag, aus dem die Auswahl an der
   * Befehls-ID statt am Index hängt („Live-Updates springen nicht unter dem Cursor",
   * WCAG 3.2.5) — und derselbe, aus dem die Startansicht kuratiert ist und keine
   * nachrückende Datenhalde (LFH-337 · M11).
   *
   * `PaletteHost` wird beim Schliessen abgehängt (`{offen && …}`), das Standbild gilt also
   * je Öffnung neu. Der SCHREIBweg ist bewusst NICHT eingefroren: er liest den Stand aus dem
   * QueryClient, damit zwei Ausführungen hintereinander sich nicht gegenseitig überschreiben.
   *
   * DER PREIS IST GEMESSEN und angenommen: wer die Palette öffnet, BEVOR der erste Abruf
   * zurück ist, sieht das Gedächtnis erst beim nächsten Öffnen — im Betrieb liegen zwischen
   * App-Start und dem ersten `Strg/⌘+K` Sekunden, im Playwright-Lauf Millisekunden, weshalb
   * `e2e/palette-gedaechtnis.spec.ts` ausdrücklich auf die Antwort wartet. Der Tausch ist
   * die Vorgabe des Tickets („erst ab Antwort rendern"): eine Gruppe, die ZUOBERST
   * nachklappt, verschiebt jede Zeile darunter, und das trifft jeden Griff, nicht nur den
   * allerersten nach dem Laden.
   */
  const [zuletztBefehlIds] = useState(gedaechtnis.ids);
  const gefroren = useMemo(
    () => ({ ids: zuletztBefehlIds, merke: gedaechtnis.merke }),
    [zuletztBefehlIds, gedaechtnis.merke],
  );
  const befehle = useBefehle(tastaturAktionen, gefroren);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const einsatzId = einsatzIdAusPfad(pathname);
  const [stand, setStand] = useState<{ modus: PaletteModus; rest: string }>({
    modus: 'alles',
    rest: '',
  });

  // Identitätsstabil, weil beide in `useMemo`-Dependencies der Hooks darunter stehen: ein
  // je Render frisch gebautes Paar machte deren Memoisierung wirkungslos.
  const gehZu = useCallback(
    (pfad: string) => {
      navigate(pfad);
    },
    [navigate],
  );
  const melde = useCallback((modus: PaletteModus, rest: string) => {
    // Gleicher Stand → gleiches Objekt: die Frist läuft auch beim blossen Öffnen einmal ab
    // und meldete sonst je Palettenöffnung ein neues, inhaltsgleiches Objekt.
    setStand((v) => (v.modus === modus && v.rest === rest ? v : { modus, rest }));
  }, []);

  const datensatzTreffer = useDatensatzTreffer({
    einsatzId,
    modus: stand.modus,
    suche: stand.rest,
    // Die AKTUELLE ROUTE als Modulschlüssel (LFH-391 · C4, Arbeitspunkt 3): wer im
    // Kräfte-Modul einen Funkrufnamen tippt, meint das Fahrzeug und nicht die gleichnamige
    // Person. Die Zerlegung kommt aus der Registry, nicht von Hand — sie stand im Bestand
    // schon zweimal (`EinsatzLayout`, `ModulStub`).
    aktuellerModulKey: modulAusPfad(pathname)?.key ?? null,
    navigate: gehZu,
  });

  return (
    <CommandPalette
      befehle={befehle}
      datensatzTreffer={datensatzTreffer}
      onSucheEntprellt={melde}
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
}: {
  name: string;
  wurzel: RefObject<HTMLElement | null>;
  aktionen: TastaturAktionen;
  aktiv?: boolean;
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
    });
  }, [aktiv, name, registriereTastaturEbene, wurzel]);

  useEffect(() => {
    if (aktiv) meldeTastaturAktionenAenderung?.();
  }, [aktiv, aktionsSignatur, meldeTastaturAktionenAenderung]);
}
