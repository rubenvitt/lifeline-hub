/**
 * Die taktische Fernmeldeskizze des S6 (LFH-893) — Zeichenfläche, Palette, Werkzeugleiste und
 * Eigenschaftspaneel. Herleitung: `openspec/changes/archive/2026-10-05-lfh-893-taktische-fernmeldeskizze/design.md`
 * (D1 Fläche, D4 Lage und ruhige Fläche, D6 Bedienung, D8 Rechte, D10 Hervorheben und Filter,
 * D13 Druck). Die Logik steht rein und getestet in `stab/skizze/` (`ansicht.ts` Zoom,
 * `ebenen.ts` Filter und Hervorheben, `geometrie.ts` Treffer, `bedienung.ts` Fokusfolge, Tasten
 * und Rechte, `wirkung.ts` was Ziehen und Tasten schreiben, `schriftfeld.ts`); diese Datei
 * verbindet sie. Die Fläche ruft nie selbst das API: jede Änderung geht über `aktionen`.
 *
 * ── Props ────────────────────────────────────────────────────────────────────────────────────
 * - `netz` — das Modell aus `baueFernmeldenetz` (`stab/fernmeldeskizze.ts`), live von der Seite.
 * - `aktionen` — die Schreibwege (`stab/skizzenAktionen.ts`, umgesetzt in
 *   `stab/useSkizzenAktionen.ts`); `null` = ohne Schreibrecht im Einsatz: schreibgeschützt,
 *   Hervorheben, Filtern und Zoomen gehen weiter.
 * - `einsatzbezeichnung` — für Titel und Herausgeber-Vorgabe des Schriftfelds.
 * - `gewaehlt?` / `onWahl?` — das gewählte Element (Schlüssel aus dem Netz, z. B. `eh-10`,
 *   `sg-2`, `sg-2~eh-10`, `vb-8`, `be-4`, `schriftfeld`). Mit `gewaehlt` gesteuert (z. B. Klick
 *   im Lücken-Paneel): die Fläche holt das Element in den sichtbaren Ausschnitt. Ohne `gewaehlt`
 *   hält die Fläche die Wahl selbst und meldet sie nur über `onWahl`.
 * - `druckFormat?` / `onDruckFormat?` — Papierformat (`'a3'` Vorgabe, `'a4'`). Nur mit
 *   `onDruckFormat` steht die Segmentleiste „Papierformat“ in der Werkzeugleiste.
 * - `druckt?` — steht die Seite im Druck? Vorgabe `useDruckModus()`. Im Druck: keine
 *   Bedienelemente, keine Hervorhebung, kein Filter, keine Wahl; die `viewBox` umfasst die ganze
 *   Skizze samt Schriftfeld.
 * - `befehle?` — der Befehlsstapel für Rückgängig/Wiederholen; Vorgabe ein eigener je Montage.
 *   Die Seite reicht einen, wenn er einen Wechsel der Darstellung überleben soll.
 *
 * ── Druck (Schnittstelle zur Seite) ──────────────────────────────────────────────────────────
 * Die Seite setzt `skizzenDruckKlasse(druckFormat)` (`stab/skizze/druckformat.ts`) an das Element
 * in der Druckwurzel, das Druckkopf, diese Komponente und das Lücken-Paneel trägt; daraus macht
 * `stab/skizze/skizzeDruck.css` die benannte Druckseite A3 bzw. A4 quer. Die Funkplan-Tabelle als
 * Anlage folgt mit der Umbruchmechanik von `druck/druck.css` auf einer neuen Seite. Bedienung
 * trägt `lfh-skizze-bedienung` und fehlt im Druck.
 *
 * ── `data-lfh` für e2e ───────────────────────────────────────────────────────────────────────
 * `fernmeldeskizze` (Wurzel), `skizze-flaeche`, `skizze-element` (mit `data-key`,
 * `data-gewaehlt`), `skizze-griff` (`data-griff` kreis/ecke), `skizze-werkzeugleiste`,
 * `skizze-zoom-ein`, `skizze-zoom-aus`, `skizze-einpassen`, `skizze-rueckgaengig`,
 * `skizze-wiederholen`, `skizze-neu-anordnen`, `skizze-palette`, `skizze-palette-knopf`,
 * `skizze-palette-eintrag` (`data-key`), `skizze-palette-setzen`, `skizze-anlegen-extern`,
 * `skizze-anlegen-komponente`, `skizze-anlegen-bereich`, `skizze-paneel`, `skizze-paneel-titel`,
 * `skizze-paneel-leer`, `skizze-rechte-grund`, `skizze-meldung`, `skizze-kanaele`,
 * `skizze-verbinden`, `skizze-verbinden-dialog`, `skizze-verbinden-ziel`, `skizze-artwahl`,
 * `skizze-kontextmenue`, `skizze-status`, `skizze-tasten`, `skizze-fehlend`, `inspector-sprung`.
 */
import { DndContext, DragOverlay, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Flex, Typography } from 'antd';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { taktischeDtgVoll } from '../anzeige/format';
import type { Verbindungsart } from '../api/fernmeldeskizzeVertrag';
import { useDruckModus } from '../components/druck/useDruckModus';
import { useRollen } from '../components/instrument';
import Tastenkuerzel from '../components/Tastenkuerzel';
import { useViewport } from '../components/useViewport';
import { ZugPointerSensor } from '../components/zugPointerSensor';
import PunktankerMenue from '../pages/lagekarte/PunktankerMenue';
import type { Fernmeldenetz } from './fernmeldeskizze';
import { layoutFernmeldenetz, type Platz } from './fernmeldeskizzeLayout';
import { ZUSTAND_GRUND } from './funkplan';
import type { SkizzenAktionen } from './skizzenAktionen';
import { Befehlsstapel } from './skizzenBefehle';
import { VERBINDUNGSARTEN, bedingungszeichenText, verbindungsartWort } from './skizzenZeichen';
import {
  ZOOM_SCHRITT,
  eingepasst,
  zeige,
  zoome,
  type Ansicht,
  type Groesse,
  type Punkt,
} from './skizze/ansicht';
import {
  fokusfolge,
  griffGrund,
  lageGrund,
  type Bedienkontext,
  type TastenBefehl,
  tastenBefehl,
} from './skizze/bedienung';
import { DRUCKFORMAT_VORGABE, type Druckformat } from './skizze/druckformat';
import {
  hervorhebung,
  sichtbarImFilter,
  teileStichSchluessel,
  type Ebenenfilter,
} from './skizze/ebenen';
import Eigenschaftspaneel from './skizze/Eigenschaftspaneel';
import { elementRechteck, flaechenAusdehnung } from './skizze/geometrie';
import { schriftfeldAngaben, schriftfeldBlock } from './skizze/schriftfeld';
import {
  AnlegenDialog,
  ArtDialog,
  Rueckfrage,
  VerbindenDialog,
  type AnlegenArt,
} from './skizze/SkizzenDialoge';
import SkizzenFlaeche, { FLAECHE_VORGABE, type FlaechenApi } from './skizze/SkizzenFlaeche';
import SkizzenPalette from './skizze/SkizzenPalette';
import SkizzenWerkzeugleiste from './skizze/SkizzenWerkzeugleiste';
import { useSkizzenHandlungen } from './skizze/useSkizzenHandlungen';
import {
  ablageWirkung,
  neueVerbindung,
  tastenWirkung,
  type Wirkung,
  type ZiehDaten,
} from './skizze/wirkung';
import './skizze/skizzeDruck.css';

export interface FernmeldeskizzeBildProps {
  netz: Fernmeldenetz;
  aktionen: SkizzenAktionen | null;
  einsatzbezeichnung: string;
  gewaehlt?: string | null;
  onWahl?: (key: string | null) => void;
  druckFormat?: Druckformat;
  onDruckFormat?: (format: Druckformat) => void;
  druckt?: boolean;
  befehle?: Befehlsstapel;
}

/** Größe eines neuen Bereichs in Skizzeneinheiten. */
const BEREICH_NEU = { breite: 320, hoehe: 192 };

type Dialog =
  | { art: 'anlegen'; was: AnlegenArt }
  | { art: 'verbinden'; quelle: string }
  | { art: 'artwahl'; von: string; nach: string }
  | { art: 'komponente-entfernen'; key: string }
  | { art: 'neu-anordnen' };

interface Kontextmenue {
  key: string;
  anker: Punkt;
}

/** Wo die Meldung eines Elements steht: die einer Stichleitung an ihrer Stelle. */
function meldungsElement(key: string): string {
  return teileStichSchluessel(key)?.stelle ?? key;
}

function istEingabe(ziel: EventTarget | null): boolean {
  const el = ziel as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
    el.closest('.ant-modal, .ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown') != null
  );
}

/** Die Fläche nach Zustand der Quellen: ohne Abschnitte keine Fläche, nur der Grund. */
export default function FernmeldeskizzeBild(props: FernmeldeskizzeBildProps) {
  const { netz } = props;
  const { rollen } = useRollen();
  if (!netz.darstellbar) {
    const gruende = netz.fehlend.map((f) => `${f.name}: ${ZUSTAND_GRUND[f.zustand]}`).join(' · ');
    return (
      <Typography.Paragraph style={{ color: rollen.gedaempft }} data-lfh="skizze-fehlend">
        {`Keine Skizze darstellbar — ${gruende || 'Abschnitte: nicht geladen'}`}
      </Typography.Paragraph>
    );
  }
  // Je Einsatz eine eigene Fläche (Review O6): die Seite bleibt beim Einsatzwechsel montiert
  // (Outlet ohne Schlüssel), eigene Lagen, bestätigte Versionen, Status, eigener Stapel und Wahl
  // gehören aber zum alten Einsatz — `ab-1` ist dort ein anderer Abschnitt.
  return <Skizze key={netz.einsatzId} {...props} />;
}

function Skizze({
  netz,
  aktionen,
  einsatzbezeichnung,
  gewaehlt: gewaehltVonAussen,
  onWahl,
  druckFormat = DRUCKFORMAT_VORGABE,
  onDruckFormat,
  druckt: druckVonAussen,
  befehle: befehleVonAussen,
}: FernmeldeskizzeBildProps) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const { istSchmal, istBeruehrung, abBreite } = useViewport();
  const druckModus = useDruckModus();
  const druck = druckVonAussen ?? druckModus;
  const navigate = useNavigate();
  const [eigenerStapel] = useState(() => new Befehlsstapel());
  const h = useSkizzenHandlungen(netz, aktionen, befehleVonAussen ?? eigenerStapel);
  const angezeigt = h.angezeigt;
  const kontext: Bedienkontext = useMemo(
    () => ({ aktionen: aktionen != null, mobil: istSchmal }),
    [aktionen, istSchmal],
  );
  const lageFrei = lageGrund(angezeigt, kontext) == null;
  const paletteId = useId();
  const tastenId = useId();
  const wurzel = useRef<HTMLDivElement | null>(null);
  const paneelTitel = useRef<HTMLHeadingElement | null>(null);
  const api = useRef<FlaechenApi | null>(null);

  // ── Wahl, Fokus, Zeiger ───────────────────────────────────────────────────────────────────
  const gesteuert = gewaehltVonAussen !== undefined;
  const [eigeneWahl, setEigeneWahl] = useState<string | null>(null);
  const gewaehlt = gesteuert ? gewaehltVonAussen : eigeneWahl;
  const waehle = useCallback(
    (key: string | null) => {
      if (!gesteuert) setEigeneWahl(key);
      onWahl?.(key);
    },
    [gesteuert, onWahl],
  );
  const folge = useMemo(() => fokusfolge(angezeigt), [angezeigt]);
  const [fokusWunsch, setFokus] = useState<string | null>(null);
  const fokus =
    fokusWunsch != null && folge.includes(fokusWunsch)
      ? fokusWunsch
      : gewaehlt != null && folge.includes(gewaehlt)
        ? gewaehlt
        : (folge[0] ?? null);
  const [zeiger, setZeiger] = useState<string | null>(null);
  const [filter, setFilter] = useState<Ebenenfilter>('alle');

  // ── Layout mit ruhiger Fläche (D4) ────────────────────────────────────────────────────────
  const [gehalten, setGehalten] = useState<ReadonlyMap<string, Platz> | null>(null);
  const layout = useMemo(
    () => layoutFernmeldenetz(angezeigt, gehalten ? { gehalten } : {}),
    [angezeigt, gehalten],
  );
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  const onHalten = useCallback((halten: boolean) => {
    setGehalten((alt) => (halten ? (alt ?? layoutRef.current.plaetze) : null));
  }, []);

  // ── Schriftfeld und Ausdehnung ────────────────────────────────────────────────────────────
  const block = useMemo(
    () =>
      schriftfeldBlock(
        schriftfeldAngaben(angezeigt.schriftfeld, einsatzbezeichnung, angezeigt.stand, (z) =>
          taktischeDtgVoll(z, konventionen),
        ),
      ),
    [angezeigt.schriftfeld, angezeigt.stand, einsatzbezeichnung, konventionen],
  );
  const { inhalt, schriftfeld } = useMemo(
    () => flaechenAusdehnung(layout, angezeigt.bereiche, block),
    [layout, angezeigt.bereiche, block],
  );
  const sfRechteck = { ...schriftfeld, breite: block.breite, hoehe: block.hoehe };

  // ── Ansicht ───────────────────────────────────────────────────────────────────────────────
  const [flaeche, setFlaeche] = useState<Groesse>(FLAECHE_VORGABE);
  const [ansicht, setAnsicht] = useState<Ansicht | null>(null);
  const effektiv = ansicht ?? eingepasst(inhalt, flaeche);
  const onFlaeche = useCallback((g: Groesse) => {
    setFlaeche((alt) => (alt.breite === g.breite && alt.hoehe === g.hoehe ? alt : g));
  }, []);
  const zoom = (richtung: 1 | -1) =>
    setAnsicht(zoome(effektiv, ZOOM_SCHRITT ** richtung, flaeche, inhalt));

  // Neue Wahl (von außen wie das Lücken-Paneel, oder per Tab, der wählt): Fokus dorthin und in den
  // sichtbaren Ausschnitt holen — Fokus nie verdeckt (Prüfliste Kriterium 13).
  const [letzteWahl, setLetzteWahl] = useState(gewaehlt);
  if (gewaehlt !== letzteWahl) {
    setLetzteWahl(gewaehlt);
    if (gewaehlt != null) {
      setFokus(gewaehlt);
      const r = elementRechteck(angezeigt, layout.plaetze, sfRechteck, gewaehlt);
      if (r && ansicht) setAnsicht(zeige(ansicht, flaeche, r));
    }
  }

  // ── Rechte je Element (D8) ────────────────────────────────────────────────────────────────
  const griff = useCallback(
    (key: string) => !druck && griffGrund(angezeigt, key, kontext) == null,
    [druck, angezeigt, kontext],
  );
  const ziehbar = useCallback(
    (key: string) => {
      if (druck) return false;
      if (angezeigt.stellen.some((s) => s.key === key)) {
        return lageFrei || griffGrund(angezeigt, key, kontext) == null;
      }
      return (
        lageFrei &&
        (angezeigt.schienen.some((s) => s.key === key) ||
          angezeigt.bereiche.some((b) => b.key === key))
      );
    },
    [druck, angezeigt, kontext, lageFrei],
  );

  // ── Dialoge, Kontextmenü ──────────────────────────────────────────────────────────────────
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menue, setMenue] = useState<Kontextmenue | null>(null);
  const [artMenue, setArtMenue] = useState<{ von: string; nach: string; anker: Punkt } | null>(
    null,
  );
  const relativ = (p: Punkt): Punkt => {
    const r = wurzel.current?.getBoundingClientRect();
    return { x: p.x - (r?.left ?? 0), y: p.y - (r?.top ?? 0) };
  };

  const verbindenErlaubt = (key: string) =>
    angezeigt.stellen.some((s) => s.key === key) &&
    (griffGrund(angezeigt, key, kontext) == null || lageFrei);

  const ohneFehler = (p: Promise<unknown>) => void p.catch(() => {});

  /** Führt eine Wirkung aus; ein Scheitern steht schon am Element (Handlungen). */
  const fuehreAus = (w: Wirkung, anker?: Punkt) => {
    switch (w.art) {
      case 'nichts':
        return;
      case 'abgelehnt':
        h.melde(w.element, w.grund);
        return;
      case 'verschiebe':
        ohneFehler(h.verschieben(w.key, w.ziel, w.vorher));
        return;
      case 'schieneSetzen':
        ohneFehler(h.setzeSchiene(w.key, w.ziel));
        waehle(w.key);
        return;
      case 'bereich': {
        const b = angezeigt.bereiche.find((x) => x.key === w.key);
        if (b) ohneFehler(h.aendereBereich(b, w.felder));
        return;
      }
      case 'zuordnen':
        ohneFehler(h.zuordnen(w.stelle, w.sprechgruppeId));
        return;
      case 'loese':
        ohneFehler(h.loesen(w.stelle, w.sprechgruppeId));
        return;
      case 'verbinden':
        if (anker && !istBeruehrung)
          setArtMenue({ von: w.von, nach: w.nach, anker: relativ(anker) });
        else setDialog({ art: 'artwahl', von: w.von, nach: w.nach });
        return;
      case 'entferneVerbindung': {
        const v = angezeigt.verbindungen.find((x) => x.key === w.key);
        if (v) {
          ohneFehler(h.entferneVerbindung(v));
          waehle(null);
        }
        return;
      }
      case 'entferneBereich': {
        const b = angezeigt.bereiche.find((x) => x.key === w.key);
        if (b) {
          ohneFehler(h.entferneBereich(b));
          waehle(null);
        }
        return;
      }
      case 'frage':
        setDialog({ art: 'komponente-entfernen', key: w.key });
        return;
    }
  };

  const verbinde = (von: string, nach: string, art: Verbindungsart) =>
    h.verbinden(von, nach, neueVerbindung(art));

  const oeffneVerbinden = (key: string) => {
    const grund = verbindenErlaubt(key)
      ? null
      : (griffGrund(angezeigt, key, kontext) ?? 'nicht möglich');
    if (grund) h.melde(key, grund);
    else setDialog({ art: 'verbinden', quelle: key });
  };

  const entfernenFrage = (key: string) =>
    fuehreAus(
      angezeigt.bereiche.some((b) => b.key === key)
        ? { art: 'entferneBereich', key }
        : { art: 'frage', key },
    );

  // ── Tasten ────────────────────────────────────────────────────────────────────────────────
  const onTaste = (befehl: TastenBefehl, key: string | null) => {
    switch (befehl.art) {
      case 'rueckgaengig':
        if (aktionen) void h.rueckgaengig();
        return;
      case 'wiederholen':
        if (aktionen) void h.wiederholen();
        return;
      case 'abwaehlen': {
        // Escape quittiert erst die Meldung am Element, erst das nächste wählt ab (Prüfliste O4).
        const melder = key == null ? null : meldungsElement(key);
        if (melder != null && h.meldungen.has(melder)) h.quittiere(melder);
        else waehle(null);
        return;
      }
      case 'zoom':
        zoom(befehl.richtung);
        return;
      case 'einpassen':
        setAnsicht(null);
        return;
      default:
        break;
    }
    if (key == null) return;
    switch (befehl.art) {
      case 'oeffne':
        waehle(key);
        // Erst nach dem Rendern steht das Paneel des Elements.
        requestAnimationFrame(() => paneelTitel.current?.focus());
        return;
      case 'verbinden':
        oeffneVerbinden(key);
        return;
      case 'menue': {
        const anker = api.current?.ankerVon(key);
        waehle(key);
        setMenue({ key, anker: relativ(anker ?? { x: 0, y: 0 }) });
        return;
      }
      case 'verschiebe':
      case 'groesse':
      case 'entferne':
        fuehreAus(tastenWirkung(angezeigt, layout.plaetze, kontext, befehl, key));
        return;
      default:
        return;
    }
  };

  /** Strg+Z/Strg+Y auch, wenn der Fokus auf Werkzeugleiste oder Paneel steht, nie in Feldern. */
  const wurzelTaste = (e: KeyboardEvent<HTMLDivElement>) => {
    if (istEingabe(e.target)) return;
    const befehl = tastenBefehl(e);
    if (befehl?.art === 'rueckgaengig' || befehl?.art === 'wiederholen') {
      e.preventDefault();
      onTaste(befehl, null);
    }
  };

  // ── Ziehen ────────────────────────────────────────────────────────────────────────────────
  const sensoren = useSensors(
    useSensor(ZugPointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const [aktivDaten, setAktivDaten] = useState<ZiehDaten | null>(null);
  const zugEnde = (e: DragEndEvent) => {
    setAktivDaten(null);
    const daten = e.active.data.current as ZiehDaten | undefined;
    if (!daten) return;
    const start = e.activatorEvent as PointerEvent | null;
    const client =
      start && typeof start.clientX === 'number'
        ? { x: start.clientX + e.delta.x, y: start.clientY + e.delta.y }
        : null;
    const ende = client ? (api.current?.zuSkizze(client.x, client.y) ?? null) : null;
    const s = effektiv.skala;
    fuehreAus(
      ablageWirkung(angezeigt, layout.plaetze, kontext, {
        daten,
        ende,
        weg: { x: e.delta.x / s, y: e.delta.y / s },
      }),
      client ?? undefined,
    );
  };

  /** Palette per Knopf: die Schiene in die Mitte des sichtbaren Ausschnitts. */
  const aufFlaeche = (sprechgruppeId: number) => {
    const mitte = {
      x: effektiv.x + flaeche.breite / effektiv.skala / 2,
      y: effektiv.y + flaeche.hoehe / effektiv.skala / 2,
    };
    fuehreAus(
      ablageWirkung(angezeigt, layout.plaetze, kontext, {
        daten: { art: 'palette', sprechgruppeId },
        ende: mitte,
        weg: { x: 0, y: 0 },
      }),
    );
  };

  const bereichAnlegen = (bezeichnung: string) => {
    const x = Math.max(
      0,
      Math.round(effektiv.x + flaeche.breite / effektiv.skala / 2 - BEREICH_NEU.breite / 2),
    );
    const y = Math.max(
      0,
      Math.round(effektiv.y + flaeche.hoehe / effektiv.skala / 2 - BEREICH_NEU.hoehe / 2),
    );
    return h.legeBereichAn({ x: x - (x % 8), y: y - (y % 8), ...BEREICH_NEU, bezeichnung });
  };

  // ── Darstellung ───────────────────────────────────────────────────────────────────────────
  const breit = abBreite('xl');
  const paletteDa = lageFrei && !druck;
  const [paletteOffen, setPaletteOffen] = useState<boolean | null>(null);
  // Offen erst ab `xxl`: am Fükw (1366 px mit Modulpanel) gehört die Breite der Fläche.
  const paletteZeigen = paletteDa && (paletteOffen ?? abBreite('xxl'));
  const hervor = druck ? null : hervorhebung(angezeigt, zeiger ?? gewaehlt);
  const voll = druck ? null : sichtbarImFilter(angezeigt, filter);
  const schreibt = aktionen != null && !istSchmal;
  const meldungsKey = gewaehlt ? meldungsElement(gewaehlt) : null;
  const meldung = meldungsKey ? (h.meldungen.get(meldungsKey) ?? null) : null;

  const menueStelle = menue ? angezeigt.stellen.find((s) => s.key === menue.key) : undefined;
  const menueStich = menue ? teileStichSchluessel(menue.key) : null;
  const menueItems = menue
    ? [
        { key: 'eigenschaften', label: 'Eigenschaften' },
        ...(menueStelle && verbindenErlaubt(menueStelle.key)
          ? [{ key: 'verbinden', label: 'Verbinden mit …' }]
          : []),
        ...(menueStelle?.ziel ? [{ key: 'datensatz', label: 'zum Datensatz ↗' }] : []),
        ...(menueStich && griffGrund(angezeigt, menueStich.stelle, kontext) == null
          ? [{ key: 'loesen', label: 'Lösen', danger: true }]
          : []),
        ...(lageFrei &&
        (angezeigt.verbindungen.some((v) => v.key === menue.key) ||
          angezeigt.bereiche.some((b) => b.key === menue.key) ||
          menueStelle?.art === 'komponente')
          ? [{ key: 'entfernen', label: 'Entfernen', danger: true }]
          : []),
      ]
    : [];
  const menueWahl = (wahl: string) => {
    const key = menue?.key;
    setMenue(null);
    if (!key) return;
    if (wahl === 'eigenschaften') onTaste({ art: 'oeffne' }, key);
    else if (wahl === 'verbinden') oeffneVerbinden(key);
    else if (wahl === 'datensatz' && menueStelle?.ziel) void navigate(menueStelle.ziel);
    else if (wahl === 'loesen' || wahl === 'entfernen') {
      if (angezeigt.bereiche.some((b) => b.key === key) || menueStelle) entfernenFrage(key);
      else onTaste({ art: 'entferne' }, key);
    }
  };

  const flaechenHoehe = druck ? undefined : istSchmal ? '60vh' : 'clamp(360px, 68vh, 960px)';
  const spalten = [
    paletteZeigen ? 'auto' : null,
    'minmax(0, 1fr)',
    !druck && breit ? 'minmax(280px, 340px)' : null,
  ].filter(Boolean);

  const statusText = h.laeuft ? `${h.laeuft} …` : (h.letzte?.text ?? '');

  return (
    <div
      ref={wurzel}
      data-lfh="fernmeldeskizze"
      className="lfh-skizze"
      style={{ position: 'relative' }}
      onKeyDown={wurzelTaste}
    >
      {!druck ? (
        <SkizzenWerkzeugleiste
          palette={
            paletteDa
              ? {
                  offen: paletteZeigen,
                  onUmschalten: () => setPaletteOffen(!paletteZeigen),
                  steuert: paletteId,
                }
              : null
          }
          onZoom={zoom}
          onEinpassen={() => setAnsicht(null)}
          eingepasst={ansicht == null}
          filter={filter}
          onFilter={setFilter}
          befehle={
            schreibt
              ? {
                  stand: h.stand,
                  onRueckgaengig: () => void h.rueckgaengig(),
                  onWiederholen: () => void h.wiederholen(),
                }
              : null
          }
          onNeuAnordnen={lageFrei ? () => setDialog({ art: 'neu-anordnen' }) : null}
          druck={onDruckFormat ? { format: druckFormat, onFormat: onDruckFormat } : null}
        />
      ) : null}
      {netz.fehlend.length > 0 ? (
        <div
          style={{ color: rollen.gedaempft, marginBlockEnd: token.marginSM }}
          data-lfh="skizze-fehlend"
        >
          {netz.fehlend.map((f) => `${f.name}: ${ZUSTAND_GRUND[f.zustand]}`).join(' · ')}
        </div>
      ) : null}
      <DndContext
        sensors={sensoren}
        onDragStart={(e) => setAktivDaten((e.active.data.current as ZiehDaten | undefined) ?? null)}
        onDragCancel={() => setAktivDaten(null)}
        onDragEnd={zugEnde}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: spalten.join(' '),
            gap: token.marginMD,
            alignItems: 'start',
          }}
        >
          {paletteZeigen ? (
            <div id={paletteId} style={{ maxHeight: flaechenHoehe, overflowY: 'auto' }}>
              <SkizzenPalette
                netz={angezeigt}
                onAufFlaeche={aufFlaeche}
                onZeige={(key) => {
                  waehle(key);
                  api.current?.fokussiere(key);
                }}
                onAnlegen={(was) => setDialog({ art: 'anlegen', was })}
              />
            </div>
          ) : null}
          <div style={{ height: flaechenHoehe, minWidth: 0 }}>
            <SkizzenFlaeche
              netz={angezeigt}
              layout={layout}
              inhalt={inhalt}
              schriftfeld={{ x: schriftfeld.x, y: schriftfeld.y, block }}
              ansicht={ansicht}
              effektiv={effektiv}
              onAnsicht={setAnsicht}
              flaeche={flaeche}
              onFlaeche={onFlaeche}
              druck={druck}
              folge={folge}
              gewaehlt={gewaehlt}
              fokus={fokus}
              onFokus={(key) => {
                setFokus(key);
                if (key !== gewaehlt) waehle(key);
              }}
              onWahl={waehle}
              onZeiger={setZeiger}
              hervor={hervor}
              voll={voll}
              meldungen={h.meldungen}
              ziehbar={ziehbar}
              griff={griff}
              onTaste={onTaste}
              onKontext={(key, px) => {
                waehle(key);
                setMenue({ key, anker: relativ(px) });
              }}
              onHalten={onHalten}
              api={api}
              beschreibungId={istSchmal ? undefined : tastenId}
            />
          </div>
          {!druck ? (
            <div style={breit ? undefined : { gridColumn: '1 / -1' }}>
              <Eigenschaftspaneel
                ref={paneelTitel}
                netz={angezeigt}
                gewaehlt={gewaehlt}
                einsatzbezeichnung={einsatzbezeichnung}
                kontext={kontext}
                handlungen={h}
                meldung={meldung}
                onQuittieren={() => {
                  if (meldungsKey) h.quittiere(meldungsKey);
                }}
                onVerbinden={oeffneVerbinden}
                onEntfernenFrage={entfernenFrage}
              />
            </div>
          ) : null}
        </div>
        <DragOverlay>
          {aktivDaten?.art === 'palette' ? (
            <PaletteSchatten netz={angezeigt} id={aktivDaten.sprechgruppeId} />
          ) : null}
        </DragOverlay>
      </DndContext>
      {!druck ? (
        <Flex
          wrap
          gap={token.marginSM}
          className="lfh-skizze-bedienung"
          style={{ marginBlockStart: token.marginSM, color: rollen.gedaempft }}
        >
          {!istSchmal ? (
            <span id={tastenId} data-lfh="skizze-tasten">
              <Tastenkuerzel>Tab</Tastenkuerzel> wählt · <Tastenkuerzel>Pfeile</Tastenkuerzel>{' '}
              verschieben · <Tastenkuerzel>V</Tastenkuerzel> verbinden ·{' '}
              <Tastenkuerzel>Entf</Tastenkuerzel> löst · <Tastenkuerzel>Enter</Tastenkuerzel>{' '}
              Eigenschaften · <Tastenkuerzel>+</Tastenkuerzel>/<Tastenkuerzel>-</Tastenkuerzel> Zoom
              · <Tastenkuerzel>0</Tastenkuerzel> einpassen
            </span>
          ) : null}
          <span
            role="status"
            aria-live="polite"
            data-lfh="skizze-status"
            style={{ color: rollen.text }}
          >
            {statusText}
          </span>
        </Flex>
      ) : null}

      {menue ? (
        <PunktankerMenue
          anker={menue.anker}
          ariaLabel="Kontextmenü"
          ankerKennung="skizze-kontextmenue"
          items={menueItems}
          onWaehlen={menueWahl}
          onSchliessen={() => setMenue(null)}
          fokusZiel={() =>
            wurzel.current?.querySelector<HTMLElement>(
              '[data-lfh="skizze-element"][tabindex="0"]',
            ) ?? null
          }
        />
      ) : null}
      {artMenue ? (
        <PunktankerMenue
          anker={artMenue.anker}
          ariaLabel="Art der Verbindung"
          ankerKennung="skizze-artwahl"
          kopf="Art der Verbindung"
          items={ART_ITEMS}
          onWaehlen={(art) =>
            ohneFehler(verbinde(artMenue.von, artMenue.nach, art as Verbindungsart))
          }
          onSchliessen={() => setArtMenue(null)}
        />
      ) : null}
      {dialog?.art === 'anlegen' ? (
        <AnlegenDialog
          art={dialog.was}
          onExtern={(art, bezeichnung) => h.legeExterneStelleAn(art, bezeichnung)}
          onKomponente={(art, bezeichnung) => h.legeKomponenteAn(art, bezeichnung)}
          onBereich={bereichAnlegen}
          onSchliessen={() => setDialog(null)}
        />
      ) : null}
      {dialog?.art === 'verbinden' ? (
        <VerbindenDialog
          netz={angezeigt}
          quelle={dialog.quelle}
          radial={istBeruehrung}
          onZuordnen={(sg) => h.zuordnen(dialog.quelle, sg)}
          onVerbinden={(nach, art) => verbinde(dialog.quelle, nach, art)}
          onSchliessen={() => {
            const quelle = dialog.quelle;
            setDialog(null);
            api.current?.fokussiere(quelle);
          }}
        />
      ) : null}
      {dialog?.art === 'artwahl' ? (
        <ArtDialog
          von={angezeigt.stellen.find((s) => s.key === dialog.von)?.bezeichnung ?? dialog.von}
          nach={angezeigt.stellen.find((s) => s.key === dialog.nach)?.bezeichnung ?? dialog.nach}
          radial={istBeruehrung}
          onWahl={(art) => verbinde(dialog.von, dialog.nach, art)}
          onSchliessen={() => setDialog(null)}
        />
      ) : null}
      {dialog?.art === 'komponente-entfernen'
        ? (() => {
            const k = angezeigt.stellen.find((s) => s.key === dialog.key);
            if (!k || k.art !== 'komponente') return null;
            const kanaele = angezeigt.schienen
              .filter((s) => s.teilnehmer.some((t) => t.element === k.key))
              .map((s) => s.id);
            return (
              <Rueckfrage
                titel={`${k.bezeichnung} entfernen?`}
                text="Die Komponente, ihre Kanäle und ihre Verbindungen werden entfernt. Rückgängig legt die Komponente mit ihren Kanälen neu an, die Verbindungen nicht."
                okText="Entfernen"
                onOk={async () => {
                  await h.entferneKomponente(k.key, k.id, k.komponentenart, k.bezeichnung, kanaele);
                  waehle(null);
                }}
                onSchliessen={() => setDialog(null)}
              />
            );
          })()
        : null}
      {dialog?.art === 'neu-anordnen' ? (
        <Rueckfrage
          titel="Neu anordnen?"
          text="Alle gespeicherten Lagen dieses Einsatzes werden verworfen, an allen Arbeitsplätzen; die Skizze steht danach wieder im Auto-Layout. Zuordnungen, Verbindungen, Komponenten, Bereiche und Schriftfeld bleiben. Rückgängig gibt es dafür nicht."
          okText="Neu anordnen"
          onOk={async () => {
            await h.neuAnordnen();
            setGehalten(null);
            setAnsicht(null);
          }}
          onSchliessen={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

const ART_ITEMS = VERBINDUNGSARTEN.map((a) => ({ key: a, label: verbindungsartWort(a) }));

function PaletteSchatten({ netz, id }: { netz: Fernmeldenetz; id: number }) {
  const { token, rollen } = useRollen();
  const sg = netz.sprechgruppen.find((s) => s.id === id);
  if (!sg) return null;
  return (
    <div
      style={{
        display: 'inline-block',
        paddingInline: token.paddingSM,
        paddingBlock: token.paddingXXS,
        border: `1px solid ${rollen.linie}`,
        background: rollen.paneel,
        color: rollen.text,
        fontFamily: token.fontFamilyCode,
        boxShadow: token.boxShadowSecondary,
      }}
    >
      {bedingungszeichenText(sg.betriebsart, sg.bezeichnung)}
    </div>
  );
}
