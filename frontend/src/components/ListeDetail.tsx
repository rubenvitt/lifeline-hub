import { Button } from 'antd';
import { Link } from 'react-router';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { Augenbraue, useRollen } from './instrument';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from './SeitenZustand';
import { useViewport } from './useViewport';
import { useDruckModus } from './druck/useDruckModus';
import { FENSTER_EINTRAG, FENSTER_ENDE, useFensterAusschnitt } from './fensterAusschnitt';
import { flachZufluss, useZuflussSchleuse, useZuflussSteuerung } from './useZuflussSchleuse';

/**
 * Das Muster „Liste + Detailpaneel“ (Spec `liste-detail`, Change
 * `oxgob5gk-auftraege-befehle-angleichen`, design.md D2): ab `lg` die Liste links und das Detail des
 * gewählten Objekts rechts, darunter klappt das Detail unter der gewählten Karte auf. Kein Drawer,
 * kein Overlay, kein Seitenwechsel (`frontend/AGENTS.md`, „UI-Form-Leitlinie“).
 *
 * Der Baustein weiß nichts vom Fach. Er trägt Anordnung, Wahl, Zustände, den Sprung eines Deeplinks,
 * den Zufluss der Liste (`useZuflussSchleuse`, dieselbe Schleuse wie die `Datensicht`) und den
 * Ausschnitt großer Listen. Wahl und Sprung hält der Aufrufer (kontrolliert): sein Deeplink setzt
 * beides, und eine Wahl über {@link ListeDetailProps.onWahl} räumt bei ihm die Markierung.
 *
 * DIE KARTE TRÄGT KEINE HANDLUNG (design.md D3): genau ein Auswahlziel ({@link AuswahlZiel}) und
 * höchstens Kennungs-Links. Ein Knopf in einer Karte, die selbst wählt, wäre ein verschachteltes
 * Bedienziel, und der Zufluss schöbe ihn unter dem Zeiger weg. Handlungen stehen im Detail.
 */

/** Ab wie vielen Einträgen eine Liste mit `fenster` nur ihren Ausschnitt rendert. */
export const LISTE_DETAIL_SCHWELLE = 50;
/** Startschätzung einer Karte, bis gemessen ist (px). */
const KARTE_SCHAETZUNG = 160;

export interface ListeDetailGruppen<T> {
  von: (eintrag: T) => string;
  etikett: (gruppe: string, anzahl: number) => string;
  /** Folge der Gruppen; Einträge einer unbekannten Gruppe stehen am Ende. */
  reihenfolge: readonly string[];
}

export interface ListeDetailFehler {
  text: string;
  ursache?: unknown;
  onWiederholen: () => void;
}

/** Die Eigenschaften des Auswahlziels einer Karte; der Baustein setzt sie, die Karte reicht sie durch. */
export interface AuswahlZielProps {
  onClick: () => void;
  /** Ab `lg`: das gewählte Objekt ist das aktuelle. */
  'aria-current'?: 'true';
  /** Unter `lg`: das Detail klappt unter dieser Karte auf. */
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
}

export interface KartenZustand {
  gewaehlt: boolean;
  /** Angesprungen per Deeplink (Spec `deeplink-hervorhebung`). */
  hervorgehoben: boolean;
  /** Je Eintrag ein stabiles Objekt, solange Wahl und Breite gleich bleiben: Karten bleiben `memo`. */
  auswahl: AuswahlZielProps;
}

export interface ListeDetailProps<T> {
  /** Zugänglicher Name der Liste („Aufträge“). */
  bezeichnung: string;
  /** In der Folge, in der sie stehen sollen; mit `gruppen` innerhalb jeder Gruppe. */
  eintraege: readonly T[];
  schluessel: (eintrag: T) => number;
  gewaehlt: number | null;
  /** Wahl von Hand, Vorauswahl ab `lg` und Zuklappen unter `lg` (`null`). */
  onWahl: (id: number | null) => void;
  /** Deeplink-Sprung: markiert und holt die Karte einmal je `nr` in den Blick. */
  sprung?: { id: number; nr: number } | null;
  karte: (eintrag: T, zustand: KartenZustand) => ReactNode;
  detail: (eintrag: T, zustand: { entfallen: boolean }) => ReactNode;
  /**
   * Frischer Stand eines Objekts, das aus der Menge gefallen ist (Spec „Gewähltes Objekt
   * entfällt“): etwa die Antwort der Handlung, die es hinausgeschoben hat. Ohne Treffer zeigt das
   * Detail den zuletzt gesehenen Stand.
   */
  resolve?: (id: number) => T | undefined;
  gruppen?: ListeDetailGruppen<T>;
  /** Erste Lieferung läuft: Skelett, keine Aussage über die Menge. */
  ladend?: boolean;
  /** Gescheiterter Abruf: ohne Bestand Fehlerzustand, mit Bestand Hinweis auf alten Stand. */
  fehler?: ListeDetailFehler | null;
  /** Leerzustand des Aufrufers (`SeitenLeer`, mit Schreibrecht samt Erfassen-Aktion). */
  leer?: ReactNode;
  /** Unter der Liste, etwa „Ältere laden“. */
  fuss?: ReactNode;
  /** Ab {@link LISTE_DETAIL_SCHWELLE} Einträgen nur den Sichtbereich rendern (nur ohne `gruppen`). */
  fenster?: boolean;
}

/**
 * Stil des Auswahlziels (`frontend/AGENTS.md`, „Handgebautes Bedienziel“): der Boden aus
 * `controlHeight`, KEINE eigene Polsterung. Die trägt die Karte (`KommKarte`), und ein Klick auf
 * sie wählt über den Kartenhalter von {@link ListeDetail}; eine zweite Polsterung verdoppelte sie.
 */
export function auswahlZielStil(token: { controlHeight: number }) {
  return {
    display: 'block',
    width: '100%',
    minHeight: token.controlHeight,
    margin: 0,
    padding: 0,
    border: 0,
    background: 'none',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
  } as const;
}

/**
 * Das Auswahlziel einer Karte: ein echter Knopf über die ganze Kartenbreite, damit Enter und
 * Leertaste wählen. `name` ist der zugängliche Name und nennt die Kennung („Auftrag #4: …“), der
 * sichtbare Inhalt darf gekürzt sein.
 */
export function AuswahlZiel({
  name,
  children,
  style,
  ...ziel
}: AuswahlZielProps & { name?: string; children: ReactNode; style?: CSSProperties }) {
  const { token } = useRollen();
  return (
    <button
      type="button"
      data-lfh="auswahl-ziel"
      aria-label={name}
      {...ziel}
      style={{ ...auswahlZielStil(token), ...style }}
    >
      {children}
    </button>
  );
}

/**
 * Ein Sprung im Detail (LFH-616, „Ein Sprung ist keine Handlung“): eine Zeile mit Pfeil, als Link
 * mit der Steuerhöhe der Stufe (`frontend/AGENTS.md`, Handgebautes Bedienziel), nie als Knopf.
 */
export function DetailSprung({ ziel, children }: { ziel: string; children: ReactNode }) {
  const { token } = useRollen();
  return (
    <Link
      to={ziel}
      data-lfh="inspector-sprung"
      style={{ display: 'inline-flex', alignItems: 'center', minHeight: token.controlHeight }}
    >
      {children}&nbsp;<span aria-hidden="true">↗</span>
    </Link>
  );
}

/** Ein Klick auf ein eigenes Bedienziel der Karte (Kennungs-Link, Auswahlziel) wählt nicht doppelt. */
const EIGENES_ZIEL = 'a, button, input, textarea, select, [role="button"]';

function sortByGruppe<T>(
  eintraege: readonly T[],
  gruppen: ListeDetailGruppen<T> | undefined,
): readonly T[] {
  if (!gruppen) return eintraege;
  const rang = (g: string) => {
    const i = gruppen.reihenfolge.indexOf(g);
    return i < 0 ? gruppen.reihenfolge.length : i;
  };
  // Stabil: innerhalb der Gruppe bleibt die Folge des Aufrufers.
  return eintraege
    .map((e, i) => ({ e, i, r: rang(gruppen.von(e)) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ e }) => e);
}

export default function ListeDetail<T>({
  bezeichnung,
  eintraege,
  schluessel,
  gewaehlt,
  onWahl,
  sprung = null,
  karte,
  detail,
  resolve,
  gruppen,
  ladend = false,
  fehler = null,
  leer,
  fuss,
  fenster = false,
}: ListeDetailProps<T>) {
  const { token } = useRollen();
  const { abBreite } = useViewport();
  const breit = abBreite('lg');
  const druckt = useDruckModus();
  const detailId = useId();
  const liste = useRef<HTMLUListElement>(null);
  const start = useRef<HTMLDivElement>(null);

  // ── Zufluss (Spec `liste-detail`, „Zufluss hält die Folge“) ─────────────────────────────
  const geordnet = useMemo(() => sortByGruppe(eintraege, gruppen), [eintraege, gruppen]);
  const zufluss = useZuflussSteuerung<T>();
  const zuflussBereich = useZuflussSchleuse(zufluss, {
    zeilen: geordnet,
    schluessel,
    aktiv: true,
    gruppeVon: gruppen?.von,
    mitGerippe: false,
    wurzel: liste,
  });
  const gefroren = zufluss.stand.art === 'gefroren' ? zufluss.stand.folge : null;
  const gefroreneGruppeVon = zufluss.stand.art === 'gefroren' ? zufluss.stand.gruppeVon : null;
  // Im Druck gilt die Schleuse nicht (wie in der `Datensicht`).
  const { sichtbar, banner } = useMemo(() => {
    if (!gefroren || druckt) return { sichtbar: geordnet, banner: null };
    const flach = flachZufluss(gefroren, geordnet, schluessel);
    return { sichtbar: flach.zeilen, banner: flach.banner };
  }, [gefroren, druckt, geordnet, schluessel]);

  // ── Wahl ────────────────────────────────────────────────────────────────────────────────
  /**
   * Das zuletzt gesehene gewählte Objekt (Spec „Gewähltes Objekt entfällt“): fällt es aus der
   * Menge, zeigt das Detail diesen Stand weiter, bis eine andere Wahl fällt.
   */
  const zuletzt = useRef<{ id: number; eintrag: T; vorgaenger: number | null } | null>(null);
  const aktuell = gewaehlt == null ? undefined : eintraege.find((e) => schluessel(e) === gewaehlt);
  const gemerkt = zuletzt.current?.id === gewaehlt ? zuletzt.current : null;
  const entfallen = aktuell === undefined && gemerkt != null;
  const detailEintrag =
    aktuell ?? (entfallen ? (resolve?.(gewaehlt!) ?? gemerkt.eintrag) : undefined);

  useLayoutEffect(() => {
    if (gewaehlt == null) {
      zuletzt.current = null;
      return;
    }
    if (aktuell === undefined) return;
    // Der Vorgänger in der gezeigten Folge: unter `lg` bleibt ein entfallenes Detail hinter ihm
    // stehen, statt ans Ende der Liste zu springen (Spec `liste-detail`, „Kein Sprung“).
    const i = sichtbar.findIndex((e) => schluessel(e) === gewaehlt);
    const vorgaenger = i > 0 ? schluessel(sichtbar[i - 1]) : null;
    zuletzt.current = { id: gewaehlt, eintrag: aktuell, vorgaenger };
  });
  /** Wo das entfallene Detail unter `lg` steht: hinter seinem Vorgänger, sonst am Anfang. */
  const entfallenHinter = entfallen ? gemerkt.vorgaenger : null;
  const entfallenOrt: 'hinter' | 'anfang' | 'ende' | null = !entfallen
    ? null
    : entfallenHinter == null
      ? 'anfang'
      : sichtbar.some((e) => schluessel(e) === entfallenHinter)
        ? 'hinter'
        : 'ende';

  /** Vorauswahl ab `lg`: das erste Objekt der gezeigten Folge, ohne den Fokus zu bewegen. */
  const erster = sichtbar.length > 0 ? schluessel(sichtbar[0]) : null;
  useEffect(() => {
    if (breit && gewaehlt == null && erster != null) onWahl(erster);
    // `onWahl` ist meist eine Inline-Closure; getaktet wird über Breite, Wahl und Folge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breit, gewaehlt, erster]);

  // Stabile Wahl für die gemerkten Auswahlziele: der Ref trägt die jüngsten Werte.
  const wahlStand = useRef({ breit, gewaehlt, onWahl });
  useLayoutEffect(() => {
    wahlStand.current = { breit, gewaehlt, onWahl };
  });
  /*
   * Je Eintrag EIN Auswahlobjekt, solange Breite und Wahl dieses Eintrags gleich bleiben (LFH-949):
   * ein Live-Ereignis bringt eine neue Folge, und ein neues Objekt je Karte machte jede `memo`-Karte
   * neu. Der Cache hält die Objekte über Folgen hinweg; nur die gewählte und die abgewählte Karte
   * bekommen ein neues.
   */
  const auswahlCache = useRef(
    new Map<number, { breit: boolean; isGewaehlt: boolean; props: AuswahlZielProps }>(),
  );
  const auswahlJe = useMemo(() => {
    const select = (id: number) => {
      const s = wahlStand.current;
      // Unter `lg` klappt die erneute Wahl der aufgeklappten Karte zu.
      s.onWahl(!s.breit && s.gewaehlt === id ? null : id);
    };
    const alt = auswahlCache.current;
    const neu = new Map<number, { breit: boolean; isGewaehlt: boolean; props: AuswahlZielProps }>();
    for (const e of sichtbar) {
      const id = schluessel(e);
      const isGewaehlt = id === gewaehlt;
      const vorher = alt.get(id);
      if (vorher && vorher.breit === breit && vorher.isGewaehlt === isGewaehlt) {
        neu.set(id, vorher);
        continue;
      }
      // `aria-controls` in jeder Breite: ab `lg` steuert die Wahl das Detail daneben.
      const props: AuswahlZielProps = {
        onClick: () => select(id),
        ...(breit
          ? isGewaehlt
            ? { 'aria-current': 'true' as const }
            : {}
          : { 'aria-expanded': isGewaehlt }),
        ...(isGewaehlt ? { 'aria-controls': detailId } : {}),
      };
      neu.set(id, { breit, isGewaehlt, props });
    }
    auswahlCache.current = neu;
    return new Map([...neu].map(([id, eintrag]) => [id, eintrag.props]));
  }, [sichtbar, schluessel, gewaehlt, breit, detailId]);

  const handleKarteClick = (e: ReactMouseEvent, id: number) => {
    if ((e.target as Element).closest?.(EIGENES_ZIEL)) return;
    auswahlJe.get(id)?.onClick();
  };

  // ── Ausschnitt (LFH-949) ────────────────────────────────────────────────────────────────
  const virtuell = fenster && !gruppen && !druckt && sichtbar.length > LISTE_DETAIL_SCHWELLE;
  const schluesselListe = useMemo(() => sichtbar.map(schluessel), [sichtbar, schluessel]);
  const { von, bis, oben, unten } = useFensterAusschnitt({
    schluessel: schluesselListe,
    aktiv: virtuell,
    schaetzung: KARTE_SCHAETZUNG,
    start,
    wurzel: liste,
    // Der Sprung, sonst die Wahl: ein vorgewähltes Objekt steht im Ausschnitt, ein entfallenes
    // hält seinen Vorgänger darin, damit das Detail an seiner Stelle bleibt.
    anker: sprung?.id ?? (entfallen ? entfallenHinter : gewaehlt),
  });

  // ── Sprung: einmal je Deeplink in den Blick, sobald die Karte im DOM steht ──────────────────
  const erledigterSprung = useRef<number | null>(null);
  useEffect(() => {
    if (sprung == null || erledigterSprung.current === sprung.nr) return;
    const ziel = liste.current?.querySelector(`[data-liste-detail-eintrag="${sprung.id}"]`);
    if (!ziel) return;
    ziel.scrollIntoView?.({ block: 'center' });
    erledigterSprung.current = sprung.nr;
  }, [sprung, sichtbar, von, bis]);

  // ── Rendern ─────────────────────────────────────────────────────────────────────────────
  const detailFlaeche =
    detailEintrag !== undefined ? (
      // Je Objekt neu eingehängt: kein Formular- oder Klappzustand wandert zum nächsten.
      // `tabIndex={-1}`: Ziel des Sprunglinks, nicht in der Tab-Folge.
      <div
        key={schluessel(detailEintrag)}
        id={detailId}
        data-lfh="liste-detail-detail"
        tabIndex={-1}
      >
        {detail(detailEintrag, { entfallen })}
      </div>
    ) : null;

  const renderEintrag = (e: T) => {
    const id = schluessel(e);
    const isGewaehlt = id === gewaehlt;
    return (
      <li
        key={id}
        data-liste-detail-eintrag={id}
        {...(virtuell ? { [FENSTER_EINTRAG]: String(id) } : {})}
        style={{ listStyle: 'none' }}
      >
        {/* Nur die Karte wählt per Klick; das Detail daneben ist ihr Geschwister, ein Klick
            darin klappt nichts zu. */}
        <div onClick={(ev) => handleKarteClick(ev, id)}>
          {karte(e, {
            gewaehlt: isGewaehlt,
            hervorgehoben: sprung?.id === id,
            auswahl: auswahlJe.get(id)!,
          })}
        </div>
        {/* Ab `lg` steht das Detail im DOM hinter der ganzen Liste: ein Sprunglink, sichtbar erst
            mit dem Fokus, erspart das Tabben durch alle übrigen Karten (WCAG 2.4.1). */}
        {breit && isGewaehlt && detailEintrag !== undefined && (
          <a
            href={`#${detailId}`}
            className="lfh-sprung-detail"
            onClick={(ev) => {
              ev.preventDefault();
              document.getElementById(detailId)?.focus({ preventScroll: true });
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: token.controlHeight,
              padding: `0 ${token.padding}px`,
            }}
          >
            Zum Detail
          </a>
        )}
        {/* Unter `lg` steht das Detail direkt unter seiner Karte, im selben Eintrag: so zählt seine
            Höhe im Ausschnitt zur Karte. */}
        {!breit &&
          (isGewaehlt || (entfallenOrt === 'hinter' && id === entfallenHinter)) &&
          detailFlaeche}
      </li>
    );
  };

  const listenStil: CSSProperties = { margin: 0, padding: 0 };
  const renderListe = () => {
    if (gruppen) {
      // Gruppiert wird über die eingefrorene Achse, solange die Schleuse zu ist.
      const gruppeVon = (e: T) => gefroreneGruppeVon?.get(schluessel(e)) ?? gruppen.von(e);
      const folge: string[] = [];
      const je = new Map<string, T[]>();
      for (const e of sichtbar) {
        const g = gruppeVon(e);
        if (!je.has(g)) {
          je.set(g, []);
          folge.push(g);
        }
        je.get(g)!.push(e);
      }
      return (
        <ul ref={liste} aria-label={bezeichnung} style={listenStil} {...zuflussBereich}>
          {folge.map((g) => (
            <li key={g} style={{ listStyle: 'none', marginBottom: token.margin }}>
              <Augenbraue als="h4" style={{ display: 'block', marginBottom: token.marginXS }}>
                {gruppen.etikett(g, je.get(g)!.length)}
              </Augenbraue>
              <ul style={listenStil}>{je.get(g)!.map(renderEintrag)}</ul>
            </li>
          ))}
        </ul>
      );
    }
    if (!virtuell) {
      return (
        <ul ref={liste} aria-label={bezeichnung} style={listenStil} {...zuflussBereich}>
          {sichtbar.map(renderEintrag)}
        </ul>
      );
    }
    return (
      <ul ref={liste} aria-label={bezeichnung} style={listenStil} {...zuflussBereich}>
        <li aria-hidden style={{ listStyle: 'none' }}>
          <div ref={start} data-lfh="liste-detail-platzhalter" style={{ height: oben }} />
        </li>
        {sichtbar.slice(von, bis).map(renderEintrag)}
        <li
          aria-hidden
          data-lfh="liste-detail-platzhalter"
          {...{ [FENSTER_ENDE]: '' }}
          style={{ listStyle: 'none', height: unten }}
        />
      </ul>
    );
  };

  let listenSpalte: ReactNode;
  if (ladend && eintraege.length === 0) {
    listenSpalte = <SeitenSkeleton />;
  } else if (fehler != null && eintraege.length === 0) {
    listenSpalte = (
      <SeitenFehler
        text={fehler.text}
        ursache={fehler.ursache}
        onWiederholen={fehler.onWiederholen}
      />
    );
  } else {
    listenSpalte = (
      <>
        {fehler != null && (
          <div style={{ marginBottom: token.marginSM }}>
            <SeitenStandVeraltet onWiederholen={fehler.onWiederholen} />
          </div>
        )}
        {banner != null && (
          // Sammelbanner statt eingeschobener Karten (WCAG 3.2.5), wie in der `Datensicht`.
          <div data-lfh="liste-detail-stand" style={{ marginBottom: token.marginXS }}>
            <Button type="primary" onClick={zufluss.nachBenutzeraktion}>
              {banner}
            </Button>
          </div>
        )}
        {sichtbar.length === 0 ? leer : renderListe()}
        {fuss}
      </>
    );
  }

  if (!breit) {
    return (
      <div data-lfh="liste-detail">
        {/* Ein entfallenes Objekt steht nicht mehr in der Liste; sein Detail bleibt an seiner
            Stelle: hinter dem Vorgänger, als erstes vor der Liste, sonst hinter ihr. */}
        {entfallenOrt === 'anfang' && detailFlaeche}
        {listenSpalte}
        {entfallenOrt === 'ende' && detailFlaeche}
      </div>
    );
  }
  return (
    <div
      data-lfh="liste-detail"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(340px, 2fr) minmax(0, 3fr)',
        gap: token.margin,
        alignItems: 'start',
      }}
    >
      <div style={{ minWidth: 0 }}>{listenSpalte}</div>
      {/* Klebt unter dem Rahmen, damit das Detail beim Scrollen der Liste im Blick bleibt. */}
      <div
        data-lfh="liste-detail-spalte"
        style={{
          position: 'sticky',
          top: `calc(var(--lfh-rahmen-oben, 0px) + ${token.margin}px)`,
          minWidth: 0,
        }}
      >
        {detailFlaeche}
      </div>
    </div>
  );
}
