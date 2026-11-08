import { useDroppable } from '@dnd-kit/core';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { monoStil, useRollen } from '../../components/instrument';
import { statusFlaeche, type StatusTon } from '../../components/instrument/statusFlaeche';
import {
  griffAn,
  griffKanten,
  KANTE_PX,
  markenSchritt,
  pruefeZug,
  pxJeStunde,
  STUNDE_MS,
  stundenMarken,
  xAusZeit,
  zeitAusX,
  zugStand,
  type Ampel,
  type RasterBlock,
  type RasterZeile,
  type Spanne,
  type Zug,
  type ZugPruefung,
  type ZugStand,
} from './raster';

const KEINE_KANTEN = { anfang: false, ende: false } as const;

/**
 * Das Raster des Schichtplans (LLH-1554, Konzept LLH-1523 Abschnitt 6): Zeilen = Posten,
 * Spalten = Zeit, Jetzt-Linie, Blöcke mit Ampel und Wort. Fachneutral: Zeilen und Blöcke kommen
 * vom Aufrufer (`raster.ts`), die Vorplanung ohne Einsatz (LLH-1561) nimmt dasselbe Raster.
 *
 * Bedienung wie die Schichtplanung der Suite: in einer Zeile einen Zeitbereich aufziehen legt
 * einen Block an, einen Block ziehen verschiebt ihn (auch in eine andere Zeile), seine Kanten
 * ändern die Dauer, Raster 5 Minuten. Mit Strg oder Alt beim Loslassen wird aus dem Verschieben
 * eine Kopie (LLH-1584, `onKopieren`); die Taste darf erst während des Zugs dazukommen, wie beim
 * Kopieren im Dateimanager. Beide Tasten gelten auf jedem System: Alt/⌥ ist der Weg am Mac, wo
 * Strg-Klick das Kontextmenü öffnet. Gezogen wird nur mit Maus oder Stift: auf Touch rollt der
 * Finger die Fläche, ein Tipp auf einen Block öffnet ihn (Konzept: „Auf Touch wird nicht
 * gezeichnet“). Jeder Block ist ein Knopf; den Weg ohne Ziehen tragen der Blockdialog und „Block
 * anlegen“ der Ansicht (WCAG 2.5.7).
 *
 * Personen zieht der Aufrufer mit dnd-kit (`ZugPointerSensor`) auf die Blöcke: mit
 * `personenZiel` meldet sich jeder Block als Ziel mit `{ blockId }` in seinen Daten.
 *
 * Der Zug läuft über Zeiger-Ereignisse am Dokument (nicht über dnd-kit): die Zeit unter dem Zeiger
 * rechnet `raster.ts`, die Zeile liest `elementFromPoint`. Was der Server ablehnte
 * (Überschneidung, unter 10 Minuten), sendet das Raster nicht; der Schatten nennt den Grund.
 */

export interface SchichtplanRasterProps {
  zeilen: readonly RasterZeile[];
  bloecke: readonly RasterBlock[];
  spanne: Spanne;
  /** Jetzt-Linie; ohne keine. */
  jetzt?: number;
  /** Ohne Schreibrecht nur Antippen. */
  darfSchreiben: boolean;
  /** Anzeigezone für die Stundenmarken. */
  zone: string | null | undefined;
  /** Beschriftung einer Stundenmarke. */
  formatMarke: (ms: number) => string;
  /** Uhrzeit im zugänglichen Namen und am Schatten. */
  formatZeit: (ms: number) => string;
  onAnlegen: (zeile: string, von: number, bis: number) => void;
  onAendern: (blockId: number, stand: ZugStand) => void;
  /** Ein verschobener Block mit Strg/Alt: Kopie an den Stand. Ohne gibt es keine Kopie per Zug. */
  onKopieren?: (blockId: number, stand: ZugStand) => void;
  onOeffnen: (blockId: number) => void;
  /** Blöcke nehmen gezogene Personen an (dnd-kit-Kontext beim Aufrufer). */
  personenZiel?: boolean;
  /** Zugänglicher Name der Fläche. */
  beschriftung: string;
}

/** Breite der Titelspalte. */
const TITEL_BREITE = 168;
/** Unter dieser Stundenbreite rollt das Raster waagerecht (5 min = 4 px). */
const MINDEST_JE_STUNDE = 48;
/** Kantenbreite zum Ziehen der Dauer. */
/** Ab so vielen Pixeln Weg wird aus einem Druck ein Zug. */
const ZUG_SCHWELLE_PX = 4;
/** Marken näher am Rand stehen bündig. */
const RAND_PX = 24;

const AMPEL_TON: Record<Ampel, StatusTon> = {
  besetzt: 'normal',
  luecke: 'achtung',
  befund: 'alarm',
  'ohne-soll': 'neutral',
};

const PRUEFUNG_TEXT: Record<Exclude<ZugPruefung, 'ok' | 'unveraendert'>, string> = {
  'zu-kurz': 'unter 10 min',
  ueberschneidung: 'überschneidet',
  'keine-zeile': 'kein Posten',
};

/** Breite des Elements, mit Vorgabe vor der ersten Messung (und in jsdom). */
function useBreite<T extends HTMLElement>(vorgabe: number) {
  const ref = useRef<T | null>(null);
  const [breite, setBreite] = useState(vorgabe);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const miss = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setBreite(w);
    };
    miss();
    const ro = new ResizeObserver(miss);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, breite] as const;
}

/** Zeile unter dem Zeiger, über `data-raster-zeile`. */
function zeileAn(x: number, y: number): string | null {
  const el = document.elementFromPoint?.(x, y);
  return el?.closest('[data-raster-zeile]')?.getAttribute('data-raster-zeile') ?? null;
}

interface LaufenderZug {
  zug: Zug;
  stand: ZugStand;
  pruefung: ZugPruefung;
  /** Erst ab der Schwelle wird gezogen; vorher ist es ein Klick. */
  aktiv: boolean;
  /** Strg oder Alt gehalten: Kopie statt Verschieben (nur beim Verschieben). */
  kopie: boolean;
  startX: number;
  startY: number;
  pointerId: number;
}

export default function SchichtplanRaster({
  zeilen,
  bloecke,
  spanne,
  jetzt,
  darfSchreiben,
  zone,
  formatMarke,
  formatZeit,
  onAnlegen,
  onAendern,
  onKopieren,
  onOeffnen,
  personenZiel = false,
  beschriftung,
}: SchichtplanRasterProps) {
  const { token, rollen } = useRollen();
  const [aussenRef, aussenBreite] = useBreite<HTMLDivElement>(960);
  const spurRef = useRef<HTMLDivElement | null>(null);
  const zeilenHoehe = token.controlHeight + 2 * token.paddingXXS;
  const pxStunde = pxJeStunde(aussenBreite - TITEL_BREITE - 2, spanne, MINDEST_JE_STUNDE);
  const zeitBreite = Math.round(((spanne.bis - spanne.von) / STUNDE_MS) * pxStunde);
  const marken = stundenMarken(spanne, zone, markenSchritt(pxStunde));
  const [lauf, setLauf] = useState<LaufenderZug | null>(null);
  const laufRef = useRef<LaufenderZug | null>(null);
  laufRef.current = lauf;
  // Nach einem Zug schluckt das Raster den Klick, der dem Loslassen folgt (sonst öffnete er den
  // Block).
  const klickSchlucken = useRef(false);

  const zeitAmZeiger = useCallback(
    (clientX: number) => {
      const links = spurRef.current?.getBoundingClientRect().left ?? 0;
      return zeitAusX(clientX - links, zeitBreite, spanne);
    },
    [zeitBreite, spanne],
  );

  // Kopie nur beim Verschieben und nur, wenn der Aufrufer sie annimmt.
  const kannKopieren = onKopieren != null;
  const alsKopie = useCallback(
    (zug: Zug, tasten: { ctrlKey: boolean; altKey: boolean }) =>
      kannKopieren && zug.art === 'verschieben' && (tasten.ctrlKey || tasten.altKey),
    [kannKopieren],
  );

  const starte = (e: ReactPointerEvent, zug: Zug, zeile: string) => {
    if (!darfSchreiben || e.pointerType === 'touch' || e.button !== 0) return;
    const stand = zugStand(zug, zeitAmZeiger(e.clientX), zeile);
    const kopie = alsKopie(zug, e);
    setLauf({
      zug,
      stand,
      pruefung: pruefeZug(zug, stand, zeilen, bloecke, kopie),
      aktiv: false,
      kopie,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
    });
  };

  // Der Zug folgt dem Zeiger am Dokument, damit er über Zeilen und Blöcke hinweg läuft.
  const laeuft = lauf != null;
  useEffect(() => {
    if (!laeuft) return;
    const bewegen = (e: PointerEvent) => {
      const l = laufRef.current;
      if (!l || e.pointerId !== l.pointerId) return;
      const aktiv =
        l.aktiv ||
        Math.abs(e.clientX - l.startX) >= ZUG_SCHWELLE_PX ||
        Math.abs(e.clientY - l.startY) >= ZUG_SCHWELLE_PX;
      if (!aktiv) return;
      e.preventDefault();
      // Neben dem Raster bleibt die letzte Zeile, statt den Schatten zu verlieren.
      const zeile =
        l.zug.art === 'verschieben'
          ? (zeileAn(e.clientX, e.clientY) ?? l.stand.zeile)
          : l.stand.zeile;
      const stand = zugStand(l.zug, zeitAmZeiger(e.clientX), zeile);
      const kopie = alsKopie(l.zug, e);
      setLauf({
        ...l,
        aktiv: true,
        stand,
        kopie,
        pruefung: pruefeZug(l.zug, stand, zeilen, bloecke, kopie),
      });
    };
    const loslassen = (e: PointerEvent) => {
      const l = laufRef.current;
      if (!l || e.pointerId !== l.pointerId) return;
      setLauf(null);
      if (!l.aktiv) return;
      klickSchlucken.current = true;
      // Der Klick folgt dem Loslassen unmittelbar; danach gilt wieder jeder Klick.
      window.setTimeout(() => {
        klickSchlucken.current = false;
      }, 0);
      // Die Tasten beim Loslassen entscheiden; pointercancel trägt keine verlässlichen.
      const kopie = e.type === 'pointerup' ? alsKopie(l.zug, e) : l.kopie;
      if (pruefeZug(l.zug, l.stand, zeilen, bloecke, kopie) !== 'ok') return;
      if (l.zug.art === 'anlegen') onAnlegen(l.stand.zeile, l.stand.von, l.stand.bis);
      else if (kopie) onKopieren?.(l.zug.blockId, l.stand);
      else onAendern(l.zug.blockId, l.stand);
    };
    // Strg/Alt drücken oder lösen, ohne den Zeiger zu bewegen, schaltet den Schatten gleich um.
    const tasten = (e: KeyboardEvent) => {
      if (e.type === 'keydown' && e.key === 'Escape') {
        setLauf(null);
        return;
      }
      if (e.key !== 'Control' && e.key !== 'Alt') return;
      const l = laufRef.current;
      if (!l) return;
      // Alt allein holte in Firefox und unter Windows die Menüleiste nach vorn.
      e.preventDefault();
      const kopie = alsKopie(l.zug, e);
      if (kopie === l.kopie) return;
      setLauf({ ...l, kopie, pruefung: pruefeZug(l.zug, l.stand, zeilen, bloecke, kopie) });
    };
    document.addEventListener('pointermove', bewegen);
    document.addEventListener('pointerup', loslassen);
    document.addEventListener('pointercancel', loslassen);
    document.addEventListener('keydown', tasten);
    document.addEventListener('keyup', tasten);
    return () => {
      document.removeEventListener('pointermove', bewegen);
      document.removeEventListener('pointerup', loslassen);
      document.removeEventListener('pointercancel', loslassen);
      document.removeEventListener('keydown', tasten);
      document.removeEventListener('keyup', tasten);
    };
  }, [laeuft, zeitAmZeiger, zeilen, bloecke, onAnlegen, onAendern, onKopieren, alsKopie]);

  const schatten = lauf?.aktiv ? lauf : null;
  // Bei einer Kopie bleibt das Original voll sichtbar.
  const gezogenerBlock =
    schatten && schatten.zug.art !== 'anlegen' && !schatten.kopie ? schatten.zug.blockId : null;
  const x = (t: number) => xAusZeit(t, zeitBreite, spanne);
  const jetztX = jetzt != null && jetzt >= spanne.von && jetzt <= spanne.bis ? x(jetzt) : null;

  const titelZelle: CSSProperties = {
    position: 'sticky',
    left: 0,
    zIndex: 2,
    width: TITEL_BREITE,
    minWidth: TITEL_BREITE,
    background: rollen.paneel,
    borderRight: `1px solid ${rollen.linie}`,
    paddingInline: token.paddingSM,
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
  };

  let letzteGruppe: string | null | undefined;
  return (
    <div
      ref={aussenRef}
      role="region"
      aria-label={beschriftung}
      data-lfh="schichtplan-raster"
      data-zug={schatten ? (schatten.kopie ? 'kopieren' : schatten.zug.art) : undefined}
      style={{
        overflowX: 'auto',
        border: `1px solid ${rollen.linie}`,
        background: rollen.paneel,
        // Ein Zug markiert keinen Text.
        userSelect: lauf ? 'none' : undefined,
      }}
    >
      <div style={{ width: TITEL_BREITE + zeitBreite, position: 'relative' }}>
        {/* Achse */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${rollen.linie}` }}>
          <div style={{ ...titelZelle, minHeight: token.controlHeightSM }} />
          <div
            aria-hidden="true"
            data-lfh="schichtplan-achse"
            style={{ position: 'relative', width: zeitBreite, height: token.controlHeightSM }}
          >
            {marken.map((m) => (
              <span
                key={m}
                style={{
                  position: 'absolute',
                  left: x(m),
                  // Am Rand bündig statt mittig: sonst läge die halbe Marke unter der Titelspalte.
                  transform:
                    x(m) < RAND_PX
                      ? 'translateX(2px)'
                      : x(m) > zeitBreite - RAND_PX
                        ? 'translateX(calc(-100% - 2px))'
                        : 'translateX(-50%)',
                  bottom: 2,
                  color: rollen.gedaempft,
                  ...monoStil(11),
                  whiteSpace: 'nowrap',
                }}
              >
                {formatMarke(m)}
              </span>
            ))}
          </div>
        </div>
        {zeilen.map((z) => {
          const kopf = z.gruppe !== letzteGruppe && z.gruppe != null;
          letzteGruppe = z.gruppe;
          // Nur was die Spanne berührt: ein Block davor oder danach läge sonst als Streifen am Rand
          // oder machte die Rollfläche breiter als die Achse.
          const eigene = bloecke.filter(
            (b) => b.zeile === z.schluessel && b.bis > spanne.von && b.von < spanne.bis,
          );
          return (
            <Fragment key={z.schluessel}>
              {kopf && (
                <div
                  data-lfh="schichtplan-gruppe"
                  style={{
                    ...titelZelle,
                    width: TITEL_BREITE + zeitBreite,
                    position: 'relative',
                    minHeight: token.controlHeightSM,
                    color: rollen.gedaempft,
                    fontWeight: 600,
                    borderBottom: `1px solid ${rollen.linie}`,
                    background: rollen.flaeche3,
                  }}
                >
                  <span style={{ position: 'sticky', left: token.paddingSM }}>{z.gruppe}</span>
                </div>
              )}
              <div
                data-raster-zeile={z.schluessel}
                data-lfh="schichtplan-zeile"
                style={{ display: 'flex', borderBottom: `1px solid ${rollen.linie}` }}
              >
                <div style={{ ...titelZelle, minHeight: zeilenHoehe }} title={z.titel}>
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {z.titel}
                  </span>
                </div>
                <div
                  ref={spurRef}
                  data-lfh="schichtplan-spur"
                  onPointerDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    starte(
                      e,
                      { art: 'anlegen', zeile: z.schluessel, start: zeitAmZeiger(e.clientX) },
                      z.schluessel,
                    );
                  }}
                  style={{
                    position: 'relative',
                    width: zeitBreite,
                    height: zeilenHoehe,
                    cursor: darfSchreiben ? 'crosshair' : undefined,
                    backgroundImage: marken.length
                      ? `linear-gradient(to right, ${rollen.rasterLinie} 1px, transparent 1px)`
                      : undefined,
                    backgroundSize: `${pxStunde}px 100%`,
                    backgroundPositionX: x(Math.ceil(spanne.von / STUNDE_MS) * STUNDE_MS),
                  }}
                >
                  {eigene.map((b) => {
                    const breite = Math.max(
                      2,
                      x(Math.min(b.bis, spanne.bis)) - x(Math.max(b.von, spanne.von)),
                    );
                    return (
                      <BlockKachel
                        key={b.id}
                        block={b}
                        zeileTitel={z.titel}
                        links={x(Math.max(b.von, spanne.von))}
                        breite={breite}
                        kanten={darfSchreiben ? griffKanten(b, spanne, breite) : KEINE_KANTEN}
                        hoehe={zeilenHoehe}
                        laeuft={jetzt != null && b.von <= jetzt && jetzt < b.bis}
                        gezogen={gezogenerBlock === b.id}
                        darfSchreiben={darfSchreiben}
                        personenZiel={personenZiel}
                        formatZeit={formatZeit}
                        onDruck={(e, art) => {
                          const zeit = zeitAmZeiger(e.clientX);
                          const zug: Zug =
                            art === 'verschieben'
                              ? { art, blockId: b.id, von: b.von, bis: b.bis, griff: zeit - b.von }
                              : { art, blockId: b.id, zeile: b.zeile, von: b.von, bis: b.bis };
                          starte(e, zug, b.zeile);
                        }}
                        onKlick={() => {
                          if (klickSchlucken.current) return;
                          onOeffnen(b.id);
                        }}
                      />
                    );
                  })}
                  {schatten && schatten.stand.zeile === z.schluessel && (
                    <div
                      data-lfh="schichtplan-schatten"
                      data-pruefung={schatten.pruefung}
                      data-kopie={schatten.kopie || undefined}
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        left: x(schatten.stand.von),
                        width: Math.max(2, x(schatten.stand.bis) - x(schatten.stand.von)),
                        top: token.paddingXXS,
                        bottom: token.paddingXXS,
                        border: `2px dashed ${schatten.pruefung === 'ok' || schatten.pruefung === 'unveraendert' ? rollen.bedien : rollen.alarm}`,
                        background: rollen.auswahlFlaeche,
                        pointerEvents: 'none',
                        zIndex: 3,
                        ...monoStil(11),
                        color: rollen.text,
                        paddingInline: 4,
                        whiteSpace: 'nowrap',
                        overflow: 'visible',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {`${formatZeit(schatten.stand.von)}–${formatZeit(schatten.stand.bis)}`}
                      {schatten.kopie ? ' · Kopie' : ''}
                      {schatten.pruefung !== 'ok' && schatten.pruefung !== 'unveraendert'
                        ? ` · ${PRUEFUNG_TEXT[schatten.pruefung]}`
                        : ''}
                    </div>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
        {jetztX != null && (
          <div
            aria-hidden="true"
            data-lfh="schichtplan-jetzt"
            style={{
              position: 'absolute',
              left: TITEL_BREITE + jetztX,
              top: 0,
              bottom: 0,
              width: 2,
              background: rollen.bedien,
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        )}
      </div>
    </div>
  );
}

interface BlockKachelProps {
  block: RasterBlock;
  zeileTitel: string;
  links: number;
  /** Kanten mit Griff; eine Kante außerhalb der Spanne ist der Fensterrand und hat keinen. */
  kanten: { anfang: boolean; ende: boolean };
  breite: number;
  hoehe: number;
  laeuft: boolean;
  gezogen: boolean;
  darfSchreiben: boolean;
  personenZiel: boolean;
  formatZeit: (ms: number) => string;
  onDruck: (e: ReactPointerEvent, art: 'verschieben' | 'anfang' | 'ende') => void;
  onKlick: () => void;
}

/** Daten eines Blocks als Ziel gezogener Personen. */
export interface BlockZielDaten {
  blockId: number;
  name: string;
}

function BlockKachel({
  block,
  zeileTitel,
  links,
  kanten,
  breite,
  hoehe,
  laeuft,
  gezogen,
  darfSchreiben,
  personenZiel,
  formatZeit,
  onDruck,
  onKlick,
}: BlockKachelProps) {
  const { token, rollen } = useRollen();
  const zeit = `${formatZeit(block.von)}–${formatZeit(block.bis)}`;
  const name = `${zeileTitel} ${zeit}`;
  const instanz = useId();
  const { setNodeRef, isOver } = useDroppable({
    id: `schichtplan-block-${block.id}${instanz}`,
    data: { blockId: block.id, name } satisfies BlockZielDaten,
    disabled: !personenZiel,
  });
  const ton = statusFlaeche(rollen, AMPEL_TON[block.ampel]);
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-lfh="schichtplan-block"
      data-block-id={block.id}
      data-ampel={block.ampel}
      data-laeuft={laeuft || undefined}
      aria-label={`${name}, ${block.text}, ${block.ampelWort}`}
      title={`${zeit} · ${block.text} · ${block.ampelWort}`}
      onClick={onKlick}
      onPointerDown={(e) => {
        const rand = e.currentTarget.getBoundingClientRect();
        onDruck(e, griffAn(e.clientX - rand.left, rand.width, kanten));
      }}
      style={{
        position: 'absolute',
        left: links,
        width: breite,
        top: token.paddingXXS,
        height: hoehe - 2 * token.paddingXXS,
        minWidth: 2,
        padding: 0,
        paddingInline: Math.min(token.paddingXS, Math.max(0, breite / 4)),
        margin: 0,
        border: `1px solid ${ton.kante}`,
        borderLeftWidth: 3,
        outline: isOver ? `2px solid ${rollen.bedien}` : undefined,
        outlineOffset: 1,
        boxShadow: laeuft ? `inset 0 0 0 1px ${ton.kante}` : undefined,
        background: ton.grund,
        color: ton.text,
        opacity: gezogen ? 0.4 : 1,
        cursor: darfSchreiben ? 'grab' : 'pointer',
        overflow: 'hidden',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        lineHeight: 1.2,
        fontWeight: laeuft ? 600 : 400,
        zIndex: 2,
      }}
    >
      <span style={{ ...monoStil(11), whiteSpace: 'nowrap' }}>
        {zeit} · {block.ampelWort}
      </span>
      <span
        style={{
          fontSize: 12,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
        }}
      >
        {block.text}
      </span>
      {kanten.anfang && <span aria-hidden="true" style={kanteStil('left')} />}
      {kanten.ende && <span aria-hidden="true" style={kanteStil('right')} />}
    </button>
  );
}

function kanteStil(seite: 'left' | 'right'): CSSProperties {
  return {
    position: 'absolute',
    [seite]: 0,
    insetBlock: 0,
    width: KANTE_PX,
    cursor: 'ew-resize',
  };
}
