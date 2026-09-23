// frontend/src/command-palette/CommandPalette.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Button, Modal, Input, theme, type InputRef } from 'antd';
import { TbArrowLeft, TbSearch } from 'react-icons/tb';
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
import { palettenZeilenStil } from './zeilenStil';

/**
 * Frist der Meldung nach aussen. Wert und Bauform wörtlich aus `etb/EtbFilterleiste.tsx`
 * (Befund M80) — ein zweiter Entprellungsmechanismus wäre eine zweite Wahrheit.
 */
const ENTPRELLUNG_MS = 300;

/**
 * Maß der Sprungpalette nach dem Neuentwurf (S2-Overlay): 640 breit, 120 px von oben, Kopf
 * 52 px. Layoutmaße, keine Trefflächen — die Zeilen tragen ihren Boden über
 * `palettenZeilenStil` aus der Dichte-Staffel.
 */
const PALETTE = { breite: 640, oben: 120, kopf: 52 } as const;

/**
 * Die abgedunkelte Maske hinter der Palette (Entwurf: `rgba(5,6,8,.72)`). Kein Rollenwert:
 * sie ist in beiden Modi dieselbe Abdunkelung — die Palette ist ein Fokusmoment, kein
 * Farbträger. Deshalb hier als Wert und nicht als Farbrolle in `theme/`.
 */
const MASKE = 'rgba(5, 6, 8, 0.72)';

/** EIN Leer-Array statt eines Vorgabewerts im Kopf: ein `[]` dort wäre je Render eine neue
 *  Identität und machte die `useMemo` darunter wirkungslos. */
const KEINE_TREFFER: Treffer[] = [];

/**
 * Das Kürzel „neuer Tab" als Marke — dieselbe Schreibweise wie das Speichern-Kürzel in
 * `TASTATUR_AKTIONEN` („⌘ ↵" / „Strg + ↵"), damit ein Kürzel nicht zweimal verschieden
 * aussieht.
 */
function neuerTabKuerzel(userAgent: string): string {
  return istApplePlattform(userAgent) ? '⌘ ↵' : 'Strg + ↵';
}

/**
 * Strg/⌘+↵ (LFH-645). Beide Modifier gelten auf JEDER Plattform: Strg+↵ auf dem Mac ist
 * keine andere Bedienung, die man abfangen müsste, und `tastaturAktionFuerEreignis` liest
 * `speichern` genauso aus beiden. Shift/Alt bleiben ausgenommen — ⇧↵ ist bewusst frei.
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
 * Sichtbar versteckt (Screenreader-only). Die Live-Region der Palette steht immer im Baum;
 * die Ansage „Vorschau: …" braucht sie, aber nicht als zweite sichtbare Überschrift über
 * der Vorschau, die ihren Namen schon im Kopf trägt.
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
   * Datensatz-Treffer als FERTIGE `Treffer`, nicht als `Befehl` (LFH-391 · C3).
   *
   * Sie tragen ihre `stufe` selbst — die Achse, auf der ein exakter Nummerntreffer vor
   * Fuzzy-Rauschen steht. Aus einem Label ist sie nicht zurückzurechnen („Personen · R-042 ·
   * Müller" liefert für '42' Stufe 3), ein Umweg über die `befehle`-Prop verlöre sie also
   * still. Sie gehen deshalb auch NICHT durch `filtereBefehle`: der ETB-Volltext ist
   * serverseitig entschieden, seine Fundstelle steht regelmässig in `veranlassung` und damit
   * gar nicht im Label — Fuse würfe einen bestätigten Treffer weg.
   */
  datensatzTreffer?: Treffer[];
  /**
   * Meldet Modus und Rest ENTPRELLT nach oben. Das Paar, nicht die rohe Eingabe: das Präfix
   * wird an genau einer Stelle zerlegt, ein zweiter Parser im Aufrufer wäre eine zweite
   * Wahrheit darüber, was „der Suchbegriff" ist.
   */
  onSucheEntprellt?: (modus: PaletteModus, rest: string) => void;
  /**
   * Koordinatensprung (LFH-619): liefert für den LEBENDEN Rest die Zeile „Auf Lagekarte
   * zeigen", wenn er die Form einer Koordinate hat — sonst `null`.
   *
   * Eine Funktion und keine fertige Zeile, weil der entprellte Stand der Eingabe um bis zu
   * 300 ms hinterherhinkt: nach dem Löschen einer Ziffer stünde sonst noch ein Punkt da, den
   * niemand mehr meint. Fehlt die Prop (ausserhalb eines Einsatzes), gibt es weder Zeile
   * noch Fußhinweis.
   */
  koordinatenSprung?: (rest: string) => Befehl | null;
  /**
   * Kann es hier eine Vorschau geben (LFH-645)? Nur im Einsatz — ausserhalb gibt es keine
   * Datensätze. Steuert allein den FUSSHINWEIS; ob eine Zeile eine Vorschau hat, sagt die
   * Zeile selbst (`Befehl.vorschau`) und ihre →-Marke.
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
  vorschauVerfuegbar = false,
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  schliesse,
}: Props) {
  const { token } = theme.useToken();
  const farben = useModusFarben();
  const [suche, setSuche] = useState('');
  /**
   * Die Auswahl hängt an der BEFEHLS-ID, nicht am Listenindex (LFH-391 · C3).
   *
   * Datensatz-Treffer treffen asynchron ein (300 ms Entprellung plus Netz) und stehen als
   * Nummerntreffer auf Stufe 0 vor jedem Modultreffer — die markierte Zeile rückt unter dem
   * Cursor nach unten. Mit einem Index markierte die Palette danach eine andere Zeile, ohne
   * dass jemand etwas gedrückt hat: derselbe Vertrag wie „Live-Updates springen nicht unter
   * dem Cursor" (WCAG 3.2.5).
   */
  const [aktivId, setAktivId] = useState<string | null>(null);
  /**
   * Die offene Vorschau (LFH-645, Taste →) — als BEFEHL, nicht als Id: treffen während der
   * offenen Vorschau neue Datensatztreffer ein, darf die gezeigte Person nicht verschwinden,
   * nur weil ihre Zeile aus `flach` gefallen ist. `suche` und `aktivId` bleiben unberührt,
   * damit der Rückweg Begriff und Markierung wiederfindet.
   */
  const [vorschau, setVorschau] = useState<Befehl | null>(null);
  const listeRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputRef>(null);

  // Fokus sicherstellen: antd Modal kann den Fokus nach Mount verschieben.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /**
   * Präfixmodus (LFH-391 · A4): das Zeichen am Anfang schränkt auf Befehlsgruppen ein, der
   * Rest ist der eigentliche Suchbegriff. Beides sind Primitive — die `useMemo` darunter
   * hängen damit an Werten statt an einer je Anschlag neuen Objektidentität.
   *
   * DIE EINZIGE Aufrufstelle des Parsers. Der Modus greift VOR dem Fuzzy-Filter: Fuse
   * bewertete sonst Befehle mit, die der Modus ohnehin verwirft.
   */
  const { modus, rest } = useMemo(() => parsePraefix(suche), [suche]);
  const gefiltertNachModus = useMemo(() => filtereNachModus(befehle, modus), [befehle, modus]);

  // Die Ordnungsgruppe `zuletzt` fällt weg, SOBALD gesucht wird — sonst stünden ihre
  // Einträge flach neben ihren label-gleichen Modul-Zwillingen. Vor `filtereBefehle`, damit
  // Fuse nicht über Befehle bewertet, die ohnehin niemand sieht.
  const imModus = useMemo(
    () => (rest === '' ? gefiltertNachModus : ohneOrdnungsdubletten(gefiltertNachModus)),
    [gefiltertNachModus, rest],
  );

  /**
   * Die anstehenden Datensatz-Treffer gegen den LEBENDEN Stand geprüft, nicht gegen den, aus
   * dem sie gebaut wurden (Review-Befunde 4, 5 und 6 zu Etappe C).
   *
   * Der Riegel gehört hierher, weil nur die Palette den ungefilterten Eingabestand kennt: der
   * Hook darunter arbeitet auf dem ENTPRELLTEN Paar und liefert zusätzlich aus dem warmen
   * Cache weiter, wenn seine Queries längst abgeschaltet sind. Beide Wege sind gemessen —
   * Begründung und Bedingung stehen an `sichtbareDatensaetze`, damit Abruf und Anzeige nicht
   * zwei Meinungen darüber haben, was gerade gefragt ist.
   */
  const anstehendeDatensaetze = useMemo(
    () => sichtbareDatensaetze(datensatzTreffer, modus, rest),
    [datensatzTreffer, modus, rest],
  );

  /**
   * Die Kartenzeile nur im Vorgabemodus: hinter einem Präfix ist die Eingabe eine Suche in
   * einer bestimmten Menge (ETB, Kräfte, Aktionen), kein Ort.
   *
   * Stufe 0, aber ein Score HINTER jedem anderen Stufe-0-Treffer (Review-Befund zu LFH-619):
   * steht ein Datensatz oder Befehl da, dessen Name oder Nummer die Eingabe genau trifft,
   * meint die Eingabe ihn. Vor allem Übrigen steht die Kartenzeile und ist dann
   * vorausgewählt — ein Enter, und die Karte fliegt hin. `UNBEWERTET + 1` ist strikt
   * schlechter als jeder Fuse-Score und als jeder unbewertete Datensatztreffer.
   */
  const koordinate = useMemo<Treffer | null>(() => {
    if (modus !== 'alles' || !koordinatenSprung) return null;
    const b = koordinatenSprung(rest);
    return b ? { befehl: b, score: UNBEWERTET + 1, stufe: 0 } : null;
  }, [modus, rest, koordinatenSprung]);

  const treffer = useMemo(() => {
    const statisch = filtereBefehle(imModus, rest);
    // Bei LEERER Suche bleiben die Datensatz-Treffer draussen, und das ist kein Sonderfall
    // ohne Fall: der entprellte Rest hinkt der Eingabe um bis zu 300 ms hinterher. Wer das
    // Feld leert, sieht sofort wieder die Startansicht — die Treffer des vorigen Begriffs
    // stehen dann noch an und erschienen im Gruppenzweig als „Datensätze"-Gruppe. Die
    // Startansicht ist per Vertrag kuratiert (LFH-337 · M11), nicht eine Datenhalde.
    // (Der Riegel darüber deckt diesen Fall mit ab — die Zeile bleibt trotzdem stehen: sie
    // trennt die zwei RENDERZWEIGE, nicht die Trefferquelle.)
    if (rest === '') return statisch;
    return [...(koordinate ? [koordinate] : []), ...statisch, ...anstehendeDatensaetze];
  }, [imModus, rest, anstehendeDatensaetze, koordinate]);
  /**
   * Zwei Zustände, zwei Ordnungen (LFH-391 · A3):
   *
   * Bei LEERER Suche gilt die kuratierte Startansicht aus LFH-337 · M11 —
   * `GRUPPEN_REIHENFOLGE` mit Überschriften, „das Nützlichste zuerst".
   *
   * Bei AKTIVER Suche ordnet die Bewertung, flach und gruppenübergreifend. Die Gruppenachse
   * zerstörte hier die Trefferordnung: gemessen an fuse.js 7.5.0 stand für 'etb' die
   * Schnellaktion „Neue Person erfassen" (Score 5.77e-1, reines Rauschen) vor dem genauen
   * Modultreffer (8.60e-9), weil `schnellaktionen` vor `module` steht. Und eine
   * Gruppenüberschrift über einer score-sortierten Liste behauptete eine Ordnung, die es
   * dann nicht mehr gibt.
   */
  // Massgeblich ist der REST, nicht die rohe Eingabe: ein nacktes '>' schränkt ein, sucht
  // aber nicht — dort gilt weiterhin die kuratierte Startansicht, nur mit weniger Gruppen.
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
  // EINZIGE Indexquelle für beide Zweige: `indexVon`, `aria-activedescendant`,
  // `aria-expanded`, der Leerzustand und `aufTaste` lesen ausschliesslich von hier.
  const flach = useMemo(
    () => (sucheAktiv ? ordneTreffer(treffer, rest) : gruppen.flatMap((x) => x.items)),
    [sucheAktiv, treffer, rest, gruppen],
  );
  const indexVon = useMemo(() => new Map(flach.map((b, i) => [b.id, i])), [flach]);
  // Fällt der markierte Befehl aus der Liste (neuer Begriff, fremde Änderung), gilt wieder
  // die erste Zeile — `findIndex` liefert dann -1, und -1 wäre `flach[-1] === undefined`.
  const gefunden = aktivId === null ? -1 : flach.findIndex((b) => b.id === aktivId);
  const aktiv = gefunden >= 0 ? gefunden : 0;

  useEffect(() => {
    setAktivId(null);
  }, [suche]);

  /**
   * Die Meldung nach aussen wartet, die sichtbare Liste nicht (LFH-391 · C3).
   *
   * Nur an dieser Stelle sind die zwei Achsen unterscheidbar: der getippte Text und der
   * Fuzzy-Filter über die ~42 statischen Befehle kosten nichts und müssen SOFORT reagieren
   * — hinge die Anzeige an der Frist, sähe die Bedienung aus wie ein hängendes Feld. Nur
   * die Datenbeschaffung wartet; ein Wort tippen erzeugt damit EINEN Abruf-Stoss, nicht
   * fünf.
   *
   * `clearTimeout` im Abbau (Bauform `EtbFilterleiste.tsx`): die Palette wird beim
   * Schliessen abgehängt, ein Nachläufer meldete danach in einen geräumten Baum.
   * `onSucheEntprellt` steht bewusst NICHT in den Dependencies — ein je Render frisch
   * gebauter Callback des Aufrufers setzte die Frist sonst bei jedem Render zurück, und
   * die Meldung ginge nie hinaus.
   */
  const meldeRef = useRef(onSucheEntprellt);
  meldeRef.current = onSucheEntprellt;
  useEffect(() => {
    const frist = setTimeout(() => meldeRef.current?.(modus, rest), ENTPRELLUNG_MS);
    return () => clearTimeout(frist);
  }, [modus, rest]);

  // aktiven Eintrag in den Sichtbereich scrollen
  useEffect(() => {
    const el = listeRef.current?.querySelector('[aria-selected="true"]');
    if (el instanceof HTMLElement && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [aktiv]);

  function fuehreAus(b: Befehl | undefined) {
    if (!b) return;
    schliesse();
    b.ausfuehren();
  }

  /**
   * Strg/⌘+↵ und Strg/⌘+Klick (LFH-645): NUR eine Zeile mit `ziel` bekommt `'neuerTab'`. Ohne
   * Ziel geschieht nichts — kein Rückfall auf ↵: ein Modifier, der still die Grundaktion
   * auslöst, lügt, und auf „Speichern" hiesse das speichern.
   */
  function oeffneImNeuenTab(b: Befehl | undefined) {
    if (!b?.ziel) return;
    schliesse();
    b.ausfuehren('neuerTab');
  }

  function zurueckZurListe() {
    setVorschau(null);
    inputRef.current?.focus();
  }

  function aufTaste(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    // Strg/⌘+↵ gehört der Palette. Ohne Ziel geschieht NICHTS, und das braucht kein
    // `preventDefault`: der globale Dispatcher schluckt Mutationstasten bei offener Palette
    // selbst (`offen`-Zweig in `CommandPaletteProvider`) — gemessen, die Seite darunter
    // speichert auch ohne Abfangen hier nicht.
    if (istNeuerTabTaste(e)) {
      const b = vorschau ?? flach[aktiv];
      if (b?.ziel) {
        e.preventDefault();
        oeffneImNeuenTab(b);
      }
      return;
    }
    if (vorschau) {
      // In der Vorschau gibt es keine Liste: Esc/← führen zurück, ↵ öffnet. Esc MUSS
      // `preventDefault` rufen — sonst schlösse der globale `verwerfen` die Palette gleich
      // mit, statt eine Ebene zurückzugehen. Pfeil hoch/runter verschieben nichts, was man
      // nicht sieht; alle übrigen Tasten gehen ans Feld, und eine Änderung am Begriff
      // verlässt die Vorschau (`onChange`).
      if (e.key === 'Escape' || e.key === 'ArrowLeft') {
        e.preventDefault();
        zurueckZurListe();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
      } else if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        fuehreAus(vorschau);
      }
      return;
    }
    if (e.key === 'ArrowRight') {
      // Nur am TEXTENDE und ohne Auswahl (Bauform: Autovorschlag der fish-Shell) — mitten im
      // Wort bleibt → die Cursortaste, die es im Suchfeld immer war.
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
  // Gilt für JEDEN Modus, der Datensätze durchsucht — auch für den Vorgabemodus: dort ist
  // die Liste bei einem Zeichen nur selten leer, aber wenn sie es ist, fehlt genau dieses
  // eine Zeichen.
  //
  // AB DEM PRÄFIX, nicht erst ab dem ersten Zeichen dahinter (Review-Befund 8): wer '@' aus
  // der Legende übernimmt, las sofort „Keine Treffer" — eine Aussage über eine Suche, die er
  // noch gar nicht gestellt hat. Im präfixlosen Vorgabemodus bleibt die leere Eingabe
  // dagegen die kuratierte Startansicht und keine zu kurze Suche; dort ist „Keine Treffer"
  // die richtige Auskunft.
  const zuKurzFuerDatensaetze =
    rest.length < DATENSATZ_MINDESTZEICHEN &&
    modusZeigtDatensaetze(modus) &&
    (rest.length > 0 || PALETTE_MODI[modus].praefix !== null);
  /**
   * Der Wortlaut des Leerzustands — als WERT, nicht als Zweig im JSX: die Region darunter
   * steht dauerhaft, nur ihr Inhalt wechselt (siehe dort).
   */
  const leerText =
    flach.length > 0
      ? ''
      : zuKurzFuerDatensaetze
        ? `Mindestens ${DATENSATZ_MINDESTZEICHEN} Zeichen für die Datensatzsuche`
        : 'Keine Treffer';

  /**
   * EINE Zeile für BEIDE Zweige (LFH-391 · A3). Zwei Kopien wären zwei Orte, an denen der
   * Bedienziel-Boden aus LFH-365 still verlorengehen kann — ein Inline-Padding sieht kein
   * Guard. Der Boden selbst kommt aus `palettenZeilenStil`, siehe dort.
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
          // Aktive Zeile (Neuentwurf): Grund `flaeche3`, Ikone in Bedienfarbe. Der Text
          // bleibt `text` — die Auswahl trägt die Fläche plus `aria-selected`, nicht eine
          // eingefärbte Schrift.
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
        {/* Die →-Marke (LFH-645) sagt ZEILENGENAU, dass → hier eine Vorschau öffnet — der
            Fußhinweis kann das nicht, er steht statisch (ein je Zeile wechselnder Hinweis
            änderte die Zeilenzahl der Fußzeile und liesse die Palette springen). */}
        {istAktiv && b.vorschau && (
          <Tastenkuerzel aria-hidden style={{ color: farben.schwach }}>
            →
          </Tastenkuerzel>
        )}
        {/* Die Enter-Marke steht NUR an der aktiven Zeile (Entwurf): sie sagt, was Enter
            gerade auslöst. Satz, kein Ziel — `aria-hidden`, der Weg steht in der Fußzeile. */}
        {istAktiv && !b.kuerzel && (
          <Tastenkuerzel aria-hidden style={{ color: farben.schwach }}>
            ↵
          </Tastenkuerzel>
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
        // Rahmen in Bedienfarbe, keine Rundung (Entwurf). `colorBgElevated` ist `flaeche2`
        // des Modus — die Palette folgt dem Farbschema, nur Kopf und Rail sind modusfest.
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
      <div>
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
            <TbSearch size={18} />
          </span>
          <Input
            ref={inputRef}
            autoFocus
            variant="borderless"
            // Der Platzhalter bleibt BYTE-GLEICH: sechs e2e-Locator greifen das Feld darüber,
            // einer davon als zugänglichen Namen der Combobox (`gate1-ueberlauf.spec.ts`).
            placeholder="Suchen: Module, Aktionen, Einstellungen …"
            role="combobox"
            // In der Vorschau steht keine Listbox im Baum (LFH-645): kein `aria-controls`
            // ins Leere, keine aktive Option, die es nicht gibt.
            aria-expanded={!vorschau && flach.length > 0}
            aria-controls={vorschau ? undefined : 'cmd-liste'}
            aria-activedescendant={!vorschau && aktiverId ? `cmd-${aktiverId}` : undefined}
            value={suche}
            onChange={(e) => {
              // Ein geänderter Begriff ist eine neue Suche — die Vorschau gehört zur alten.
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
         * Die Modusanzeige (LFH-391 · A4): BIN ich im Modus? Solange ein Präfix steht,
         * nennt sie ihn — ohne sie wäre ein Filter, der die Liste um zwei Drittel kürzt,
         * von einem kaputten nicht zu unterscheiden. Die Legende „WIE komme ich hinein"
         * steht seit dem Neuentwurf dauerhaft in der Fußzeile (unten), nicht mehr hier.
         *
         * Der Tastaturvertrag steht in Steuer- und Fußzeile und NICHT im Platzhalter
         * (CLAUDE.md, Nacharbeit zu LFH-335).
         *
         * KEIN Bedienziel — Satz, kein Ziel, also kein `controlHeight`-Boden.
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
          /*
           * DIE VORSCHAU (LFH-645, Taste →) ersetzt die Liste, statt neben ihr zu stehen:
           * 640 px tragen Liste und Lese-Ansicht nicht nebeneinander. Der Fokus bleibt im
           * Suchfeld — Esc/← führen von dort zurück, ↵ öffnet. Nur LESEN: die Vorschau
           * verändert keinen Datensatz, sie ist dasselbe Bauteil wie der Personen-Drawer.
           *
           * „Zurück" ist ein antd-`Button` und erbt damit `controlHeight` — kein handgebautes
           * Bedienziel, das die zwei Angaben aus LFH-365 schuldete.
           */
          <div role="region" aria-label={`Vorschau: ${vorschau.label}`} data-lfh="palette-vorschau">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: token.paddingSM,
                padding: `${token.paddingXS}px ${token.padding}px`,
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <Button type="text" icon={<TbArrowLeft aria-hidden />} onClick={zurueckZurListe}>
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
            // `min(60vh, 480px)` statt der festen 380 (LFH-337 · M11): auf dem Fükw-Schirm
            // zeigte der Kasten von 42+ Befehlen rund sieben. `60vh` deckelt ihn auf niedrigen
            // Schirmen, wo 480 px über den Rand liefen.
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
         * Zwei Leerzustände, nicht einer (LFH-391 · C3): wer '@a' tippt, sieht per
         * Konstruktion nichts — die statischen Befehle sind vom Modus ausgefiltert, die
         * Datensatz-Abrufe laufen erst ab zwei Zeichen. Ein stummes „Keine Treffer" wäre
         * dort von „kaputt" nicht zu unterscheiden.
         *
         * DIE REGION STEHT IMMER, auch wenn sie schweigt (Review-Befund 7): eine
         * `aria-live`-Region meldet nur Änderungen an bereits vorhandenem Inhalt.
         *
         * AUSSERHALB der Listbox: deren Kinder sind Optionen und Gruppen.
         *
         * KEIN Bedienziel: Satz, kein Ziel, also kein `controlHeight`-Boden.
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
          {/* In der Vorschau sagt dieselbe Region an, WO man ist — der Fokus bleibt im
              Suchfeld, die neue Region allein hörte niemand. */}
          {vorschau ? `Vorschau: ${vorschau.label}. Escape führt zurück.` : leerText}
        </div>
        {/*
         * FUSSZEILE (Neuentwurf): Mono 10, NUR Hinweise, die wirklich funktionieren — Enter
         * öffnet, die drei Präfixe aus `PALETTE_MODI` (eine Quelle, kein zweiter Wortlaut)
         * und, wo es einen Sprung gibt, die Koordinate (LFH-619). Der Entwurf zeigt sie als
         * „# Koordinate"; `#` bleibt aber das ETB-Präfix — die Koordinate braucht kein
         * Zeichen, sie wird an ihrer Form erkannt (`koordinatenSprung.ts`).
         *
         * „⇧↵ im Panel" aus dem Entwurf ist ENTSCHIEDEN und entfallen (LFH-645, Raycast-
         * Muster): Strg/⌘+↵ öffnet im neuen Tab, → zeigt die Vorschau IN der Palette, ⇧↵
         * bleibt frei. Die Hinweise stehen STATISCH — „neuer Tab" gilt für fast jede Zeile,
         * „→ Vorschau" nur im Einsatz (Muster Koordinate); ob die markierte Zeile eine
         * Vorschau hat, sagt ihre →-Marke. Ein je Zeile wechselnder Hinweis änderte die
         * Zeilenzahl dieser umbrechenden Fußzeile und liesse die Palette beim Pfeilen springen.
         * In der Vorschau gilt die Präfixlegende nicht; dort stehen die drei gültigen Wege.
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
                // Das Präfixzeichen als Marke, nicht als Satzzeichen im Fließtext: ein nacktes
                // '>' hat weder Rahmen noch Abstand zum Nachbarn — JSX verschluckt den Umbruch
                // zwischen zwei Elementen ersatzlos, deshalb die Flex-Zeile mit `gap`.
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
