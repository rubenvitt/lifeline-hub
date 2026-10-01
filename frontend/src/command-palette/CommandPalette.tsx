import { IkoneChevronRechts, IkoneLupe, IkonePfeilLinks } from '../ikonen';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Button, Modal, Input, theme, type InputRef } from 'antd';
import { augenbraueStil, useModusFarben } from '../components/rahmenStil';
import Tastenkuerzel from '../components/Tastenkuerzel';
import { schrift } from '../theme/tokens';
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
import { palettenZeilenStil, vorschauZielStil } from './zeilenStil';

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

/**
 * Die abgedunkelte Maske hinter der Palette. Kein Rollenwert: in beiden Modi dieselbe
 * Abdunkelung, die Palette ist ein Fokusmoment, kein Farbträger.
 */
const MASKE = 'rgba(5, 6, 8, 0.72)';

/** EIN Leer-Array statt eines Vorgabewerts im Kopf: ein `[]` dort wäre je Render eine neue
 *  Identität und machte die `useMemo` darunter wirkungslos. */
const KEINE_TREFFER: Treffer[] = [];

/**
 * Das Kürzel „neuer Tab“ als Marke, in derselben Schreibweise wie das Speichern-Kürzel in
 * `TASTATUR_AKTIONEN`.
 */
function neuerTabKuerzel(userAgent: string): string {
  return istApplePlattform(userAgent) ? '⌘ ↵' : 'Strg + ↵';
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
  const listeRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputRef>(null);

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

  const gruppen = useMemo(
    () =>
      sucheAktiv
        ? []
        : GRUPPEN_REIHENFOLGE.map((g) => ({
            gruppe: g,
            items: treffer.map((t) => t.befehl).filter((b) => b.gruppe === g),
          })).filter((x) => x.items.length > 0),
    [treffer, sucheAktiv],
  );
  // EINZIGE Indexquelle für beide Zweige: `indexVon`, `aria-activedescendant`, `aria-expanded`,
  // der Leerzustand und `aufTaste` lesen nur von hier.
  const flach = useMemo(
    () => (sucheAktiv ? ordneTreffer(treffer, rest) : gruppen.flatMap((x) => x.items)),
    [sucheAktiv, treffer, rest, gruppen],
  );
  const indexVon = useMemo(() => new Map(flach.map((b, i) => [b.id, i])), [flach]);
  // Fällt der markierte Befehl aus der Liste, gilt wieder die erste Zeile (`findIndex` liefert -1).
  const gefunden = aktivId === null ? -1 : flach.findIndex((b) => b.id === aktivId);
  const aktiv = gefunden >= 0 ? gefunden : 0;

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

  // Aktiven Eintrag in den Sichtbereich scrollen, auch nach der Rückkehr aus der Vorschau: die
  // Liste kommt mit `scrollTop` 0 zurück, `aktiv` ändert sich dabei aber nicht.
  useEffect(() => {
    const el = listeRef.current?.querySelector('[aria-selected="true"]');
    if (el instanceof HTMLElement && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [aktiv, vorschau]);

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
  const hinweisStil = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: token.marginXS,
  } as const;
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
        ? `Mindestens ${DATENSATZ_MINDESTZEICHEN} Zeichen für die Datensatzsuche`
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
    return (
      <div
        key={b.id}
        id={`cmd-${b.id}`}
        role="option"
        aria-selected={istAktiv}
        // Der Kontext BESCHREIBT, er benennt nicht (Begründung an `Befehl.kontext`).
        aria-describedby={kontextId}
        onMouseEnter={() => setAktivId(b.id)}
        onClick={(e: MouseEvent) => (e.ctrlKey || e.metaKey ? oeffneImNeuenTab(b) : fuehreAus(b))}
        style={{
          ...palettenZeilenStil(token),
          // Aktive Zeile: Grund `flaeche3`, Ikone in Bedienfarbe. Der Text bleibt `text`; die Auswahl
          // trägt die Fläche plus `aria-selected`.
          background: istAktiv ? farben.flaeche3 : 'transparent',
          color: token.colorText,
        }}
      >
        {Icon && (
          <span
            aria-hidden="true"
            style={{
              display: 'inline-flex',
              flexShrink: 0,
              color: istAktiv ? token.colorPrimary : farben.schwach,
            }}
          >
            <Icon size={16} />
          </span>
        )}
        <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{b.label}</span>
        {b.kontext && (
          <span
            id={kontextId}
            aria-hidden="true"
            style={{ flexShrink: 0, fontSize: 11, color: farben.schwach, whiteSpace: 'nowrap' }}
          >
            {b.kontext}
          </span>
        )}
        {b.kuerzel && <Tastenkuerzel>{b.kuerzel}</Tastenkuerzel>}
        {/* Die Enter-Marke steht NUR an der aktiven Zeile: sie sagt, was Enter gerade auslöst.
            Satz, kein Ziel, deshalb `aria-hidden`. */}
        {istAktiv && !b.kuerzel && (
          <Tastenkuerzel aria-hidden style={{ color: farben.schwach }}>
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
            title="Vorschau (→)"
            onMouseDown={(e: MouseEvent) => e.preventDefault()}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              oeffneVorschau(b);
            }}
            style={{
              ...vorschauZielStil(token),
              color: istAktiv ? token.colorPrimary : farben.schwach,
            }}
          >
            <IkoneChevronRechts size={16} />
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
        mask: { background: MASKE },
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
            <IkoneLupe size={18} />
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
            style={{ flex: 1, padding: 0, fontSize: 16 }}
          />
          <Tastenkuerzel aria-hidden style={{ color: farben.schwach }}>
            ESC
          </Tastenkuerzel>
        </div>
        {/*
         * Die Modusanzeige: solange ein Präfix steht, nennt sie ihn; ohne sie wäre ein Filter, der die
         * Liste um zwei Drittel kürzt, von einem kaputten nicht zu unterscheiden. Die Legende steht in
         * der Fußzeile. Der Tastaturvertrag steht in Steuer- und Fußzeile, NICHT im Platzhalter.
         * Satz, kein Ziel, also kein `controlHeight`-Boden.
         */}
        {modus !== 'alles' && (
          <div
            data-lfh="palette-modus"
            style={{
              padding: `${token.paddingXS}px ${token.padding}px`,
              fontSize: token.fontSizeSM,
              color: token.colorTextSecondary,
            }}
          >
            {PALETTE_MODI[modus].hinweis}
          </div>
        )}
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
              <Button type="text" icon={<IkonePfeilLinks />} onClick={zurueckZurListe}>
                Zurück
              </Button>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{vorschau.label}</span>
              {vorschau.kontext && (
                <span style={{ flexShrink: 0, fontSize: 11, color: farben.schwach }}>
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
            ref={listeRef}
            // `min(60vh, 480px)`: zeigt am Fükw-Schirm genug Befehle, `60vh` deckelt auf niedrigen Schirmen.
            style={{
              maxHeight: 'min(60vh, 480px)',
              overflowY: 'auto',
              paddingBlock: token.paddingXS,
            }}
          >
            {sucheAktiv && flach.map((b) => optionsZeile(b))}
            {gruppen.map((x) => (
              <div key={x.gruppe} role="group" aria-label={GRUPPEN_LABEL[x.gruppe]}>
                {/* Gruppen-Augenbraue (10/600/.14em, Versalien) — `schriftskala.augenbraue`. */}
                <div
                  style={{
                    ...augenbraueStil(farben.schwach),
                    padding: `${token.paddingSM}px ${token.padding}px ${token.paddingXS}px`,
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
          {vorschau ? `Vorschau: ${vorschau.label}. Escape führt zurück.` : leerText}
        </div>
        {/*
         * FUSSZEILE: nur Hinweise, die wirklich funktionieren. Enter, die drei Präfixe aus
         * `PALETTE_MODI` (eine Quelle) und, wo es einen Sprung gibt, die Koordinate (erkannt an ihrer
         * Form, ohne Zeichen; `#` bleibt das ETB-Präfix). ⇧↵ ist frei: Strg/⌘+↵ öffnet im neuen Tab, →
         * zeigt die Vorschau.
         *
         * Die Hinweise stehen STATISCH: ein je Zeile wechselnder Hinweis änderte die Zeilenzahl der
         * umbrechenden Fußzeile, die Palette spränge beim Pfeilen. In der Vorschau stehen die drei
         * gültigen Wege.
         */}
        <div
          data-lfh="palette-fuss"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            columnGap: token.margin,
            rowGap: token.paddingXS,
            padding: `${token.paddingSM}px ${token.padding}px`,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            fontFamily: schrift.zahl,
            fontSize: 10,
            color: farben.schwach,
          }}
        >
          <span style={hinweisStil}>
            <Tastenkuerzel>↵</Tastenkuerzel>
            öffnen
          </span>
          <span style={hinweisStil}>
            <Tastenkuerzel>{neuerTabKuerzel(userAgent)}</Tastenkuerzel>
            neuer Tab
          </span>
          {vorschau ? (
            <span style={hinweisStil}>
              <Tastenkuerzel>Esc</Tastenkuerzel>
              zurück
            </span>
          ) : (
            <>
              {vorschauVerfuegbar && (
                <span style={hinweisStil}>
                  <Tastenkuerzel>→</Tastenkuerzel>
                  Vorschau
                </span>
              )}
              {modiMitPraefix().map((m) => (
                // Das Präfixzeichen als Marke: JSX verschluckt den Umbruch zwischen zwei Elementen, deshalb
                // die Flex-Zeile mit `gap`.
                <span key={m.modus} style={hinweisStil}>
                  <Tastenkuerzel>{m.praefix}</Tastenkuerzel>
                  {m.legende}
                </span>
              ))}
              {koordinatenSprung && <span>Koordinate → Lagekarte</span>}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
