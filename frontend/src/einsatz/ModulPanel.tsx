import { IconExternPfeil, IconSchloss, IconSchraubenschluessel } from '../icons';
import type { CSSProperties } from 'react';
import { theme } from 'antd';
import { istModulGesperrt, istModulSichtbar, type ModulEintrag } from './modulRegistry';
import { navZeilen, sprungZiel, type Sprungmarke } from './sprungmarken';
import { form, schrift, type Farbrollen } from '../theme/tokens';
import type { EinsatzAnzeige, ModulFreigaben } from '../api/types';
import type { ModulZaehlerMap } from './useModulZaehler';
import { useMinutenTakt } from '../components/useMinutenTakt';
import { augenbraueStil, useModusFarben } from '../components/rahmenStil';
import { einsatzDauer } from './einsatzDauer';
import { fussFokusabstandStil, useFussFokusabstand } from './fussFokusabstand';

/** Breite des Modulpanels. Layoutmaß, keine Dichte-Angabe. */
const PANEL_BREITE = 208;

/** Höhe des Panelkopfs mit der Augenbraue. Layoutmaß. */
const PANEL_KOPF = 42;

/** Aktive Modulmarke: 2 × 16 px in `bedien`. Markermaß. */
const MARKE = { breite: 2, hoehe: 16 } as const;

interface ListeProps {
  module: ModulEintrag[];
  /** Modulfreigaben des Servers (LFH-669); steuern Sichtbarkeit und Sperre. */
  freigaben?: ModulFreigaben;
  aktiverModulKey: string | null;
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
    alignItems: 'center',
    gap: token.marginSM,
    padding: `${token.paddingSM}px ${token.padding}px`,
    minHeight: Math.max(zustand.mindestTrefflaeche ?? 0, token.controlHeight),
    border: 'none',
    borderRadius: form.radiusSteuer,
    textAlign: 'left',
    width: '100%',
    fontSize: 13,
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
 * Die Modulknöpfe einer Kategorie — ohne Rahmen, Titel und feste Breite. Eigener Export für
 * zwei Träger: das {@link ModulPanel} und das Akkordeon im Navigations-Drawer. Sichtbarkeits-
 * und Sperrlogik samt `aria-hidden`-Markern darf es nur EINMAL geben.
 */
export function ModulListe({
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
          const gesperrt = istModulGesperrt(ziel, freigaben);
          return (
            <button
              key={`sprung:${marke.key}`}
              type="button"
              data-lfh="modul-sprungmarke"
              disabled={gesperrt}
              title={gesperrt ? 'Keine Berechtigung' : `Springt zu ${marke.hinweis}`}
              // Das Ziel gehört in den Namen: sichtbar steht nur „Entscheidungen", wer vorliest, soll vorher
              // wissen, dass er im ETB landet.
              aria-label={`${marke.label}, springt zu ${marke.hinweis}`}
              onClick={() => !gesperrt && onSprungKlick?.(marke)}
              style={{
                ...modulZeilenStil(token, farben, { aktiv: false, gesperrt, mindestTrefflaeche }),
                ...fussFokusabstandStil,
              }}
            >
              <span aria-hidden="true" style={modulMarkeStil(farben, false)} />
              <span style={{ minWidth: 0, flex: 1 }}>{marke.label}</span>
              {/* Dasselbe Icon wie am `verweistAuf`-Eintrag; Dekoration in `aria-hidden`-Hülle. */}
              {!gesperrt && (
                <span
                  aria-hidden
                  style={{ display: 'inline-flex', flexShrink: 0, color: farben.schwach }}
                >
                  <IconExternPfeil />
                </span>
              )}
              {gesperrt && (
                <span aria-hidden style={{ display: 'inline-flex', flexShrink: 0 }}>
                  <IconSchloss />
                </span>
              )}
            </button>
          );
        }
        const m = zeile.modul;
        if (!istModulSichtbar(m, freigaben)) return null;
        const gesperrt = istModulGesperrt(m, freigaben);
        const aktiv = m.key === aktiverModulKey;
        const modulZaehler = m.zaehlerQuelle ? zaehler?.[m.zaehlerQuelle] : undefined;
        const zaehlerSichtbar = modulZaehler !== undefined && modulZaehler.wert > 0;
        return (
          <button
            key={m.key}
            type="button"
            disabled={gesperrt}
            title={gesperrt ? 'Keine Berechtigung' : undefined}
            aria-current={aktiv ? 'true' : undefined}
            aria-label={zaehlerSichtbar ? `${m.label}, ${modulZaehler.beschreibung}` : undefined}
            onClick={() => !gesperrt && onModulKlick(m)}
            // Fokusabstand zum klebenden Einsatzdauer-Fuß (WCAG 2.4.11) neben, nicht in
            // `modulZeilenStil`: der ist die Dichte-Zusicherung.
            style={{
              ...modulZeilenStil(token, farben, { aktiv, gesperrt, mindestTrefflaeche }),
              ...fussFokusabstandStil,
            }}
          >
            {/* Keine Modulicon: die Zeile trägt Marke · Etikett · Zähler. Die Icons bleiben in der
               Kommandopalette, wo sie Module, Aktionen und Datensätze unterscheiden. */}
            <span aria-hidden="true" style={modulMarkeStil(farben, aktiv)} />
            <span style={{ minWidth: 0, flex: 1 }}>{m.label}</span>
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
                  fontSize: 11,
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
              <span
                title="Öffnet in der Lagekarte"
                aria-hidden
                style={{ display: 'inline-flex', flexShrink: 0 }}
              >
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
          </button>
        );
      })}
    </div>
  );
}

/**
 * Liste der Module einer Kategorie im inline-Rahmen, 208 px auf `paneel`. Kopf 42 px mit
 * Augenbraue; Fuß „Einsatzdauer" in Mono, live je Minute (abgeschlossen: bis
 * `abgeschlossen_at`). Ohne geladenen Einsatz oder lesbaren Beginn entfällt der Fuß.
 */
export default function ModulPanel({ titel, einsatz, ...liste }: Props) {
  const { token } = theme.useToken();
  const farben = useModusFarben();
  const jetzt = useMinutenTakt();
  const dauer = einsatz ? einsatzDauer(einsatz.begonnen_at, einsatz.abgeschlossen_at, jetzt) : null;
  const linie = `1px solid ${farben.linie}`;
  const { wurzelRef, fussRef } = useFussFokusabstand();
  return (
    <div
      ref={wurzelRef}
      // Testanker für den e2e-Trefflächennachweis. Der inline-Rahmen hat als einziger
      // Navigationsträger keine Landmark — eine zweite machte `getByRole('navigation')` ohne Namen
      // mehrdeutig —, deshalb ein Datenmerkmal.
      data-lfh="modul-panel"
      style={{
        width: PANEL_BREITE,
        flex: `0 0 ${PANEL_BREITE}px`,
        display: 'flex',
        flexDirection: 'column',
        background: farben.paneel,
        borderInlineEnd: linie,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          minHeight: PANEL_KOPF,
          display: 'flex',
          alignItems: 'center',
          paddingInline: token.padding,
          borderBottom: linie,
        }}
      >
        <span style={augenbraueStil(farben.schwach)}>{titel}</span>
      </div>
      <ModulListe {...liste} />
      {dauer && (
        // `sticky; bottom: 0` wie der Rail-Fuß: die Seite scrollt im Dokument, der Fuß hängt so am
        // Fensterrand statt am Seitenende.
        <div
          ref={fussRef}
          data-lfh="modul-panel-fuss"
          style={{
            marginTop: 'auto',
            position: 'sticky',
            bottom: 0,
            background: farben.paneel,
            borderTop: linie,
            padding: `${token.paddingSM}px ${token.padding}px`,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <span style={augenbraueStil(farben.schwach)}>Einsatzdauer</span>
          <span
            style={{
              fontFamily: schrift.zahl,
              fontSize: 18,
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
              color: farben.text,
            }}
          >
            {dauer}
          </span>
        </div>
      )}
    </div>
  );
}
