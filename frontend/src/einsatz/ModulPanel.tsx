import { IconExternPfeil, IconSchloss, IconSchraubenschluessel } from '../icons';
import { useId, useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { theme } from 'antd';
import {
  istModulGesperrt,
  istModulSichtbar,
  KEINE_BERECHTIGUNG,
  modulZielRoute,
  type ModulEintrag,
} from './modulRegistry';
import {
  navZeilen,
  sprungVoraussetzungGesperrt,
  sprungZiel,
  type Sprungmarke,
} from './sprungmarken';
import { form, schrift, type Farbrollen } from '../theme/tokens';
import type { EinsatzAnzeige, ModulFreigaben } from '../api/types';
import type { ModulZaehlerMap } from './useModulZaehler';
import { useMinutenTakt } from '../components/useMinutenTakt';
import { augenbraueStil, useModusFarben } from '../components/rahmenStil';
import { einsatzDauer } from './einsatzDauer';
import { MODUL_PANEL_ID } from './IconRail';
import { bringIntoView } from '../components/bringIntoView';
import { abonniereRahmenOben } from '../components/rahmenOben';
import { einsatzModulPfad } from '../routing/deeplinks';
import { handleLinkKlick } from '../routing/linkModifier';
import { schriftGroesse, zahlStil } from '../components/instrument/rollenwerte';

/** Breite des Modulpanels. Layoutmaß, keine Dichte-Angabe. */
const PANEL_BREITE = 208;

/** Höhe des Panelkopfs mit der Augenbraue. Layoutmaß. */
const PANEL_KOPF = 42;

/** Aktive Modulmarke: 2 × 16 px in `bedien`. Markermaß. */
const MARKE = { breite: 2, hoehe: 16 } as const;

/**
 * Einzug des Etiketts einer Sprungmarke hinter ihrer Linie. Markermaß, bewusst NICHT aus der
 * Dichte: mit `padding` (bis 26 px) kürzte das 208-px-Panel gesperrte Namen schon in komfortabel
 * („Kommunikationsp…“, Review LLH-1733).
 */
const SPRUNG_EINZUG = 10;

interface ListeProps {
  /** Der Einsatz, in dessen Module die Links führen (LLH-1732). */
  einsatzId: number;
  module: ModulEintrag[];
  /** Modulfreigaben des Servers (LFH-669); steuern Sichtbarkeit und Sperre. */
  freigaben?: ModulFreigaben;
  aktiverModulKey: string | null;
  /** Einfacher Klick auf ein freies Modul; Strg/⌘/Umschalt/Mittelklick behält der Browser. */
  onModulKlick: (modul: ModulEintrag) => void;
  /**
   * Zusätzlicher Trefflächen-BODEN in Pixeln, der die Dichtestufe anhebt — nie senkt. Die
   * Zeilenhöhe kommt aus `controlHeight`; der Navigations-Drawer setzt hier zusätzlich 48 px.
   * `Math.max` und NICHT `??`: mit `??` deckelte 48 die Handschuh-Stufe statt 72.
   */
  mindestTrefflaeche?: number;
  /** Bereits berechnete, berechtigungsgesteuerte Zähler je Registry-Quelle. */
  zaehler?: ModulZaehlerMap;
  /**
   * Sprungmarken dieser Kategorie. Sie erben Sichtbarkeit und Sperre ihres Zielmoduls und sind
   * nie `aria-current`.
   */
  sprungmarken?: Sprungmarke[];
  onSprungKlick?: (marke: Sprungmarke) => void;
}

/** Die Farbrollen, die eine Modulzeile liest — als Ausschnitt, damit der Test sie setzen kann. */
type ModulZeilenFarben = Pick<
  Farbrollen,
  'flaeche3' | 'text' | 'text2' | 'gedaempft' | 'schwach' | 'bedien'
>;

/**
 * Zeilenstil eines Modulknopfes — rein und exportiert, damit über die Dichtestufen prüfbar:
 * `test/utils.tsx` hat kein Theme (`controlHeight: 32`), und jsdom rechnet kein Layout.
 *
 * ZWEI Angaben: `minHeight` aus `controlHeight` PLUS mitziehende Polsterung; der Boden ist die
 * Staffel, nicht die 34 px des Entwurfs.
 *
 * Aktiv: `flaeche3` und `text`, inaktiv `gedaempft`. Nicht `flaeche2` — die läge am Tag bei
 * 1,01 : 1 auf `paneel`. Die Bedienfarbe steckt allein in der Marke ({@link modulMarkeStil}),
 * dem zweiten Kanal (WCAG 1.4.1); `aria-current` ist der dritte. Aufgelöste Tokens, nie
 * `var(--lfh-*)`.
 */
export function modulZeilenStil(
  token: {
    controlHeight: number;
    padding: number;
    paddingSM: number;
    marginSM: number;
    colorTextDisabled: string;
  },
  farben: ModulZeilenFarben,
  zustand: { aktiv: boolean; gesperrt: boolean; mindestTrefflaeche?: number },
): CSSProperties {
  return {
    display: 'flex',
    boxSizing: 'border-box',
    // Die freie Zeile ist ein `<a href>` (LLH-1732), die gesperrte ein `<button>`. Ein Link erbt
    // Schrift und Zeilenhöhe der App, ein Knopf nimmt die Systemschrift des Browsers. Beide
    // bekommen deshalb die Schrift der App (Archivo, Entwurf) und die Zeilenhöhe `normal`, die die
    // Zeile als Knopf hatte; so wächst sie nicht. Der Link ohne Unterstrich.
    fontFamily: 'inherit',
    lineHeight: 'normal',
    textDecoration: 'none',
    alignItems: 'center',
    gap: token.marginSM,
    padding: `${token.paddingSM}px ${token.padding}px`,
    minHeight: Math.max(zustand.mindestTrefflaeche ?? 0, token.controlHeight),
    border: 'none',
    borderRadius: form.radiusSteuer,
    textAlign: 'left',
    width: '100%',
    fontSize: schriftGroesse('text'),
    cursor: zustand.gesperrt ? 'not-allowed' : 'pointer',
    background: zustand.aktiv ? farben.flaeche3 : 'transparent',
    color: zustand.gesperrt
      ? token.colorTextDisabled
      : zustand.aktiv
        ? farben.text
        : farben.gedaempft,
  };
}

/**
 * Zweite Zeile einer Modulzeile: die Kurzbeschreibung aus der Registry (LFH-965, Spec
 * `modul-benennung`). 12 px in `schwach`, das den Textboden auf jeder Flächenstufe hält. Höchstens
 * zwei Zeilen (LLH-1734: einzeilig endete im 208 px breiten Panel fast jede in „…“), zu Lange endet
 * danach in „…“ und steht ganz im `title` des Knopfes.
 */
export function modulBeschreibungStil(
  farben: Pick<Farbrollen, 'schwach'>,
  gesperrt: boolean,
): CSSProperties {
  return {
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    fontSize: schriftGroesse('klein'),
    lineHeight: 1.35,
    whiteSpace: 'normal',
    overflow: 'hidden',
    color: gesperrt ? 'inherit' : farben.schwach,
  };
}

/**
 * Die aktive Marke links in der Zeile. Inaktiv bleibt sie als transparenter Platzhalter stehen,
 * sonst spränge das Etikett beim Aktivieren.
 */
export function modulMarkeStil(farben: Pick<Farbrollen, 'bedien'>, aktiv: boolean): CSSProperties {
  return {
    width: MARKE.breite,
    height: MARKE.hoehe,
    flexShrink: 0,
    background: aktiv ? farben.bedien : 'transparent',
  };
}

/**
 * Führungslinie einer Sprungmarke (LLH-1733, Spec `modul-sprungmarken`): 1 px in `linie`, in der
 * Spalte der Modulmarke, damit die Marke als eingerückte Unteransicht des Moduls darüber liest
 * und nicht als Link nach außen. `stretch` mit negativem Block-Rand zieht sie durch die
 * Polsterung, so bilden Marken untereinander eine durchgehende Linie; der Rand nach rechts ist
 * der feste Einzug des Etiketts ({@link SPRUNG_EINZUG}).
 */
export function sprungLinieStil(
  token: { paddingSM: number },
  farben: Pick<Farbrollen, 'linie'>,
): CSSProperties {
  return {
    width: 1,
    alignSelf: 'stretch',
    marginBlock: -token.paddingSM,
    marginInlineEnd: SPRUNG_EINZUG,
    flexShrink: 0,
    background: farben.linie,
  };
}

/**
 * Stil der Knopfspalte, rein und exportiert. Die Zeilen stehen ohne Zwischenraum; Luft nur oben
 * und unten aus `token.marginXS`.
 */
export function modulListenStil(token: { marginXS: number }): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    paddingBlock: token.marginXS * 2,
  };
}

/**
 * Keine „Zuletzt"-Gruppe: der zuletzt gewählte Eintrag ist per Konstruktion das aktuelle Modul
 * und fiel immer heraus, beim Kategoriewechsel erschienen unvorhersehbare Einträge. Der Speicher
 * (`zuletztModule.ts`) bleibt für die Kommandopalette („Zuletzt besucht").
 */
interface Props extends ListeProps {
  titel: string;
  /** Der Einsatz für den Fuß „Einsatzdauer". Fehlt er (lädt noch), entfällt der Fuß. */
  einsatz?: Pick<EinsatzAnzeige, 'begonnen_at' | 'abgeschlossen_at'> | null;
}

/**
 * Die Moduleinträge einer Kategorie — ohne Rahmen, Titel und feste Breite. Eigener Export für
 * zwei Träger: das {@link ModulPanel} und das Akkordeon im Navigations-Drawer. Sichtbarkeits-
 * und Sperrlogik samt `aria-hidden`-Markern darf es nur EINMAL geben.
 */
export function ModulListe({
  einsatzId,
  module,
  freigaben,
  aktiverModulKey,
  onModulKlick,
  mindestTrefflaeche,
  zaehler,
  sprungmarken = [],
  onSprungKlick,
}: ListeProps) {
  const { token } = theme.useToken();
  const farben = useModusFarben();
  const listenId = useId();
  // Ausgeblendete Module nicht rendern (nicht-ausblendbare bleiben). Beide Aufrufer reichen die
  // Kategorieliste roh herein, der Filter gehört deshalb hierher. Die Anordnung mit den
  // Sprungmarken fällt VOR dem Filter (`navZeilen`).
  const zeilen = navZeilen(module, sprungmarken);
  return (
    <div style={modulListenStil(token)}>
      {zeilen.map((zeile) => {
        if (zeile.art === 'sprung') {
          const { marke } = zeile;
          const ziel = sprungZiel(marke);
          // Ein Sprung in ein ausgeblendetes oder unfertiges Modul wäre einer ins Leere.
          if (!ziel || ziel.status !== 'fertig' || !istModulSichtbar(ziel, freigaben)) return null;
          const gesperrt =
            istModulGesperrt(ziel, freigaben) || sprungVoraussetzungGesperrt(marke, freigaben);
          const sprungProps = {
            'data-lfh': 'modul-sprungmarke',
            // Gesperrt mit Namen: im schmalen Panel kann das Etikett gekürzt sein, und der Titel ist
            // dann die einzige Stelle, an der er ganz steht (LLH-1733).
            title: gesperrt ? `${marke.label} · ${KEINE_BERECHTIGUNG}` : marke.hinweis,
            // Das Ziel gehört in den Namen: sichtbar steht nur „Entscheidungen“ unter dem ETB, wer
            // vorliest, soll vorher wissen, dass er dort landet.
            'aria-label': `${marke.label}, springt zu ${marke.hinweis}`,
            style: modulZeilenStil(token, farben, { aktiv: false, gesperrt, mindestTrefflaeche }),
          };
          const sprungInhalt = (
            <>
              {/* Eingerückte Unteransicht statt Pfeil (LLH-1733): die Linie steht an der Stelle der
                 Modulmarke, eine Marke wird nie aktiv. */}
              <span
                aria-hidden="true"
                data-lfh="sprung-linie"
                style={sprungLinieStil(token, farben)}
              />
              <span
                style={{
                  minWidth: 0,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {marke.label}
              </span>
              {gesperrt && (
                <span aria-hidden style={{ display: 'inline-flex', flexShrink: 0 }}>
                  <IconSchloss />
                </span>
              )}
            </>
          );
          // Gesperrt bleibt ein gesperrter Knopf: ein Link zeigte eine Adresse, die nichts öffnet.
          // Frei ist es ein Link (LLH-1732), damit Strg/⌘+Klick einen neuen Tab öffnet.
          return gesperrt ? (
            <button key={`sprung:${marke.key}`} type="button" disabled {...sprungProps}>
              {sprungInhalt}
            </button>
          ) : (
            <a
              key={`sprung:${marke.key}`}
              href={marke.pfad(einsatzId)}
              onClick={(e) => handleLinkKlick(e, () => onSprungKlick?.(marke))}
              {...sprungProps}
            >
              {sprungInhalt}
            </a>
          );
        }
        const m = zeile.modul;
        if (!istModulSichtbar(m, freigaben)) return null;
        const gesperrt = istModulGesperrt(m, freigaben);
        const aktiv = m.key === aktiverModulKey;
        const modulZaehler = m.zaehlerQuelle ? zaehler?.[m.zaehlerQuelle] : undefined;
        const zaehlerSichtbar = modulZaehler !== undefined && modulZaehler.wert > 0;
        const beschreibungId = m.beschreibung ? `${listenId}-${m.key}` : undefined;
        const modulProps = {
          title: gesperrt ? KEINE_BERECHTIGUNG : m.beschreibung,
          'aria-current': aktiv ? ('true' as const) : undefined,
          'aria-label': zaehlerSichtbar ? `${m.label}, ${modulZaehler.beschreibung}` : undefined,
          'aria-describedby': beschreibungId,
          style: modulZeilenStil(token, farben, { aktiv, gesperrt, mindestTrefflaeche }),
        };
        const modulInhalt = (
          <>
            {/* Keine Modulicon: die Zeile trägt Marke · Etikett · Zähler. Die Icons bleiben in der
               Kommandopalette, wo sie Module, Aktionen und Datensätze unterscheiden. */}
            <span aria-hidden="true" style={modulMarkeStil(farben, aktiv)} />
            {/* Name und Beschreibung untereinander (LFH-965, Spec `modul-benennung`). Die
               Beschreibung ist `aria-hidden` und hängt über `aria-describedby` am Knopf: der
               zugängliche Name bleibt der Modulname. */}
            <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <span>{m.label}</span>
              {m.beschreibung && (
                <span
                  id={beschreibungId}
                  aria-hidden="true"
                  data-lfh="modul-beschreibung"
                  style={modulBeschreibungStil(farben, gesperrt)}
                >
                  {m.beschreibung}
                </span>
              )}
            </span>
            {/* Zähler als Mono-Zahl rechts, neutral: er zählt offene Vorgänge, er alarmiert nicht. Die
               Bedeutung steht im zugänglichen Namen des Knopfes. */}
            {zaehlerSichtbar && (
              <span
                aria-hidden="true"
                data-lfh="modul-zaehler"
                title={modulZaehler.beschreibung}
                style={{
                  flexShrink: 0,
                  fontFamily: schrift.zahl,
                  fontSize: schriftGroesse('fein'),
                  fontVariantNumeric: 'tabular-nums',
                  color: aktiv ? farben.text2 : farben.schwach,
                }}
              >
                {modulZaehler.wert > 999 ? '999+' : modulZaehler.wert}
              </span>
            )}
            {/* Dekoration; `aria-hidden` an der HÜLLE bleibt als zweite Sicherung, obwohl das Icon
               des Satzes selbst `aria-hidden` ist (LFH-595): im Namen des Knopfes hat sie nichts
               verloren. */}
            {m.status === 'wip' && (
              <span title="In Arbeit" aria-hidden style={{ display: 'inline-flex', flexShrink: 0 }}>
                <IconSchraubenschluessel />
              </span>
            )}
            {m.verweistAuf && (
              <span title="Lagekarte" aria-hidden style={{ display: 'inline-flex', flexShrink: 0 }}>
                <IconExternPfeil />
              </span>
            )}
            {/* Ebenfalls Dekoration, OHNE `title`: die Sperre trägt der Knopf über `disabled` und
               `title="Keine Berechtigung"`. */}
            {gesperrt && (
              <span aria-hidden style={{ display: 'inline-flex', flexShrink: 0 }}>
                <IconSchloss />
              </span>
            )}
          </>
        );
        // Wie bei der Sprungmarke: frei ein Link auf die Adresse des Moduls (LLH-1732), gesperrt ein
        // gesperrter Knopf ohne Adresse.
        return gesperrt ? (
          <button key={m.key} type="button" disabled {...modulProps}>
            {modulInhalt}
          </button>
        ) : (
          <a
            key={m.key}
            href={einsatzModulPfad(einsatzId, modulZielRoute(m))}
            onClick={(e) => handleLinkKlick(e, () => onModulKlick(m))}
            {...modulProps}
          >
            {modulInhalt}
          </a>
        );
      })}
    </div>
  );
}

/**
 * Hält die klebende Spalte genau so hoch wie den Platz von ihrer Oberkante im Fenster bis zum
 * Fensterrand (zjt7c073, Review B2). Geklebt ist das `100dvh` minus Kopfhöhe; ungerollt beginnt die
 * Spalte aber tiefer, sobald Bänder über dem Rahmen stehen (Spiegel, Führungshinweis, Betriebszeile
 * ab `md`), und mit der festen Höhe läge der Fuß „Einsatzdauer“ unter dem Fensterrand. Gemessen bei
 * Bildlauf, Fenstergröße, Änderung der Rahmenhöhe und der Seitenhöhe (ein Band erscheint), höchstens
 * einmal je Bild; geschrieben direkt am Element, ohne neues Rendern. Die feste Höhe bleibt als Stil
 * für das erste Bild und ohne Messung.
 */
function useFitToWindow(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    const fit = () => {
      frame = 0;
      const top = Math.max(0, el.getBoundingClientRect().top);
      el.style.height = `${Math.max(0, window.innerHeight - top)}px`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };
    fit();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(document.body);
    const unsubscribe = abonniereRahmenOben(schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}

/**
 * Liste der Module einer Kategorie im inline-Rahmen, 208 px auf `paneel`. Kopf 42 px mit
 * Augenbraue; Fuß „Einsatzdauer" in Mono, live je Minute (abgeschlossen: bis
 * `abgeschlossen_at`). Ohne geladenen Einsatz oder lesbaren Beginn entfällt der Fuß.
 *
 * Klebt wie die Rail als EINE Spalte unter dem Kopf (zjt7c073 D4, `frontend/AGENTS.md`, Rahmen):
 * Kopf und Fuß stehen fest, nur die Liste dazwischen rollt in sich. So bleibt die Kategorie auch
 * am Ende einer langen Seite im Bild (das ETB öffnet dort), und kein Teil liegt über einem
 * anderen: ein getabbter Eintrag rollt nur die Liste, deren Ränder die Kanten von Kopf und Fuß
 * sind. Die Spalte hängt an der Kopfhöhe, nicht an der Rahmenhöhe, die den klebenden Seitenkopf
 * mitzählt (D2).
 */
export default function ModulPanel({ titel, einsatz, ...liste }: Props) {
  const { token } = theme.useToken();
  const farben = useModusFarben();
  const jetzt = useMinutenTakt();
  const dauer = einsatz ? einsatzDauer(einsatz.begonnen_at, einsatz.abgeschlossen_at, jetzt) : null;
  const linie = `1px solid ${farben.linie}`;
  // Die Liste rollt in sich (zjt7c073, Review B8): eine neue Kategorie beginnt oben, statt die
  // Rollposition der vorigen zu erben, und der aktive Eintrag kommt ins Bild, auch nach einem
  // Sprung über die Palette. Nur im Container, nie im Fenster (`bringIntoView`).
  const listRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  useFitToWindow(columnRef);
  const prevTitel = useRef(titel);
  useLayoutEffect(() => {
    const container = listRef.current;
    if (!container) return;
    if (prevTitel.current !== titel) {
      container.scrollTop = 0;
      prevTitel.current = titel;
    }
    const eintrag = container.querySelector<HTMLElement>('[aria-current="true"]');
    if (eintrag) bringIntoView(container, eintrag);
  }, [titel, liste.aktiverModulKey]);
  return (
    <div
      // Testanker für den e2e-Trefflächennachweis. Der inline-Rahmen hat als einziger
      // Navigationsträger keine Landmark — eine zweite machte `getByRole('navigation')` ohne Namen
      // mehrdeutig —, deshalb ein Datenmerkmal.
      data-lfh="modul-panel"
      // Ziel von `aria-controls` an Griff und offener Kategorie der Rail (LFH-952).
      id={MODUL_PANEL_ID}
      style={{
        width: PANEL_BREITE,
        flex: `0 0 ${PANEL_BREITE}px`,
        background: farben.paneel,
        borderInlineEnd: linie,
        boxSizing: 'border-box',
      }}
    >
      <div
        ref={columnRef}
        data-lfh="modul-panel-spalte"
        style={{
          position: 'sticky',
          top: 'var(--lfh-kopf-oben, 0px)',
          height: 'calc(100dvh - var(--lfh-kopf-oben, 0px))',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            minHeight: PANEL_KOPF,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            paddingInline: token.padding,
            borderBottom: linie,
          }}
        >
          <span style={augenbraueStil(farben.schwach)}>{titel}</span>
        </div>
        <div
          ref={listRef}
          data-lfh="modul-panel-liste"
          style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}
        >
          <ModulListe {...liste} />
        </div>
        {dauer && (
          <div
            data-lfh="modul-panel-fuss"
            style={{
              flexShrink: 0,
              background: farben.paneel,
              borderTop: linie,
              padding: `${token.paddingSM}px ${token.padding}px`,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <span style={augenbraueStil(farben.schwach)}>Einsatzdauer</span>
            <span style={{ ...zahlStil('titel', 500), color: farben.text }}>{dauer}</span>
          </div>
        )}
      </div>
    </div>
  );
}
