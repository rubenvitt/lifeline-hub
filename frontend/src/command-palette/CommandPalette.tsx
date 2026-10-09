import { IconChevronRechts, IconKreuz, IconLupe, IconPfeilLinks } from '../icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Button, Modal, Input, theme, type InputRef } from 'antd';
import { augenbraueStil, useModusFarben } from '../components/rahmenStil';
import Tastenkuerzel from '../components/Tastenkuerzel';
import { useViewport } from '../components/useViewport';
import { paletteMaske, schrift, schriftskala } from '../theme/tokens';
import { istApplePlattform } from './befehle';
import { sichtbareDatensaetze } from './datensaetze';
import {
  UNBEWERTET,
  filtereBefehle,
  filtereNachModus,
  modiMitPraefix,
  ohneOrdnungsdubletten,
  ordneTreffer,
  parsePraefix,
  type Treffer,
} from './fuzzy';
import {
  DATENSATZ_MINDESTZEICHEN,
  GRUPPEN_LABEL,
  GRUPPEN_REIHENFOLGE,
  PALETTE_MODI,
  modusZeigtDatensaetze,
  type Befehl,
  type PaletteModus,
} from './typen';
import { Vorschau } from './Vorschau';
import Fundstellen from '../components/Fundstellen';
import { palettenZeilenStil, schliessKnopfMass, vorschauZielStil } from './zeilenStil';

/**
 * Frist der Meldung nach außen, Wert und Bauform wie in `etb/EtbFilterleiste.tsx`; ein zweiter
 * Entprellungsmechanismus wäre eine zweite Wahrheit.
 */
const ENTPRELLUNG_MS = 300;

/**
 * Maß der Sprungpalette: 640 breit, 120 px von oben, Kopf 52 px. Layoutmaße, keine Trefflächen;
 * die Zeilen tragen ihren Boden über `palettenZeilenStil` aus der Dichte-Staffel.
 */
const PALETTE = { breite: 640, oben: 120, kopf: 52 } as const;

/** EIN Leer-Array statt eines Vorgabewerts im Kopf: ein `[]` dort wäre je Render eine neue
 *  Identität und machte die `useMemo` darunter wirkungslos. */
const KEINE_TREFFER: Treffer[] = [];

/**
 * Der Befehl hinter einer Ordnungszeile: die Gedächtniszeile `ausgefuehrt:<id>` und die
 * Besuchszeile `zuletzt:<modul>` sind Zwillinge von `<id>` bzw. `modul:<modul>`.
 */
function kernId(b: Befehl): string {
  const id = b.id.startsWith('ausgefuehrt:') ? b.id.slice('ausgefuehrt:'.length) : b.id;
  return id.startsWith('zuletzt:') ? `modul:${id.slice('zuletzt:'.length)}` : id;
}

/**
 * Die Tastenmarken der Palette in EINEM Maß, unabhängig von der Dichte: sie sind Satz, kein Ziel,
 * und eine mitwachsende Polsterung bräche die Fußzeile in `komfortabel` auf zwei Zeilen. Ein-Zeichen-
 * Tasten (↵, →, >, #, @) werden gleich breite Quadrate, damit die Legende nicht flattert.
 */
const tasteStil = { padding: '0 4px', fontSize: 11, lineHeight: '16px' } as const;
/** Label und Nebenzeile enden einzeilig in „…“. */
const einzeilig = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
const tasteQuadrat = { ...tasteStil, minWidth: 18, justifyContent: 'center' } as const;

/**
 * Das Kürzel „neuer Tab“ als Marke, in derselben Schreibweise wie das Speichern-Kürzel in
 * `TASTATUR_AKTIONEN`.
 */
function neuerTabKuerzel(userAgent: string): string {
  return istApplePlattform(userAgent) ? '⌘ ↵' : 'Strg ↵';
}

/**
 * Strg/⌘+↵. Beide Modifier gelten auf JEDER Plattform, wie beim Speichern-Kürzel. Shift/Alt
 * bleiben ausgenommen, ⇧↵ ist bewusst frei.
 */
function istNeuerTabTaste(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}) {
  return e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
}

/**
 * Screenreader-only. Die Live-Region steht immer im Baum; die Ansage „Vorschau: …“ braucht sie,
 * aber nicht als zweite sichtbare Überschrift.
 */
const NUR_VORLESEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

interface Props {
  befehle: Befehl[];
  /**
   * Datensatz-Treffer als FERTIGE `Treffer`, nicht als `Befehl`: sie tragen ihre `stufe` selbst
   * (ein exakter Nummerntreffer vor Fuzzy-Rauschen), die aus dem Label nicht zurückzurechnen ist.
   * Sie gehen auch NICHT durch `filtereBefehle`: der ETB-Volltext ist serverseitig entschieden,
   * seine Fundstelle steht oft nicht im Label.
   */
  datensatzTreffer?: Treffer[];
  /**
   * Meldet Modus und Rest ENTPRELLT nach oben. Das Paar statt der rohen Eingabe: das Präfix wird an
   * genau einer Stelle zerlegt.
   */
  onSucheEntprellt?: (modus: PaletteModus, rest: string) => void;
  /**
   * Koordinatensprung: liefert für den LEBENDEN Rest die Zeile „Auf Lagekarte zeigen“, wenn er die
   * Form einer Koordinate hat, sonst `null`. Eine Funktion statt einer fertigen Zeile, weil der
   * entprellte Stand bis zu 300 ms hinterherhinkt. Ohne Prop (außerhalb eines Einsatzes) weder
   * Zeile noch Fußhinweis.
   */
  koordinatenSprung?: (rest: string) => Befehl | null;
  /**
   * Adresszeile (LFH-638): liefert für den LEBENDEN Rest „Adresse auf Lagekarte suchen“, wenn er
   * eine Adresse sein kann, sonst `null`. Steht immer am Ende der Treffer.
   */
  adressSprung?: (rest: string) => Befehl | null;
  /**
   * Kann es hier eine Vorschau geben? Nur im Einsatz. Steuert allein den FUSSHINWEIS; ob eine Zeile
   * eine Vorschau hat, sagt `Befehl.vorschau`.
   */
  vorschauVerfuegbar?: boolean;
  /** Für die Plattformweiche des Kürzels; Vorgabe `navigator.userAgent`. */
  userAgent?: string;
  schliesse: () => void;
}

/** Präsentationale Palette: Suche + gruppierte, tastaturbedienbare Trefferliste. */
export function CommandPalette({
  befehle,
  datensatzTreffer = KEINE_TREFFER,
  onSucheEntprellt,
  koordinatenSprung,
  adressSprung,
  vorschauVerfuegbar = false,
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  schliesse,
}: Props) {
  const { token } = theme.useToken();
  const farben = useModusFarben();
  /**
   * DIE Weiche nach Zeigerart (LFH-982): bei grobem Zeiger Tippwege statt Tastenhinweisen. Der
   * PRIMÄRE Zeiger, nicht die Breite: ein Fükw mit schmalem Fenster hat eine Tastatur. Jede
   * Touch-Abweichung der Palette liest nur diese Konstante.
   */
  const { istBeruehrung } = useViewport();
  const [suche, setSuche] = useState('');
  /**
   * Die Auswahl hängt an der BEFEHLS-ID, nicht am Listenindex: Datensatz-Treffer treffen
   * asynchron ein und stehen oft vor der markierten Zeile; mit einem Index spränge die Markierung
   * ohne Zutun auf eine andere Zeile (WCAG 3.2.5).
   */
  const [aktivId, setAktivId] = useState<string | null>(null);
  /**
   * Die offene Vorschau (Taste →), als BEFEHL statt Id: treffen neue Datensatztreffer ein, darf die
   * gezeigte Person nicht verschwinden. `suche` und `aktivId` bleiben unberührt, damit der Rückweg
   * Begriff und Markierung wiederfindet.
   */
  const [vorschau, setVorschau] = useState<Befehl | null>(null);
  const inputRef = useRef<InputRef>(null);
  /**
   * Letzte Zeigerposition über der Liste. Die Markierung folgt nur einem BEWEGTEN Zeiger: ein
   * ruhender, unter dem die Liste beim Öffnen, Tippen oder Scrollen wegläuft, stähle sonst die
   * Auswahl, und ↵ öffnete die Zeile unter der Maus statt des besten Treffers.
   */
  const zeigerRef = useRef<{ x: number; y: number } | null>(null);

  // Fokus sicherstellen: antd Modal kann den Fokus nach Mount verschieben.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /**
   * Präfixmodus: das Zeichen am Anfang schränkt auf Befehlsgruppen ein, der Rest ist der
   * Suchbegriff. Beides Primitive, damit die `useMemo` darunter an Werten hängen. DIE EINZIGE
   * Aufrufstelle des Parsers; der Modus greift VOR dem Fuzzy-Filter.
   */
  const { modus, rest } = useMemo(() => parsePraefix(suche), [suche]);
  const gefiltertNachModus = useMemo(() => filtereNachModus(befehle, modus), [befehle, modus]);

  // Die Ordnungsgruppe `zuletzt` fällt weg, SOBALD gesucht wird, sonst stünden ihre Einträge neben
  // ihren label-gleichen Modul-Zwillingen. Vor `filtereBefehle`, damit Fuse sie nicht bewertet.
  const imModus = useMemo(
    () => (rest === '' ? gefiltertNachModus : ohneOrdnungsdubletten(gefiltertNachModus)),
    [gefiltertNachModus, rest],
  );

  /**
   * Die anstehenden Datensatz-Treffer gegen den LEBENDEN Stand geprüft: nur die Palette kennt den
   * ungefilterten Eingabestand, der Hook arbeitet entprellt und liefert aus dem warmen Cache weiter.
   * Bedingung und Begründung an `sichtbareDatensaetze`.
   */
  const anstehendeDatensaetze = useMemo(
    () => sichtbareDatensaetze(datensatzTreffer, modus, rest),
    [datensatzTreffer, modus, rest],
  );

  /**
   * Die Kartenzeile nur im Vorgabemodus: hinter einem Präfix ist die Eingabe eine Suche in einer
   * Menge, kein Ort.
   *
   * Stufe 0, aber hinter jedem anderen Stufe-0-Treffer (`UNBEWERTET + 1`): trifft ein Name oder
   * eine Nummer die Eingabe genau, ist der gemeint; vorn wäre die Kartenzeile vorausgewählt und
   * ein Enter flöge die Karte hin.
   */
  const koordinate = useMemo<Treffer | null>(() => {
    if (modus !== 'alles' || !koordinatenSprung) return null;
    const b = koordinatenSprung(rest);
    return b ? { befehl: b, score: UNBEWERTET + 1, stufe: 0 } : null;
  }, [modus, rest, koordinatenSprung]);

  /**
   * Die Adresszeile (LFH-638) nur im Vorgabemodus und immer ZULETZT: schlechteste Stufe, ein Score
   * hinter jedem anderen, die letzte Gruppe. So ist sie nie vorausgewählt — ↵ öffnet weiter den
   * besten Treffer, und nur wer sie wählt, sucht auf der Karte.
   */
  const adresse = useMemo<Treffer | null>(() => {
    if (modus !== 'alles' || !adressSprung) return null;
    const b = adressSprung(rest);
    return b ? { befehl: b, score: UNBEWERTET + 1, stufe: 3 } : null;
  }, [modus, rest, adressSprung]);

  const treffer = useMemo(() => {
    const statisch = filtereBefehle(imModus, rest);
    // Bei LEERER Suche bleiben die Datensatz-Treffer draußen: der entprellte Rest hinkt nach, und
    // die Treffer des vorigen Begriffs erschienen sonst in der kuratierten Startansicht. Die Zeile
    // trennt die zwei Renderzweige.
    if (rest === '') return statisch;
    return [
      ...(koordinate ? [koordinate] : []),
      ...statisch,
      ...anstehendeDatensaetze,
      ...(adresse ? [adresse] : []),
    ];
  }, [imModus, rest, anstehendeDatensaetze, koordinate, adresse]);
  /**
   * Zwei Zustände, zwei Ordnungen: bei LEERER Suche die kuratierte Startansicht
   * (`GRUPPEN_REIHENFOLGE` mit Überschriften), bei AKTIVER Suche flach nach Bewertung. Die
   * Gruppenachse zerstörte dort die Trefferordnung (Fuse-Rauschen einer Schnellaktion vor dem
   * genauen Modultreffer), und eine Überschrift behauptete eine Ordnung, die es nicht gibt.
   */
  // Maßgeblich ist der REST: ein nacktes '>' schränkt ein, sucht aber nicht.
  const sucheAktiv = rest !== '';

  const gruppen = useMemo(() => {
    if (sucheAktiv) return [];
    // Jeder Befehl steht in der Startansicht EINMAL: in der obersten Gruppe, die ihn führt.
    const gesehen = new Set<string>();
    return GRUPPEN_REIHENFOLGE.map((g) => ({
      gruppe: g,
      items: treffer
        .map((t) => t.befehl)
        .filter((b) => {
          if (b.gruppe !== g) return false;
          const kern = kernId(b);
          if (gesehen.has(kern)) return false;
          gesehen.add(kern);
          return true;
        }),
    })).filter((x) => x.items.length > 0);
  }, [treffer, sucheAktiv]);
  // EINZIGE Indexquelle für beide Zweige: `indexVon`, `aria-activedescendant`, `aria-expanded`,
  // der Leerzustand und `aufTaste` lesen nur von hier.
  const flach = useMemo(
    () => (sucheAktiv ? ordneTreffer(treffer, rest) : gruppen.flatMap((x) => x.items)),
    [sucheAktiv, treffer, rest, gruppen],
  );
  const indexVon = useMemo(() => new Map(flach.map((b, i) => [b.id, i])), [flach]);
  // Fällt der markierte Befehl aus der Liste, gilt wieder die erste Zeile (`findIndex` liefert -1).
  const gefunden = aktivId === null ? -1 : flach.findIndex((b) => b.id === aktivId);
  // Die Adresszeile (LFH-638) ist NIE vorausgewählt, auch nicht allein: wer eine Kennung tippt und
  // sofort ↵ drückt, bevor die Datensätze da sind, landete sonst auf der Lagekarte. Sie steht immer
  // zuletzt, an Stelle 0 also nur allein — dann ist nichts markiert (-1), ↵ tut nichts, ↓ wählt sie.
  const vorgabe = flach[0]?.gruppe === 'ortssuche' ? -1 : 0;
  const aktiv = gefunden >= 0 ? gefunden : vorgabe;

  useEffect(() => {
    setAktivId(null);
  }, [suche]);

  /**
   * Die Meldung nach außen wartet, die sichtbare Liste nicht: Text und Fuzzy-Filter über die
   * statischen Befehle reagieren SOFORT, nur die Datenbeschaffung wartet.
   *
   * `clearTimeout` im Abbau: die Palette wird beim Schließen abgehängt. `onSucheEntprellt` steht
   * bewusst NICHT in den Dependencies (Ref): ein je Render neuer Callback setzte die Frist sonst
   * immer zurück, die Meldung ginge nie hinaus.
   */
  const meldeRef = useRef(onSucheEntprellt);
  meldeRef.current = onSucheEntprellt;
  useEffect(() => {
    const frist = setTimeout(() => meldeRef.current?.(modus, rest), ENTPRELLUNG_MS);
    return () => clearTimeout(frist);
  }, [modus, rest]);

  /**
   * Aktiven Eintrag in den Sichtbereich scrollen, auch nach der Rückkehr aus der Vorschau: die
   * Liste kommt mit `scrollTop` 0 zurück, `aktiv` ändert sich dabei aber nicht.
   *
   * Als Callback-Ref an der aktiven Zeile, nicht als Effekt der Palette: antds Modal friert seinen
   * Inhalt während der Einblend-Animation ein (rc-motion rendert die Kinder erst mit dem nächsten
   * Animationsschritt neu). Ein Effekt lief dann, bevor die Liste im DOM stand, und scrollte ins
   * Leere. Der Ref greift in dem Commit, der die Zeile wirklich einhängt. Die Identität wechselt
   * mit `aktiv` und `vorschau`, damit React ihn bei jedem Wechsel erneut ruft.
   */
  const aktiveZeileImBlick = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- die Abhängigkeiten sind der Auslöser
    [aktiv, vorschau],
  );

  function aufZeiger(e: MouseEvent, b: Befehl) {
    const vorher = zeigerRef.current;
    zeigerRef.current = { x: e.clientX, y: e.clientY };
    if (!vorher || (vorher.x === e.clientX && vorher.y === e.clientY)) return;
    if (b.id !== aktiverId) setAktivId(b.id);
  }

  function fuehreAus(b: Befehl | undefined) {
    if (!b) return;
    schliesse();
    b.ausfuehren();
  }

  /**
   * Strg/⌘+↵ und Strg/⌘+Klick: NUR eine Zeile mit `ziel` bekommt `'neuerTab'`. Ohne Ziel
   * geschieht nichts, kein Rückfall auf ↵ (auf „Speichern“ hieße das speichern).
   */
  function oeffneImNeuenTab(b: Befehl | undefined) {
    if (!b?.ziel) return;
    schliesse();
    b.ausfuehren('neuerTab');
  }

  /**
   * Das Tippziel: derselbe Zustand wie nach →. `focus()` holt den Fokus ins Suchfeld zurück, falls
   * er woanders stand, weil ↵ und Esc/← von dort wirken. Auf einem Tablet kann dabei die
   * Bildschirmtastatur erscheinen; die Tastaturwege gehen vor.
   */
  function oeffneVorschau(b: Befehl) {
    setVorschau(b);
    inputRef.current?.focus();
  }

  function zurueckZurListe() {
    setVorschau(null);
    inputRef.current?.focus();
  }

  /**
   * Präfix-Chip (LFH-982): setzt das Präfix vor den Rest und ersetzt dabei ein anderes; der Chip
   * des aktiven Modus nimmt es weg. Der Fokus bleibt im Suchfeld (`mousedown` am Chip abgefangen),
   * `focus()` holt ihn zurück, falls er woanders stand.
   */
  function waehleModus(m: PaletteModus, praefix: string) {
    // Der Begriff aus der ROHEN Eingabe, nicht aus dem getrimmten `rest`: ein Leerzeichen am Ende
    // gehört zum Weitertippen („florian “ → „@florian “ → „@florian m“).
    const aktuell = PALETTE_MODI[modus].praefix ?? '';
    const begriff = suche.trimStart().slice(aktuell.length).trimStart();
    setSuche(m === modus ? begriff : `${praefix}${begriff}`);
    inputRef.current?.focus();
  }

  /**
   * Esc/← aus der Vorschau, an der WURZEL der Palette: mit Fokus auf „Zurück“ käme Esc sonst allein
   * beim globalen Dispatcher an, der die ganze Palette schlösse. `preventDefault` ist tragend, sonst
   * liest der Dispatcher dieselbe Taste als `verwerfen`.
   */
  function aufWurzelTaste(e: KeyboardEvent<HTMLDivElement>) {
    if (!vorschau || e.defaultPrevented || e.nativeEvent.isComposing) return;
    if (e.key === 'Escape' || e.key === 'ArrowLeft') {
      e.preventDefault();
      zurueckZurListe();
    }
  }

  function aufTaste(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    // Strg/⌘+↵ gehört der Palette. Ohne Ziel geschieht NICHTS, und das braucht kein
    // `preventDefault`: der globale Dispatcher schluckt Mutationstasten bei offener Palette selbst
    // (`CommandPaletteProvider`).
    if (istNeuerTabTaste(e)) {
      const b = vorschau ?? flach[aktiv];
      if (b?.ziel) {
        e.preventDefault();
        oeffneImNeuenTab(b);
      }
      return;
    }
    if (vorschau) {
      // In der Vorschau gibt es keine Liste: ↵ öffnet, Pfeile verschieben nichts. Esc/← behandelt die
      // WURZEL (`aufWurzelTaste`); eine Änderung am Begriff verlässt die Vorschau (`onChange`).
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
      } else if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        fuehreAus(vorschau);
      }
      return;
    }
    if (e.key === 'ArrowRight') {
      // Nur am TEXTENDE und ohne Auswahl; mitten im Wort bleibt → die Cursortaste.
      const feld = e.currentTarget;
      const b = flach[aktiv];
      const amEnde =
        feld.selectionStart === feld.value.length && feld.selectionEnd === feld.value.length;
      if (b?.vorschau && amEnde) {
        e.preventDefault();
        setVorschau(b);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flach.length) setAktivId(flach[(aktiv + 1) % flach.length].id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flach.length) setAktivId(flach[(aktiv - 1 + flach.length) % flach.length].id);
    } else if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      fuehreAus(flach[aktiv]);
    }
  }

  const aktiverId = flach[aktiv]?.id;
  const hinweisStil = { display: 'inline-flex', alignItems: 'center', gap: 6 } as const;
  // Gilt für JEDEN Modus, der Datensätze durchsucht, auch für den Vorgabemodus. Ab dem PRÄFIX, nicht
  // erst ab dem Zeichen dahinter: wer '@' tippt, soll nicht „Keine Treffer“ lesen. Im präfixlosen
  // Vorgabemodus bleibt die leere Eingabe die Startansicht.
  const zuKurzFuerDatensaetze =
    rest.length < DATENSATZ_MINDESTZEICHEN &&
    modusZeigtDatensaetze(modus) &&
    (rest.length > 0 || PALETTE_MODI[modus].praefix !== null);
  /**
   * Der Wortlaut des Leerzustands als WERT, nicht als Zweig im JSX: die Region darunter steht
   * dauerhaft, nur ihr Inhalt wechselt.
   */
  const leerText =
    flach.length > 0
      ? ''
      : zuKurzFuerDatensaetze
        ? `Suche ab ${DATENSATZ_MINDESTZEICHEN} Zeichen`
        : 'Keine Treffer';

  /**
   * EINE Zeile für BEIDE Zweige, sonst wären es zwei Orte, an denen der Bedienziel-Boden still
   * verlorengehen kann. Der Boden kommt aus `palettenZeilenStil`.
   */
  function optionsZeile(b: Befehl) {
    const i = indexVon.get(b.id)!;
    const istAktiv = i === aktiv;
    const Icon = b.icon;
    const kontextId = b.kontext ? `cmd-${b.id}-kontext` : undefined;
    const nebenzeileId = b.nebenzeile ? `cmd-${b.id}-nebenzeile` : undefined;
    const beschreibtVon = [nebenzeileId, kontextId].filter(Boolean).join(' ') || undefined;
    return (
      <div
        key={b.id}
        id={`cmd-${b.id}`}
        ref={istAktiv ? aktiveZeileImBlick : undefined}
        role="option"
        aria-selected={istAktiv}
        // Kontext und Nebenzeile BESCHREIBEN, sie benennen nicht (Begründung an `Befehl.kontext`).
        aria-describedby={beschreibtVon}
        onMouseMove={(e: MouseEvent) => aufZeiger(e, b)}
        onClick={(e: MouseEvent) => (e.ctrlKey || e.metaKey ? oeffneImNeuenTab(b) : fuehreAus(b))}
        style={{
          ...palettenZeilenStil(token),
          // Aktive Zeile: Fläche `flaeche3` plus 2-px-Marke in `bedien` links (wie das Modulpanel).
          background: istAktiv ? farben.flaeche3 : 'transparent',
          boxShadow: istAktiv ? `inset 2px 0 0 ${farben.bedien}` : undefined,
          color: farben.text,
        }}
      >
        {/* Die Icon-Spalte steht auch ohne Icon: sonst springt das Label einer Zeile ohne Icon nach links. */}
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            justifyContent: 'center',
            width: 18,
            flexShrink: 0,
            color: istAktiv ? farben.bedien : farben.gedaempft,
          }}
        >
          {Icon && <Icon size={16} />}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            fontSize: schriftskala.text.groesse,
          }}
        >
          <span style={einzeilig}>
            <Fundstellen text={b.label} begriff={b.fundstellen?.begriff} ab={b.fundstellen?.ab} />
          </span>
          {b.nebenzeile && (
            <span
              id={nebenzeileId}
              aria-hidden="true"
              data-lfh="cmd-nebenzeile"
              style={{
                ...einzeilig,
                fontSize: schriftskala.textKlein.groesse,
                color: farben.schwach,
              }}
            >
              {b.nebenzeile}
            </span>
          )}
        </span>
        {b.kontext && (
          <span
            id={kontextId}
            aria-hidden="true"
            style={{
              flexShrink: 0,
              fontSize: schriftskala.textKlein.groesse,
              color: farben.schwach,
              whiteSpace: 'nowrap',
            }}
          >
            {b.kontext}
          </span>
        )}
        {/* Bei grobem Zeiger keine Tastenmarke an der Zeile (LFH-982); ohne Pfeiltasten gibt es
            auch kein Springen, gegen das die reservierte Breite der Enter-Marke hilft. */}
        {b.kuerzel && !istBeruehrung && (
          <Tastenkuerzel style={{ ...tasteStil, color: farben.schwach }}>{b.kuerzel}</Tastenkuerzel>
        )}
        {/* Die Enter-Marke steht NUR an der aktiven Zeile: sie sagt, was Enter gerade auslöst.
            Satz, kein Ziel, deshalb `aria-hidden`. Ihre Breite ist auch an den übrigen Zeilen
            reserviert, sonst rückte der Kontext beim Pfeilen hin und her. */}
        {!b.kuerzel && !istBeruehrung && (
          <Tastenkuerzel
            aria-hidden
            style={{
              ...tasteQuadrat,
              color: farben.schwach,
              visibility: istAktiv ? 'visible' : 'hidden',
            }}
          >
            ↵
          </Tastenkuerzel>
        )}
        {/*
         * DAS VORSCHAU-ZIEL: die zeilengenaue Aussage „hier gibt es eine Vorschau“ und der Weg hinein
         * für Finger und Maus, an JEDER Zeile mit Vorschau (Touch kennt kein Hover).
         *
         * KEIN `Button`: ein fokussierbarer Knopf zöge beim Klick den Fokus aus der Combobox, ↵ und
         * Esc gingen danach ins Leere. Deshalb ein handgebautes Ziel (Boden aus `vorschauZielStil`),
         * `mousedown` abgefangen und `aria-hidden` (der zugängliche Weg ist →). Der Klick endet hier
         * (`stopPropagation`) und öffnet nie zugleich den Datensatz, auch nicht mit Strg/⌘.
         */}
        {b.vorschau && (
          <span
            aria-hidden="true"
            data-lfh="palette-vorschau-ziel"
            title={istBeruehrung ? 'Vorschau' : 'Vorschau (→)'}
            onMouseDown={(e: MouseEvent) => e.preventDefault()}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              oeffneVorschau(b);
            }}
            style={{
              ...vorschauZielStil(token),
              color: istAktiv ? farben.bedien : farben.schwach,
            }}
          >
            <IconChevronRechts size={16} />
          </span>
        )}
      </div>
    );
  }

  return (
    <Modal
      open
      keyboard={false}
      onCancel={schliesse}
      footer={null}
      closable={false}
      width={PALETTE.breite}
      zIndex={2000}
      style={{ top: PALETTE.oben }}
      styles={{
        mask: { background: paletteMaske },
        // Rahmen in Bedienfarbe, keine Rundung. `colorBgElevated` ist `flaeche2` des Modus; nur Kopf
        // und Rail sind modusfest.
        container: {
          padding: 0,
          borderRadius: 0,
          border: `1px solid ${token.colorPrimary}`,
          background: token.colorBgElevated,
        },
        body: { padding: 0 },
      }}
      destroyOnHidden
    >
      {/* Kein Bedienziel und kein Tab-Stopp: nur die Stelle, an der Esc/← aus der Vorschau jeden
          fokussierten Nachfahren erreichen. */}
      <div onKeyDown={aufWurzelTaste}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: token.paddingSM,
            minHeight: PALETTE.kopf,
            paddingInline: token.padding,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <span aria-hidden="true" style={{ display: 'inline-flex', color: token.colorPrimary }}>
            <IconLupe size={18} />
          </span>
          <Input
            ref={inputRef}
            autoFocus
            variant="borderless"
            // Der Platzhalter bleibt BYTE-GLEICH: e2e-Locator greifen das Feld darüber, einer als
            // zugänglichen Namen der Combobox (`gate1-ueberlauf.spec.ts`).
            placeholder="Suchen: Module, Aktionen, Einstellungen …"
            role="combobox"
            // In der Vorschau steht keine Listbox im Baum: kein `aria-controls` ins Leere.
            aria-expanded={!vorschau && flach.length > 0}
            aria-controls={vorschau ? undefined : 'cmd-liste'}
            aria-activedescendant={!vorschau && aktiverId ? `cmd-${aktiverId}` : undefined}
            value={suche}
            onChange={(e) => {
              // Ein geänderter Begriff ist eine neue Suche; die Vorschau gehört zur alten.
              setVorschau(null);
              setSuche(e.target.value);
            }}
            onKeyDown={aufTaste}
            // 16 px: kleiner zoomt iOS beim Fokus die Seite. KEIN eigener Fokusrahmen: die Palette
            // hat genau dieses eine Feld, ihr Rahmen in Bedienfarbe und die Schreibmarke zeigen den
            // Fokus; ein zweiter Kasten in der Kopfzeile wäre Kasten im Kasten.
            style={{ flex: 1, padding: 0, fontSize: 16, outline: 'none', boxShadow: 'none' }}
          />
          {/*
           * Die Modusanzeige: solange ein Präfix steht, nennt sie ihn; ohne sie wäre ein Filter, der
           * die Liste um zwei Drittel kürzt, von einem kaputten nicht zu unterscheiden. Als Marke im
           * Kopf, nicht als eigene Zeile darunter: die Liste rückt beim Tippen von '>' nicht.
           */}
          {modus !== 'alles' && (
            <span
              data-lfh="palette-modus"
              style={{
                flexShrink: 0,
                padding: `0 ${token.paddingXS}px`,
                lineHeight: 1.6,
                fontSize: schriftskala.textKlein.groesse,
                color: farben.bedienText,
                background: farben.bedienFlaeche,
                whiteSpace: 'nowrap',
              }}
            >
              {PALETTE_MODI[modus].hinweis}
            </span>
          )}
          {/*
           * Bei grobem Zeiger ein ECHTER Schließknopf statt der Esc-Marke (LFH-982): die Marke sähe
           * wie ein Knopf aus und täte auf Touch nichts. In der Kopfzeile statt antds Schließkreuz,
           * das absolut über dem Suchfeld säße; Boden 48, wächst mit der Staffel.
           */}
          {istBeruehrung ? (
            <Button
              type="text"
              aria-label="Sprungpalette schließen"
              icon={<IconKreuz size={18} />}
              onClick={schliesse}
              style={{
                flexShrink: 0,
                width: schliessKnopfMass(token),
                height: schliessKnopfMass(token),
                minWidth: schliessKnopfMass(token),
                color: farben.gedaempft,
              }}
            />
          ) : (
            <Tastenkuerzel aria-hidden style={{ ...tasteStil, color: farben.schwach }}>
              Esc
            </Tastenkuerzel>
          )}
        </div>
        {vorschau?.vorschau ? (
          // DIE VORSCHAU (Taste →) ersetzt die Liste: 640 px tragen Liste und Lese-Ansicht nicht
          // nebeneinander. Der Fokus bleibt im Suchfeld. Nur LESEN, dasselbe Bauteil wie der
          // Personen-Drawer; „Zurück“ ist ein antd-`Button` und erbt `controlHeight`.
          // Ein VERWEIS in der Vorschau schließt die Palette: der Riegel lauscht am Container in der
          // Bubble-Phase, NACH dem `onClick` des Links, und gilt so für jede Sorte. Ohne ihn wechselte die
          // App unter der offenen Palette die Seite. Ein Modifier-Klick schließt ebenfalls.
          <div
            role="region"
            aria-label={`Vorschau: ${vorschau.label}`}
            data-lfh="palette-vorschau"
            onClick={(e: MouseEvent<HTMLDivElement>) => {
              if (e.target instanceof Element && e.target.closest('a[href]')) schliesse();
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: token.paddingSM,
                padding: `${token.paddingXS}px ${token.padding}px`,
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <Button type="text" icon={<IconPfeilLinks />} onClick={zurueckZurListe}>
                Zurück
              </Button>
              <span style={{ flex: 1, minWidth: 0, fontSize: schriftskala.text.groesse }}>
                <Fundstellen
                  text={vorschau.label}
                  begriff={vorschau.fundstellen?.begriff}
                  ab={vorschau.fundstellen?.ab}
                />
              </span>
              {vorschau.kontext && (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: schriftskala.textKlein.groesse,
                    color: farben.schwach,
                  }}
                >
                  {vorschau.kontext}
                </span>
              )}
            </div>
            <div
              style={{
                // Derselbe Deckel wie die Liste: die Palette wechselt beim → nicht ihre Höhe.
                maxHeight: 'min(60vh, 480px)',
                overflowY: 'auto',
                padding: token.padding,
              }}
            >
              <Vorschau ziel={vorschau.vorschau} />
            </div>
          </div>
        ) : (
          <div
            id="cmd-liste"
            role="listbox"
            // `min(60vh, 480px)`: zeigt am Fükw-Schirm genug Befehle, `60vh` deckelt auf niedrigen Schirmen.
            style={{
              maxHeight: 'min(60vh, 480px)',
              overflowY: 'auto',
              padding: token.paddingXS,
            }}
          >
            {sucheAktiv && flach.map((b) => optionsZeile(b))}
            {gruppen.map((x) => (
              <div key={x.gruppe} role="group" aria-label={GRUPPEN_LABEL[x.gruppe]}>
                {/* Gruppen-Augenbraue (10/600/.14em, Versalien) — `schriftskala.augenbraue`. */}
                <div
                  style={{
                    ...augenbraueStil(farben.schwach),
                    // Bündig mit der Icon-Spalte der Zeilen; Luft nach oben trennt die Gruppen, die
                    // Überschrift sitzt dicht über ihrer ersten Zeile.
                    padding: `${token.paddingSM + token.paddingXS}px ${token.paddingSM}px ${token.paddingXXS}px`,
                  }}
                >
                  {GRUPPEN_LABEL[x.gruppe]}
                </div>
                {x.items.map((b) => optionsZeile(b))}
              </div>
            ))}
          </div>
        )}
        {/*
         * Zwei Leerzustände: wer '@a' tippt, sieht per Konstruktion nichts (Datensatz-Abrufe laufen
         * erst ab zwei Zeichen); ein stummes „Keine Treffer“ wäre dort von „kaputt“ nicht zu
         * unterscheiden.
         *
         * DIE REGION STEHT IMMER, auch wenn sie schweigt: `aria-live` meldet nur Änderungen an bereits
         * vorhandenem Inhalt. Außerhalb der Listbox (deren Kinder sind Optionen). Kein Bedienziel.
         */}
        <div
          data-lfh="palette-leerzustand"
          aria-live="polite"
          style={
            vorschau
              ? NUR_VORLESEN
              : { padding: leerText ? token.padding : 0, color: token.colorTextSecondary }
          }
        >
          {/* In der Vorschau sagt dieselbe Region an, WO man ist; der Fokus bleibt im Suchfeld. */}
          {vorschau
            ? `Vorschau: ${vorschau.label}. ${istBeruehrung ? '„Zurück“ führt zur Liste.' : 'Escape führt zurück.'}`
            : leerText}
        </div>
        {/*
         * FUSSZEILE: nur Hinweise, die wirklich funktionieren — und die hängen an der ZEIGERART
         * (LFH-982, `command-palette/AGENTS.md`, „Zeigerart“).
         *
         * Feiner Zeiger: Enter, die drei Präfixe aus `PALETTE_MODI` (eine Quelle); ⇧↵ ist frei:
         * Strg/⌘+↵ öffnet im neuen Tab, → zeigt die Vorschau. In der Vorschau stehen die drei
         * gültigen Wege. Grober Zeiger: keine Taste; in der Liste die Präfixe als Chips, in der
         * Vorschau „Öffnen“ (der Tippweg für ↵; zurück führt „Zurück“ im Vorschaukopf).
         *
         * Die Hinweise stehen STATISCH: ein je Zeile wechselnder Hinweis änderte die Zeilenzahl der
         * umbrechenden Fußzeile, die Palette spränge beim Pfeilen. Die Touch-Fußzeile bricht nie
         * um (eine Reihe Knöpfe gleicher Höhe in Liste und Vorschau), zu schmal scrollt sie.
         */}
        {istBeruehrung ? (
          <div
            data-lfh="palette-fuss"
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'nowrap',
              gap: token.paddingXS,
              overflowX: 'auto',
              padding: `${token.paddingXS}px ${token.paddingSM}px`,
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              fontFamily: schrift.text,
              fontSize: schriftskala.textKlein.groesse,
            }}
          >
            {vorschau ? (
              <Button type="primary" onClick={() => fuehreAus(vorschau)}>
                Öffnen
              </Button>
            ) : (
              modiMitPraefix().map((m) => (
                <Button
                  key={m.modus}
                  aria-pressed={m.modus === modus}
                  // Das Suchfeld behält den Fokus: sonst klappte die Bildschirmtastatur zu und auf.
                  onMouseDown={(e: MouseEvent) => e.preventDefault()}
                  onClick={() => waehleModus(m.modus, m.praefix)}
                  // Schmalere Seitenpolsterung als antds Knopf: so stehen die drei Chips bei 390 px
                  // in einer Zeile (gemessen, `e2e/command-palette.spec.ts`).
                  style={{
                    flexShrink: 0,
                    paddingInline: token.paddingSM,
                    background: m.modus === modus ? farben.bedienFlaeche : undefined,
                    color: m.modus === modus ? farben.bedienText : undefined,
                  }}
                >
                  <span aria-hidden="true" style={{ fontFamily: schrift.zahl }}>
                    {m.praefix}
                  </span>{' '}
                  {m.kurz}
                </Button>
              ))
            )}
          </div>
        ) : (
          <div
            data-lfh="palette-fuss"
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              columnGap: 12,
              rowGap: 4,
              padding: '6px 16px',
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              fontFamily: schrift.text,
              fontSize: schriftskala.textKlein.groesse,
              color: farben.schwach,
            }}
          >
            <span style={hinweisStil}>
              <Tastenkuerzel style={tasteQuadrat}>↵</Tastenkuerzel>
              öffnen
            </span>
            <span style={hinweisStil}>
              <Tastenkuerzel style={tasteStil}>{neuerTabKuerzel(userAgent)}</Tastenkuerzel>
              neuer Tab
            </span>
            {vorschau ? (
              <span style={hinweisStil}>
                <Tastenkuerzel style={tasteStil}>Esc</Tastenkuerzel>
                zurück
              </span>
            ) : (
              <>
                {vorschauVerfuegbar && (
                  <span style={hinweisStil}>
                    <Tastenkuerzel style={tasteQuadrat}>→</Tastenkuerzel>
                    Vorschau
                  </span>
                )}
                {/* Die Präfixe als eigene Gruppe rechts: sie filtern, die übrigen Tasten handeln. */}
                <span style={{ ...hinweisStil, gap: 12, marginInlineStart: 'auto' }}>
                  {modiMitPraefix().map((m) => (
                    <span key={m.modus} style={hinweisStil}>
                      <Tastenkuerzel style={tasteQuadrat}>{m.praefix}</Tastenkuerzel>
                      {m.kurz}
                    </span>
                  ))}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
