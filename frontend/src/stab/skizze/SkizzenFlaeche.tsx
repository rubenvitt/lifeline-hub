/**
 * Die Zeichenfläche der taktischen Fernmeldeskizze (LFH-893 D1, D4, D6): ein SVG mit eigener
 * Ansicht (`viewBox`), Elemente als SVG-Gruppen mit `role`, `aria-label` und rovingem `tabindex`.
 *
 * - **Ansicht:** eingepasst, bis jemand zoomt; Zoom über die Knöpfe der Werkzeugleiste, Strg+Rad
 *   (am Zeiger) und zwei Finger; Verschieben der Ansicht durch Ziehen auf leerer Fläche. Rechnung
 *   in `ansicht.ts`.
 * - **Ziehen** nur über `@dnd-kit/core` mit `ZugPointerSensor` (`frontend/AGENTS.md`, Drag &
 *   Drop); die Fläche liefert nur die Ziehquellen, das Ablegen entscheidet
 *   `FernmeldeskizzeBild.tsx` über die reinen Treffer in `geometrie.ts`.
 * - **Tastatur:** Tab/Umschalt+Tab wandern in der Fokusfolge (`bedienung.ts`) und verlassen die
 *   Fläche an den Enden; alle übrigen Tasten gibt die Fläche als `TastenBefehl` nach oben.
 * - **Ruhige Fläche** (D4): solange Zeiger (ohne Touch) oder Fokus in der Fläche liegen, meldet
 *   sie `onHalten(true)`; die Seite hält dann die auto-gelegten Plätze fest.
 * - **Druck:** ohne Bedienelemente, Hervorhebung, Filter, Wahl und Meldungen am Element,
 *   eingepasst über die ganze Ausdehnung (D13, Prüfliste O4).
 */
import { useDraggable, useDndContext } from '@dnd-kit/core';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useRollen } from '../../components/instrument';
import type { Fernmeldenetz, NetzStelle } from '../fernmeldeskizze';
import type { Platz, SkizzenLayout } from '../fernmeldeskizzeLayout';
import { schienenLinieY } from '../fernmeldeskizzeLayout';
import {
  radFaktor,
  verschiebeAnsicht,
  viewBoxAus,
  zoome,
  zuSkizze,
  zweiFinger,
  type Ansicht,
  type Groesse,
  type Punkt,
} from './ansicht';
import { naechsterFokus, tastenBefehl, type TastenBefehl } from './bedienung';
import type { ZiehDaten } from './wirkung';
import { SCHRIFTFELD, stichleitungen, type Stichleitung } from './ebenen';
import { stichleitungsPunkte, zeichenMitte, type Rechteck } from './geometrie';
import type { SchriftfeldBlock } from './schriftfeld';
import {
  BereichBild,
  NeuMarke,
  Rahmen,
  SchieneBild,
  SchriftfeldBild,
  StelleBild,
  StichBild,
  VerbindungBild,
  anzeigeName,
  rufnamenZeile,
  type Zustand,
} from './SkizzenElemente';

/** Ab dieser Dauer öffnet ein Druck ohne Bewegung das Kontextmenü (Touch). */
export const LANGDRUCK_MS = 550;
const LANGDRUCK_WEG = 8;
/** Größe, falls die Fläche (noch) nicht gemessen ist (jsdom, erster Render). */
export const FLAECHE_VORGABE: Groesse = { breite: 960, hoehe: 540 };

export interface FlaechenApi {
  /** Bildschirmpunkt → Skizzeneinheiten; `null` außerhalb der Fläche. */
  zuSkizze(clientX: number, clientY: number): Punkt | null;
  fokussiere(key: string): void;
  /** Mitte eines Elements in Bildschirmpunkten (Kontextmenü über die Tastatur). */
  ankerVon(key: string): Punkt | null;
}

export interface SkizzenFlaecheProps {
  netz: Fernmeldenetz;
  layout: SkizzenLayout;
  inhalt: Groesse;
  schriftfeld: { x: number; y: number; block: SchriftfeldBlock };
  /** Gezoomte Ansicht; `null` = eingepasst. */
  ansicht: Ansicht | null;
  /** Die tatsächlich gezeigte Ansicht (eingepasst gerechnet). */
  effektiv: Ansicht;
  onAnsicht: (a: Ansicht) => void;
  flaeche: Groesse;
  onFlaeche: (g: Groesse) => void;
  druck: boolean;
  folge: readonly string[];
  gewaehlt: string | null;
  fokus: string | null;
  onFokus: (key: string) => void;
  onWahl: (key: string | null) => void;
  onZeiger: (key: string | null) => void;
  hervor: ReadonlySet<string> | null;
  voll: ReadonlySet<string> | null;
  meldungen: ReadonlyMap<string, string>;
  /** Darf das Element gezogen (verschoben) werden? */
  ziehbar: (key: string) => boolean;
  /** Bietet die Stelle einen Anschluss-Griff (Zuordnen/Verbinden)? */
  griff: (key: string) => boolean;
  onTaste: (befehl: TastenBefehl, key: string | null) => void;
  onKontext: (key: string, px: Punkt) => void;
  onHalten: (halten: boolean) => void;
  api: { current: FlaechenApi | null };
  beschreibungId?: string;
}

function zustandVon(
  key: string,
  hervor: ReadonlySet<string> | null,
  voll: ReadonlySet<string> | null,
): Zustand {
  const h = hervor?.has(key) ?? false;
  const zurueck = (voll != null && !voll.has(key)) || (hervor != null && !h);
  return { hervorgehoben: h, zurueck };
}

/** Zugänglicher Name einer Stelle: Art, Bezeichnung, Rufname, Lücken. */
export function stellenLabel(s: NetzStelle): string {
  const art: Record<NetzStelle['art'], string> = {
    fuehrungsstelle: 'Führungsstelle',
    abschnitt: 'Abschnitt',
    einheit: 'Einheit',
    extern: 'Externe Stelle',
    komponente: 'Komponente',
  };
  const teile = [`${art[s.art]} ${anzeigeName(s)}`];
  const ruf = rufnamenZeile(s);
  if (ruf && s.art !== 'extern') teile.push(s.rufname ? `Rufname ${ruf}` : ruf);
  if (s.art === 'extern') teile.push(ruf ?? '');
  for (const l of s.luecken) teile.push(l.text);
  return teile.filter(Boolean).join(', ');
}

interface ElementProps {
  id: string;
  daten: ZiehDaten;
  ziehbar: boolean;
  label: string;
  elementKey: string;
  gewaehlt: boolean;
  fokus: boolean;
  zurueck: boolean;
  skala: number;
  druck: boolean;
  rahmen: Rechteck;
  kinder: ReactNode;
  flaeche: SkizzenFlaecheProps;
  setRef: (key: string, el: SVGGElement | null) => void;
  tastatur: { current: boolean };
  domFokus: string | null;
  setDomFokus: (k: string | null) => void;
}

/** Ein bedienbares Element: Fokus, Wahl, Zeiger, Langdruck, Ziehen. */
function Element({
  id,
  daten,
  ziehbar,
  label,
  elementKey,
  gewaehlt,
  fokus,
  zurueck,
  skala,
  druck,
  rahmen,
  kinder,
  flaeche: f,
  setRef,
  tastatur,
  domFokus,
  setDomFokus,
}: ElementProps) {
  // Ohne `attributes`: Rolle, Name und `tabindex` setzt das Element selbst (roving tabindex).
  const { listeners, setNodeRef, transform } = useDraggable({
    id,
    data: daten,
    disabled: !ziehbar || druck,
  });
  const lang = useRef<{ timer: number; x: number; y: number } | null>(null);
  const abbrechen = () => {
    if (lang.current) window.clearTimeout(lang.current.timer);
    lang.current = null;
  };
  useEffect(() => abbrechen, []);
  const ref = useCallback(
    (el: SVGGElement | null) => {
      setNodeRef(el as unknown as HTMLElement | null);
      setRef(elementKey, el);
    },
    [setNodeRef, setRef, elementKey],
  );
  if (druck) {
    return <g data-key={elementKey}>{kinder}</g>;
  }
  const dx = transform ? transform.x / skala : 0;
  const dy = transform ? transform.y / skala : 0;
  return (
    <g
      ref={ref}
      data-lfh="skizze-element"
      data-key={elementKey}
      data-gewaehlt={gewaehlt || undefined}
      role="button"
      aria-label={label}
      aria-pressed={gewaehlt}
      tabIndex={fokus ? 0 : -1}
      // Die Deckkraft nimmt jedes Bild selbst (`zurueckDeckkraft`): Lücken- und Meldungszeile
      // treten nicht mit zurück (Prüfliste O1).
      data-zurueck={zurueck || undefined}
      transform={transform ? `translate(${dx} ${dy})` : undefined}
      style={{ cursor: ziehbar ? 'move' : 'pointer', outline: 'none' }}
      onFocus={() => {
        f.onFokus(elementKey);
        setDomFokus(elementKey);
      }}
      onBlur={() => setDomFokus(null)}
      onClick={(e) => {
        e.stopPropagation();
        f.onWahl(elementKey);
      }}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'touch') f.onZeiger(elementKey);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'touch') f.onZeiger(null);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        f.onKontext(elementKey, { x: e.clientX, y: e.clientY });
      }}
      onPointerDown={(e: ReactPointerEvent<SVGGElement>) => {
        tastatur.current = false;
        listeners?.onPointerDown?.(e);
        if (e.pointerType === 'mouse') return;
        abbrechen();
        const timer = window.setTimeout(() => {
          lang.current = null;
          f.onKontext(elementKey, { x: e.clientX, y: e.clientY });
        }, LANGDRUCK_MS);
        lang.current = { timer, x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        const l = lang.current;
        if (l && Math.hypot(e.clientX - l.x, e.clientY - l.y) > LANGDRUCK_WEG) abbrechen();
      }}
      onPointerUp={abbrechen}
      onPointerCancel={abbrechen}
      onKeyDown={(e: KeyboardEvent<SVGGElement>) => {
        tastatur.current = true;
        const befehl = tastenBefehl(e);
        if (!befehl) return;
        if (befehl.art === 'wandere') {
          const naechstes = naechsterFokus(f.folge, elementKey, befehl.richtung);
          if (!naechstes) return; // am Ende verlässt der Fokus die Fläche
          e.preventDefault();
          f.api.current?.fokussiere(naechstes);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        f.onTaste(befehl, elementKey);
      }}
    >
      {kinder}
      {gewaehlt ? <Rahmen r={rahmen} art="wahl" skala={skala} /> : null}
      {domFokus === elementKey && tastatur.current ? (
        <Rahmen r={rahmen} art="fokus" skala={skala} />
      ) : null}
    </g>
  );
}

/** Ein Griff (Anschlusspunkt, Ecke): Trefferfläche nach Dichte, gezeichnet klein. */
function Griff({
  id,
  daten,
  x,
  y,
  skala,
  label,
  form,
}: {
  id: string;
  daten: ZiehDaten;
  x: number;
  y: number;
  skala: number;
  label: string;
  form: 'kreis' | 'ecke';
}) {
  const { token, rollen } = useRollen();
  const { listeners, setNodeRef, transform } = useDraggable({ id, data: daten });
  const treffer = token.controlHeight / 2 / skala;
  const sichtbar = 6 / skala;
  const dx = transform ? transform.x / skala : 0;
  const dy = transform ? transform.y / skala : 0;
  return (
    <g data-lfh="skizze-griff" data-griff={form} aria-label={label} role="img">
      {transform && form === 'kreis' ? (
        // Gummiband vom Anschluss zum Zeiger.
        <line
          x1={x}
          y1={y}
          x2={x + dx}
          y2={y + dy}
          stroke={rollen.bedien}
          strokeWidth={2 / skala}
          strokeDasharray={`${6 / skala} ${4 / skala}`}
          pointerEvents="none"
        />
      ) : null}
      <g
        ref={(el) => setNodeRef(el as unknown as HTMLElement | null)}
        transform={transform && form === 'ecke' ? `translate(${dx} ${dy})` : undefined}
        style={{ cursor: form === 'ecke' ? 'nwse-resize' : 'crosshair', touchAction: 'none' }}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <circle cx={x} cy={y} r={treffer} fill="transparent" />
        {form === 'kreis' ? (
          <circle
            cx={x}
            cy={y}
            r={sichtbar}
            fill={rollen.bedien}
            stroke="currentColor"
            strokeWidth={1 / skala}
          />
        ) : (
          <rect
            x={x - sichtbar}
            y={y - sichtbar}
            width={2 * sichtbar}
            height={2 * sichtbar}
            fill={rollen.bedien}
            stroke="currentColor"
            strokeWidth={1 / skala}
          />
        )}
      </g>
    </g>
  );
}

export default function SkizzenFlaeche(props: SkizzenFlaecheProps) {
  const {
    netz,
    layout,
    inhalt,
    schriftfeld,
    ansicht,
    effektiv,
    onAnsicht,
    flaeche,
    onFlaeche,
    druck,
    gewaehlt,
    fokus,
    hervor,
    voll,
    meldungen,
    ziehbar,
    griff,
    onHalten,
    api,
  } = props;
  const { token, rollen } = useRollen();
  const huelle = useRef<HTMLDivElement | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const elemente = useRef(new Map<string, SVGGElement>());
  const tastatur = useRef(false);
  const [domFokus, setDomFokus] = useState<string | null>(null);
  const zieht = useDndContext().active != null;

  const setRef = useCallback((key: string, el: SVGGElement | null) => {
    if (el) elemente.current.set(key, el);
    else elemente.current.delete(key);
  }, []);

  // ── Größe messen ──────────────────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = huelle.current;
    if (!el || druck) return;
    const miss = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) onFlaeche({ breite: r.width, hoehe: r.height });
    };
    miss();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(miss);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onFlaeche, druck]);

  // ── API für die Seite: Umrechnung und Fokus ─────────────────────────────────────────────────
  const effektivRef = useRef(effektiv);
  useLayoutEffect(() => {
    effektivRef.current = effektiv;
  }, [effektiv]);
  useLayoutEffect(() => {
    api.current = {
      zuSkizze(clientX, clientY) {
        const r = svg.current?.getBoundingClientRect();
        if (!r) return null;
        if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) {
          return null;
        }
        return zuSkizze(effektivRef.current, { x: clientX - r.left, y: clientY - r.top });
      },
      fokussiere(key) {
        const el = elemente.current.get(key);
        if (el) {
          tastatur.current = true;
          el.focus();
        }
      },
      ankerVon(key) {
        const r = elemente.current.get(key)?.getBoundingClientRect();
        return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      },
    };
    return () => {
      api.current = null;
    };
  }, [api]);

  // ── Strg+Rad: Zoom am Zeiger (nicht passiv, sonst zoomte der Browser die Seite) ────────────
  const radRef = useRef({ effektiv, flaeche, inhalt, onAnsicht });
  useLayoutEffect(() => {
    radRef.current = { effektiv, flaeche, inhalt, onAnsicht };
  }, [effektiv, flaeche, inhalt, onAnsicht]);
  useEffect(() => {
    const el = svg.current;
    if (!el || druck) return;
    const rad = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const c = radRef.current;
      c.onAnsicht(
        zoome(c.effektiv, radFaktor(e.deltaY), c.flaeche, c.inhalt, {
          x: e.clientX - r.left,
          y: e.clientY - r.top,
        }),
      );
    };
    el.addEventListener('wheel', rad, { passive: false });
    return () => el.removeEventListener('wheel', rad);
  }, [druck]);

  // ── Verschieben der Ansicht und zwei Finger ───────────────────────────────────────────────
  const zeiger = useRef(new Map<number, Punkt>());
  const geste = useRef<
    | { art: 'pan'; start: Punkt; ansicht: Ansicht; bewegt: boolean }
    | { art: 'pinch'; ansicht: Ansicht; abstand: number; mitte: Punkt }
    | null
  >(null);
  const lokal = (e: { clientX: number; clientY: number }): Punkt => {
    const r = svg.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const zweiPunkte = () => {
    const [a, b] = [...zeiger.current.values()];
    return {
      abstand: Math.hypot(a.x - b.x, a.y - b.y),
      mitte: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };
  const aufDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    tastatur.current = false;
    zeiger.current.set(e.pointerId, lokal(e));
    if (zeiger.current.size === 2) {
      geste.current = { art: 'pinch', ansicht: effektiv, ...zweiPunkte() };
      return;
    }
    const ziel = e.target as Element;
    if (ziel.getAttribute('data-teil') === 'grund') {
      geste.current = { art: 'pan', start: lokal(e), ansicht: effektiv, bewegt: false };
      ziel.setPointerCapture?.(e.pointerId);
    }
  };
  const aufMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!zeiger.current.has(e.pointerId)) return;
    zeiger.current.set(e.pointerId, lokal(e));
    const g = geste.current;
    if (!g || zieht) return;
    if (g.art === 'pinch' && zeiger.current.size >= 2) {
      onAnsicht(zweiFinger(g, zweiPunkte(), flaeche, inhalt));
    } else if (g.art === 'pan') {
      const p = lokal(e);
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (!g.bewegt && Math.hypot(dx, dy) < 4) return;
      g.bewegt = true;
      onAnsicht(verschiebeAnsicht(g.ansicht, dx, dy));
    }
  };
  const aufUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    zeiger.current.delete(e.pointerId);
    const g = geste.current;
    if (g?.art === 'pan' && !g.bewegt) props.onWahl(null);
    if (zeiger.current.size < 2) geste.current = null;
  };

  // ── Ruhige Fläche ─────────────────────────────────────────────────────────────────────────
  const drin = useRef({ zeiger: false, fokus: false });
  const melden = () => onHalten(drin.current.zeiger || drin.current.fokus);

  const s = effektiv.skala;
  /** Trefferbreite dünner Linien am Schirm: Boden 24 px (WCAG 2.5.8), mit der Dichte wachsend. */
  const linienTreffer = Math.max(24, (token.controlHeight * 2) / 3);
  const zustand = (key: string): Zustand =>
    druck ? { hervorgehoben: false, zurueck: false } : zustandVon(key, hervor, voll);
  // Eine Meldung am Element ist Rückmeldung an diesen Arbeitsplatz, kein Teil des Blatts
  // (Prüfliste O4); `skizzeDruck.css` blendet sie auch ohne `beforeprint` aus.
  const meldung = (key: string): string | undefined => (druck ? undefined : meldungen.get(key));
  const platz = (key: string): Platz | undefined => layout.plaetze.get(key);
  const stiche = stichleitungen(netz);
  const stelleJeKey = new Map(netz.stellen.map((x) => [x.key, x]));
  const schieneJeKey = new Map(netz.schienen.map((x) => [x.key, x]));

  const element = (
    key: string,
    daten: ZiehDaten,
    label: string,
    rahmen: Rechteck,
    kinder: ReactNode,
  ) => (
    <Element
      key={key}
      id={`${daten.art}:${key}`}
      daten={daten}
      ziehbar={ziehbar(key)}
      label={label}
      elementKey={key}
      gewaehlt={!druck && gewaehlt === key}
      fokus={fokus === key}
      zurueck={zustand(key).zurueck}
      skala={s}
      druck={druck}
      rahmen={rahmen}
      kinder={kinder}
      flaeche={props}
      setRef={setRef}
      tastatur={tastatur}
      domFokus={domFokus}
      setDomFokus={setDomFokus}
    />
  );

  // ── Ebenen: Bereiche, Verbindungen, Schienen, Stichleitungen, Stellen, Schriftfeld ───────
  const bereiche = netz.bereiche.map((b) =>
    element(
      b.key,
      { art: 'bereich', key: b.key },
      `Bereich ${b.bezeichnung}`,
      b,
      <BereichBild bereich={b} zustand={zustand(b.key)} />,
    ),
  );

  const verbindungen = netz.verbindungen.flatMap((v) => {
    const a = stelleJeKey.get(v.von);
    const b = stelleJeKey.get(v.nach);
    const pa = platz(v.von);
    const pb = platz(v.nach);
    if (!a || !b || !pa || !pb) return [];
    const von = zeichenMitte(a, pa);
    const nach = zeichenMitte(b, pb);
    const bezug = `${a.bezeichnung} – ${b.bezeichnung}`;
    return [
      element(
        v.key,
        { art: 'fest', key: v.key },
        `Verbindung ${bezug}: ${v.beschreibung}${v.hinweis ? `, ${v.hinweis}` : ''}`,
        {
          x: Math.min(von.x, nach.x),
          y: Math.min(von.y, nach.y),
          breite: Math.abs(nach.x - von.x),
          hoehe: Math.abs(nach.y - von.y),
        },
        <>
          {/* Breite, unsichtbare Trefferlinie für Zeiger und Finger. */}
          <line
            x1={von.x}
            y1={von.y}
            x2={nach.x}
            y2={nach.y}
            stroke="transparent"
            strokeWidth={linienTreffer / s}
          />
          <VerbindungBild
            verbindung={v}
            von={von}
            nach={nach}
            zustand={zustand(v.key)}
            bezug={bezug}
          />
        </>,
      ),
    ];
  });

  const schienen = netz.schienen.flatMap((sch) => {
    const p = platz(sch.key);
    if (!p) return [];
    const y = schienenLinieY(p);
    const treffer = Math.max(28, token.controlHeight / s);
    return [
      element(
        sch.key,
        { art: 'schiene', key: sch.key },
        `Sammelschiene ${sch.zeichen}, ${sch.teilnehmer.length} Teilnehmer${
          sch.luecken.length ? `, ${sch.luecken.map((l) => l.text).join(', ')}` : ''
        }`,
        { x: p.x, y: y - treffer / 2, breite: p.breite, hoehe: treffer },
        <>
          {/* Trefffläche nach Dichte, auch bei kleinem Maßstab (Prüfliste Kriterium 1). */}
          <rect x={p.x} y={y - treffer / 2} width={p.breite} height={treffer} fill="transparent" />
          <SchieneBild
            schiene={sch}
            platz={p}
            zustand={zustand(sch.key)}
            meldung={meldung(sch.key)}
          />
        </>,
      ),
    ];
  });

  const stichElemente = stiche.flatMap((st: Stichleitung) => {
    const stelle = stelleJeKey.get(st.stelle);
    const ps = platz(st.stelle);
    const pq = platz(st.schiene);
    const schiene = schieneJeKey.get(st.schiene);
    if (!stelle || !ps || !pq || !schiene) return [];
    const punkte = stichleitungsPunkte(stelle, ps, pq);
    const xs = punkte.map((q) => q.x);
    const ys = punkte.map((q) => q.y);
    return [
      element(
        st.key,
        { art: 'stich', key: st.key, schiene: st.schiene, stelle: st.stelle },
        `Stichleitung ${stelle.bezeichnung} an ${schiene.zeichen}${
          st.status === 'geplant' ? ', geplant' : ''
        }`,
        {
          x: Math.min(...xs),
          y: Math.min(...ys),
          breite: Math.max(...xs) - Math.min(...xs),
          hoehe: Math.max(...ys) - Math.min(...ys),
        },
        <>
          <polyline
            points={punkte.map((q) => `${q.x},${q.y}`).join(' ')}
            fill="none"
            stroke="transparent"
            strokeWidth={linienTreffer / s}
          />
          <StichBild punkte={punkte} geplant={st.status === 'geplant'} zustand={zustand(st.key)} />
        </>,
      ),
    ];
  });

  const stellen = netz.stellen.flatMap((st) => {
    const p = platz(st.key);
    if (!p) return [];
    return [
      element(
        st.key,
        { art: 'stelle', key: st.key },
        stellenLabel(st) + (meldung(st.key) ? `, ${meldung(st.key)}` : ''),
        p,
        <>
          <rect x={p.x} y={p.y} width={p.breite} height={p.hoehe} fill="transparent" />
          <StelleBild stelle={st} platz={p} zustand={zustand(st.key)} meldung={meldung(st.key)} />
          {p.neu && !druck ? <NeuMarke platz={p} zustand={zustand(st.key)} /> : null}
        </>,
      ),
    ];
  });

  const sf = element(
    SCHRIFTFELD,
    { art: 'fest', key: SCHRIFTFELD },
    'Schriftfeld',
    {
      x: schriftfeld.x,
      y: schriftfeld.y,
      breite: schriftfeld.block.breite,
      hoehe: schriftfeld.block.hoehe,
    },
    <SchriftfeldBild
      x={schriftfeld.x}
      y={schriftfeld.y}
      block={schriftfeld.block}
      zustand={zustand(SCHRIFTFELD)}
    />,
  );

  // ── Griffe des gewählten Elements ─────────────────────────────────────────────────────────
  let griffe: ReactNode = null;
  if (!druck && gewaehlt) {
    const st = stelleJeKey.get(gewaehlt);
    const p = platz(gewaehlt);
    const b = netz.bereiche.find((x) => x.key === gewaehlt);
    if (st && p && griff(gewaehlt)) {
      griffe = (
        <Griff
          id={`anschluss:${gewaehlt}`}
          daten={{ art: 'anschluss', key: gewaehlt }}
          x={p.x + p.breite / 2}
          y={p.y + p.hoehe}
          skala={s}
          label={`Anschluss von ${st.bezeichnung}: auf eine Schiene oder Stelle ziehen`}
          form="kreis"
        />
      );
    } else if (b && ziehbar(gewaehlt)) {
      griffe = (
        <Griff
          id={`ecke:${gewaehlt}`}
          daten={{ art: 'ecke', key: gewaehlt }}
          x={b.x + b.breite}
          y={b.y + b.hoehe}
          skala={s}
          label={`Größe von ${b.bezeichnung} ziehen`}
          form="ecke"
        />
      );
    }
  }

  const viewBox = druck ? `0 0 ${inhalt.breite} ${inhalt.hoehe}` : viewBoxAus(effektiv, flaeche);
  return (
    <div
      ref={huelle}
      data-lfh="skizze-flaeche"
      className="lfh-skizze-flaeche"
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: druck ? undefined : rollen.flaeche,
        border: druck ? undefined : `1px solid ${rollen.linie}`,
        color: rollen.text,
        height: druck ? undefined : '100%',
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === 'touch') return;
        drin.current.zeiger = true;
        melden();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'touch') return;
        drin.current.zeiger = false;
        melden();
      }}
      onFocus={() => {
        drin.current.fokus = true;
        melden();
      }}
      onBlur={(e) => {
        if (huelle.current?.contains(e.relatedTarget as Node | null)) return;
        drin.current.fokus = false;
        melden();
      }}
    >
      <svg
        ref={svg}
        role="group"
        aria-label="Fernmeldeskizze"
        aria-roledescription="Zeichenfläche"
        aria-describedby={props.beschreibungId}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        height={druck ? undefined : '100%'}
        style={{
          display: 'block',
          touchAction: 'none',
          userSelect: 'none',
          ...(druck ? {} : { cursor: geste.current?.art === 'pan' ? 'grabbing' : 'grab' }),
        }}
        onPointerDown={druck ? undefined : aufDown}
        onPointerMove={druck ? undefined : aufMove}
        onPointerUp={druck ? undefined : aufUp}
        onPointerCancel={druck ? undefined : aufUp}
      >
        {!druck ? (
          <rect
            data-teil="grund"
            x={(ansicht ?? effektiv).x - inhalt.breite * 4}
            y={(ansicht ?? effektiv).y - inhalt.hoehe * 4}
            width={inhalt.breite * 10 + flaeche.breite / s}
            height={inhalt.hoehe * 10 + flaeche.hoehe / s}
            fill="transparent"
          />
        ) : null}
        <g data-ebene="bereiche">{bereiche}</g>
        <g data-ebene="verbindungen">{verbindungen}</g>
        <g data-ebene="schienen">{schienen}</g>
        <g data-ebene="stichleitungen">{stichElemente}</g>
        <g data-ebene="stellen">{stellen}</g>
        <g data-ebene="schriftfeld">{sf}</g>
        {griffe}
      </svg>
    </div>
  );
}
