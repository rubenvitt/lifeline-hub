// frontend/src/command-palette/CommandPalette.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Modal, Input, theme, type InputRef } from 'antd';
import Tastenkuerzel from '../components/Tastenkuerzel';
import { form } from '../theme/tokens';
import { sichtbareDatensaetze } from './datensaetze';
import { filtereBefehle, filtereNachModus, modiMitPraefix, ohneOrdnungsdubletten, ordneTreffer, parsePraefix, type Treffer } from './fuzzy';
import {
  DATENSATZ_MINDESTZEICHEN, GRUPPEN_LABEL, GRUPPEN_REIHENFOLGE, PALETTE_MODI,
  modusZeigtDatensaetze, type Befehl, type PaletteModus,
} from './typen';
import { palettenZeilenStil } from './zeilenStil';

/**
 * Frist der Meldung nach aussen. Wert und Bauform wörtlich aus `etb/EtbFilterleiste.tsx`
 * (Befund M80) — ein zweiter Entprellungsmechanismus wäre eine zweite Wahrheit.
 */
const ENTPRELLUNG_MS = 300;

/** EIN Leer-Array statt eines Vorgabewerts im Kopf: ein `[]` dort wäre je Render eine neue
 *  Identität und machte die `useMemo` darunter wirkungslos. */
const KEINE_TREFFER: Treffer[] = [];

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
  schliesse: () => void;
}

/** Präsentationale Palette: Suche + gruppierte, tastaturbedienbare Trefferliste. */
export function CommandPalette({
  befehle,
  datensatzTreffer = KEINE_TREFFER,
  onSucheEntprellt,
  schliesse,
}: Props) {
  const { token } = theme.useToken();
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
  const listeRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputRef>(null);

  // Fokus sicherstellen: antd Modal kann den Fokus nach Mount verschieben.
  useEffect(() => { inputRef.current?.focus(); }, []);

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

  const treffer = useMemo(() => {
    const statisch = filtereBefehle(imModus, rest);
    // Bei LEERER Suche bleiben die Datensatz-Treffer draussen, und das ist kein Sonderfall
    // ohne Fall: der entprellte Rest hinkt der Eingabe um bis zu 300 ms hinterher. Wer das
    // Feld leert, sieht sofort wieder die Startansicht — die Treffer des vorigen Begriffs
    // stehen dann noch an und erschienen im Gruppenzweig als „Datensätze"-Gruppe. Die
    // Startansicht ist per Vertrag kuratiert (LFH-337 · M11), nicht eine Datenhalde.
    // (Der Riegel darüber deckt diesen Fall mit ab — die Zeile bleibt trotzdem stehen: sie
    // trennt die zwei RENDERZWEIGE, nicht die Trefferquelle.)
    return rest === '' ? statisch : [...statisch, ...anstehendeDatensaetze];
  }, [imModus, rest, anstehendeDatensaetze]);
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
    () => (sucheAktiv
      ? []
      : GRUPPEN_REIHENFOLGE
        .map((g) => ({ gruppe: g, items: treffer.map((t) => t.befehl).filter((b) => b.gruppe === g) }))
        .filter((x) => x.items.length > 0)),
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

  useEffect(() => { setAktivId(null); }, [suche]);

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

  function aufTaste(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (flach.length) setAktivId(flach[(aktiv + 1) % flach.length].id); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (flach.length) setAktivId(flach[(aktiv - 1 + flach.length) % flach.length].id); }
    else if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      fuehreAus(flach[aktiv]);
    }
  }

  const aktiverId = flach[aktiv]?.id;
  // Gilt für JEDEN Modus, der Datensätze durchsucht — auch für den Vorgabemodus: dort ist
  // die Liste bei einem Zeichen nur selten leer, aber wenn sie es ist, fehlt genau dieses
  // eine Zeichen.
  //
  // AB DEM PRÄFIX, nicht erst ab dem ersten Zeichen dahinter (Review-Befund 8): wer '@' aus
  // der Legende übernimmt, las sofort „Keine Treffer" — eine Aussage über eine Suche, die er
  // noch gar nicht gestellt hat. Im präfixlosen Vorgabemodus bleibt die leere Eingabe
  // dagegen die kuratierte Startansicht und keine zu kurze Suche; dort ist „Keine Treffer"
  // die richtige Auskunft.
  const zuKurzFuerDatensaetze = rest.length < DATENSATZ_MINDESTZEICHEN
    && modusZeigtDatensaetze(modus)
    && (rest.length > 0 || PALETTE_MODI[modus].praefix !== null);
  /**
   * Der Wortlaut des Leerzustands — als WERT, nicht als Zweig im JSX: die Region darunter
   * steht dauerhaft, nur ihr Inhalt wechselt (siehe dort).
   */
  const leerText = flach.length > 0
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
    return (
      <div
        key={b.id}
        id={`cmd-${b.id}`}
        role="option"
        aria-selected={istAktiv}
        onMouseEnter={() => setAktivId(b.id)}
        onClick={() => fuehreAus(b)}
        style={{
          ...palettenZeilenStil(token),
          background: istAktiv ? token.colorPrimaryBg : 'transparent',
          color: istAktiv ? token.colorPrimary : token.colorText,
        }}
      >
        {Icon && <Icon size={18} />}
        <span>{b.label}</span>
        {b.kuerzel && <Tastenkuerzel style={{ marginLeft: 'auto' }}>{b.kuerzel}</Tastenkuerzel>}
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
      width={640}
      zIndex={2000}
      styles={{ body: { padding: 0 } }}
      destroyOnHidden
    >
      <div>
        <Input
          ref={inputRef}
          autoFocus
          variant="borderless"
          size="large"
          placeholder="Suchen: Module, Aktionen, Einstellungen …"
          role="combobox"
          aria-expanded={flach.length > 0}
          aria-controls="cmd-liste"
          aria-activedescendant={aktiverId ? `cmd-${aktiverId}` : undefined}
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          onKeyDown={aufTaste}
          style={{ padding: '12px 16px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}
        />
        {/*
          * Die Modusanzeige (LFH-391 · A4) — sichtbarer Gegenpart zu einem Filter, der die
          * Liste um zwei Drittel kürzt. Sie beantwortet zwei Fragen: WIE komme ich hinein
          * (Legende, solange nichts getippt ist) und BIN ich drin (Wortlaut, solange der
          * Modus steht). Ohne die zweite Hälfte wäre der aktive Modus von einem kaputten
          * Filter nicht zu unterscheiden — auf dem Berührungsweg sieht niemand die getippte
          * Zeile als Syntax.
          *
          * BEDINGT, nicht dauerhaft: bei gewöhnlicher Suche kostet sie sonst eine der rund
          * sieben Zeilen, die der Fükw-Schirm zeigt. Der Tastaturvertrag steht damit in der
          * Steuerzeile und NICHT im Platzhalter (CLAUDE.md, Nacharbeit zu LFH-335) — der
          * Platzhaltertext bleibt byte-gleich, womit auch die fünf e2e-Locator halten.
          *
          * Rollen statt Werte (LFH-352): Sekundärfarbe, kleine Schrift, Abstandsrollen.
          * KEIN Bedienziel — Satz, kein Ziel, also kein `controlHeight`-Boden.
          */}
        {(modus !== 'alles' || rest === '') && (
          <div
            data-lfh="palette-modus"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: token.margin,
              padding: `${token.paddingXS}px ${token.paddingSM}px`,
              fontSize: token.fontSizeSM,
              color: token.colorTextSecondary,
            }}
          >
            {modus === 'alles'
              ? modiMitPraefix().map((m) => (
                // Das Präfixzeichen als Marke, nicht als Satzzeichen im Fliesstext: ein
                // nacktes '>' hat weder Rahmen noch Abstand zum Nachbarn — JSX verschluckt
                // den Umbruch zwischen zwei Elementen ersatzlos, deshalb die Flex-Zeile
                // mit `gap` statt eines Leerzeichens.
                <span
                  key={m.modus}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXS }}
                >
                  <Tastenkuerzel>{m.praefix}</Tastenkuerzel>
                  {m.legende}
                </span>
              ))
              : PALETTE_MODI[modus].hinweis}
          </div>
        )}
        <div
          id="cmd-liste"
          role="listbox"
          ref={listeRef}
          // `min(60vh, 480px)` statt der festen 380 (LFH-337 · M11): auf dem Fükw-Schirm
          // zeigte der Kasten von 42+ Befehlen rund sieben. Die Obergrenze bleibt, damit
          // die Liste auf einem hohen Schirm nicht die ganze Seite füllt; `60vh` deckelt
          // sie auf niedrigen Schirmen, wo 480 px über den Rand liefen.
          style={{ maxHeight: 'min(60vh, 480px)', overflowY: 'auto', padding: token.paddingXS }}
        >
          {sucheAktiv && flach.map((b) => optionsZeile(b))}
          {gruppen.map((x) => (
            <div key={x.gruppe} role="group" aria-label={GRUPPEN_LABEL[x.gruppe]}>
              <div
                style={{
                  padding: `${token.paddingXS}px ${token.paddingSM}px`,
                  fontSize: token.fontSizeSM,
                  textTransform: 'uppercase',
                  // Versalien ohne Sperrung sind der Grund, warum eine
                  // Gruppenüberschrift „gedrängt" aussieht — LFH-352 hält den Wert
                  // als Formrolle, statt ihn je Stelle zu erfinden.
                  letterSpacing: form.versalSperrung,
                  color: token.colorTextSecondary,
                }}
              >
                {GRUPPEN_LABEL[x.gruppe]}
              </div>
              {x.items.map((b) => optionsZeile(b))}
            </div>
          ))}
        </div>
        {/*
          * Zwei Leerzustände, nicht einer (LFH-391 · C3): wer '@a' tippt, sieht per
          * Konstruktion nichts — die statischen Befehle sind vom Modus ausgefiltert, die
          * Datensatz-Abrufe laufen erst ab zwei Zeichen. Ein stummes „Keine Treffer" wäre
          * dort von „kaputt" nicht zu unterscheiden, und auf dem Berührungsweg sieht niemand
          * die getippte Zeile als Syntax.
          *
          * DIE REGION STEHT IMMER, auch wenn sie schweigt (Review-Befund 7, Bauform
          * `components/Erfassung.tsx:352`): eine `aria-live`-Region meldet nur Änderungen an
          * bereits vorhandenem Inhalt. Zusammen mit ihrem Text eingehängt sagte sie nichts an
          * — hörbar blieb allein der Wechsel der Combobox auf `aria-expanded=false`, und der
          * trennt „zu kurz" nicht von „nichts gefunden". Genau diese Ununterscheidbarkeit ist
          * der Grund, aus dem die Zeile existiert.
          *
          * AUSSERHALB der Listbox: deren Kinder sind Optionen und Gruppen, ein Satz gehört
          * dort nicht hinein. Sichtbar ändert das nichts — die Liste ist leer, wenn die
          * Region spricht.
          *
          * KEIN Bedienziel: Satz, kein Ziel, also kein `controlHeight`-Boden. Die Polsterung
          * hängt am Inhalt, sonst stünde im Trefferfall ein leerer Streifen unter der Liste.
          */}
        <div
          data-lfh="palette-leerzustand"
          aria-live="polite"
          style={{ padding: leerText ? token.padding : 0, color: token.colorTextSecondary }}
        >
          {leerText}
        </div>
      </div>
    </Modal>
  );
}
