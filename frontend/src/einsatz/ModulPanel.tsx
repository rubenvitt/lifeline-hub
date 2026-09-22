import type { CSSProperties } from 'react';
import { theme } from 'antd';
import { ExportOutlined, LockOutlined, ToolOutlined } from '@ant-design/icons';
import { istModulGesperrt, istModulSichtbar, type ModulEintrag } from './modulRegistry';
import { navZeilen, sprungZiel, type Sprungmarke } from './sprungmarken';
import { form, schrift, type Farbrollen } from '../theme/tokens';
import type { BenutzerAnzeige, EinsatzAnzeige, ModulOverrides } from '../api/types';
import type { ModulZaehlerMap } from './useModulZaehler';
import { useMinutenTakt } from '../components/Kopfleiste';
import { augenbraueStil, useModusFarben } from '../components/rahmenStil';
import { einsatzDauer } from './einsatzDauer';
import { fussFokusabstandStil, useFussFokusabstand } from './fussFokusabstand';

/** Breite des Modulpanels (Neuentwurf, `shell.dc.html`). Layoutmaß, keine Dichte-Angabe. */
export const PANEL_BREITE = 208;

/** Höhe des Panelkopfs mit der Augenbraue (Entwurf: 42 px). Layoutmaß. */
const PANEL_KOPF = 42;

/** Aktive Modulmarke: 2 × 16 px in `bedien` (Entwurf). Markermaß, keine Dichte-Angabe. */
const MARKE = { breite: 2, hoehe: 16 } as const;

interface ListeProps {
  module: ModulEintrag[];
  benutzer: BenutzerAnzeige | null;
  /** Modul-Overrides des Einsatzes (LFH-132); steuert Sichtbarkeit + Rollen-Schranke. */
  overrides?: ModulOverrides;
  aktiverModulKey: string | null;
  onModulKlick: (modul: ModulEintrag) => void;
  /**
   * Zusätzlicher Trefflächen-BODEN in Pixeln, der die Dichtestufe anhebt — nie senkt.
   *
   * Die Zeilenhöhe kommt seit LFH-370 · B5j aus `controlHeight` (30 / 48 / 72), also aus
   * der Staffel; ohne diesen Prop bleibt es dabei. Der Navigations-Drawer ist der
   * Berührungsfall und setzt hier zusätzlich das A1-Maß: das ist eine Trefffläche, keine
   * Dichte-Angabe.
   *
   * Deshalb `Math.max` und NICHT `??`: mit `??` deckelte die Drawer-Trefffläche 48 die
   * Handschuh-Stufe auf 48 statt 72 — die Prop drehte die Staffel dort zurück, statt sie
   * zu ergänzen.
   */
  mindestTrefflaeche?: number;
  /** Bereits berechnete, berechtigungsgesteuerte Zähler je Registry-Quelle. */
  zaehler?: ModulZaehlerMap;
  /**
   * Sprungmarken dieser Kategorie (LFH-620, `sprungmarken.ts`). Sie erben Sichtbarkeit und
   * Sperre ihres Zielmoduls und sind nie `aria-current`.
   */
  sprungmarken?: Sprungmarke[];
  onSprungKlick?: (marke: Sprungmarke) => void;
}

/** Die Farbrollen, die eine Modulzeile liest — als Ausschnitt, damit der Test sie setzen kann. */
export type ModulZeilenFarben = Pick<
  Farbrollen,
  'flaeche2' | 'text' | 'text2' | 'gedaempft' | 'schwach' | 'bedien'
>;

/**
 * Zeilenstil eines Modulknopfes — REIN und exportiert, damit die Zusicherung über die
 * Dichtestufen prüfbar ist, OHNE zu rendern.
 *
 * `test/utils.tsx:31` montiert ein nacktes `ConfigProvider` ohne unser Theme: `useToken()`
 * liefert dort den antd-Seed (`controlHeight: 32`), also KEINE der Stufen 30/48/72. Ein
 * gerenderter Wert belegte antd-Vorgaben statt der Staffel — und jsdom rechnet ohnehin kein
 * Layout. Präzedenz: `pages/lagekarte/Sidebar.tsx` (`bedienzielStil`).
 *
 * ZWEI Angaben, nicht eine (Konvention aus LFH-365): `minHeight` aus `controlHeight` PLUS
 * die mitziehende Polsterung. Die 34 px des Entwurfs sind Skizze; der Boden ist die Staffel.
 *
 * NEUENTWURF (21.09.2026): aktiv trägt die Zeile `flaeche2` und `text`, inaktiv
 * `gedaempft` — keine blaue Fläche mehr. Die Bedienfarbe steckt allein in der 2 × 16-px-Marke
 * ({@link modulMarkeStil}); sie ist der ZWEITE Kanal neben der Fläche (WCAG 1.4.1), und
 * `aria-current` der dritte.
 *
 * Aufgelöste Tokens, nie `var(--lfh-*)` — die Arbeitsteilung steht in `theme/rollen.css`.
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
    background: zustand.aktiv ? farben.flaeche2 : 'transparent',
    color: zustand.gesperrt
      ? token.colorTextDisabled
      : zustand.aktiv
        ? farben.text
        : farben.gedaempft,
  };
}

/**
 * Die aktive Marke links in der Zeile. Inaktiv bleibt sie als transparenter Platzhalter
 * stehen — sonst spränge das Etikett beim Aktivieren um die Markenbreite.
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
 * Stil der Knopfspalte. Rein und exportiert aus demselben Grund wie {@link modulZeilenStil}.
 *
 * Die Zeilen stehen ohne Zwischenraum (Entwurf) — die Liste trägt nur oben und unten Luft,
 * aus `token.marginXS` und damit mit der Dichte.
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
 * KEINE „Zuletzt"-Gruppe mehr (entfernt 13.09.2026, war LFH-337 · H12). Sie war in der
 * Bedienung nicht zu verstehen, und das folgte aus ihrer eigenen Filterung: der zuletzt
 * gewählte Eintrag ist per Konstruktion das aktuelle Modul und fiel damit immer heraus,
 * die offene Kategorie ebenso — wer innerhalb einer Kategorie arbeitete, sah die Gruppe
 * nie, beim Kategoriewechsel erschien sie mit Einträgen, die niemand vorhersagen konnte,
 * in derselben Knopfgestalt wie die Liste darunter. Der Speicher (`zuletztModule.ts`)
 * bleibt: die Kommandopalette trägt ihre Gruppe „Zuletzt besucht" daraus.
 */
interface Props extends ListeProps {
  titel: string;
  /** Der Einsatz für den Fuß „Einsatzdauer". Fehlt er (lädt noch), entfällt der Fuß. */
  einsatz?: Pick<EinsatzAnzeige, 'begonnen_at' | 'abgeschlossen_at'> | null;
}

/**
 * Die Modulknöpfe einer Kategorie — ohne Rahmen, ohne Titel, ohne feste Breite.
 *
 * Eigener Export, weil es zwei Träger gibt: das {@link ModulPanel} im inline-
 * Rahmen und das Akkordeon im Navigations-Drawer unter antds `lg`-Schwelle
 * (LFH-329 · B1/H11). Die Sichtbarkeits- und Sperrlogik samt der Regel, dass die
 * drei Marker (in Arbeit / Verweis / gesperrt) reine Dekoration in `aria-hidden`-
 * Hüllen bleiben, darf es nur EINMAL geben — zwei Kopien driften genau an der
 * Stelle auseinander, die niemand testet.
 */
export function ModulListe({
  module,
  benutzer,
  overrides,
  aktiverModulKey,
  onModulKlick,
  mindestTrefflaeche,
  zaehler,
  sprungmarken = [],
  onSprungKlick,
}: ListeProps) {
  const { token } = theme.useToken();
  const farben = useModusFarben();
  // Ausgeblendete Module nicht rendern (nicht-ausblendbare bleiben immer sichtbar).
  // Beide Aufrufer — das Panel und das `ModulAkkordeon` — reichen die Kategorieliste
  // roh aus `moduleNachKategorie` herein; der Filter gehört deshalb hierher. Die
  // Anordnung mit den Sprungmarken fällt VOR dem Filter (`navZeilen`).
  const zeilen = navZeilen(module, sprungmarken);
  return (
    <div style={modulListenStil(token)}>
      {zeilen.map((zeile) => {
        if (zeile.art === 'sprung') {
          const { marke } = zeile;
          const ziel = sprungZiel(marke);
          // Ein Sprung in ein ausgeblendetes oder unfertiges Modul wäre einer ins Leere.
          if (!ziel || ziel.status !== 'fertig' || !istModulSichtbar(ziel, overrides)) return null;
          const gesperrt = istModulGesperrt(ziel, benutzer, overrides);
          return (
            <button
              key={`sprung:${marke.key}`}
              type="button"
              data-lfh="modul-sprungmarke"
              disabled={gesperrt}
              title={gesperrt ? 'Keine Berechtigung' : `Springt zu ${marke.hinweis}`}
              // Das Ziel gehört in den Namen: sichtbar steht nur „Entscheidungen", und wer
              // vorliest, soll vor dem Klick wissen, dass er im ETB landet.
              aria-label={`${marke.label}, springt zu ${marke.hinweis}`}
              onClick={() => !gesperrt && onSprungKlick?.(marke)}
              style={{
                ...modulZeilenStil(token, farben, { aktiv: false, gesperrt, mindestTrefflaeche }),
                ...fussFokusabstandStil,
              }}
            >
              <span aria-hidden="true" style={modulMarkeStil(farben, false)} />
              <span style={{ minWidth: 0, flex: 1 }}>{marke.label}</span>
              {/* Dieselbe Ikone wie am `verweistAuf`-Eintrag unten (LFH-370: Ikone statt
                  Zeichen). Dekoration in `aria-hidden`-Hülle — das Ziel steht im Namen. */}
              {!gesperrt && (
                <span
                  aria-hidden
                  style={{ display: 'inline-flex', flexShrink: 0, color: farben.schwach }}
                >
                  <ExportOutlined />
                </span>
              )}
              {gesperrt && (
                <span aria-hidden style={{ display: 'inline-flex', flexShrink: 0 }}>
                  <LockOutlined />
                </span>
              )}
            </button>
          );
        }
        const m = zeile.modul;
        if (!istModulSichtbar(m, overrides)) return null;
        const gesperrt = istModulGesperrt(m, benutzer, overrides);
        const aktiv = m.key === aktiverModulKey;
        const modulZaehler = m.zaehlerQuelle ? zaehler?.[m.zaehlerQuelle] : undefined;
        const zaehlerSichtbar = modulZaehler !== undefined && modulZaehler.wert > 0;
        return (
          <button
            key={m.key}
            type="button"
            disabled={gesperrt}
            title={gesperrt ? 'Keine Berechtigung' : undefined}
            // Der aktive Zustand war bis LFH-370 NUR optisch und für Screenreader unsichtbar.
            aria-current={aktiv ? 'true' : undefined}
            aria-label={zaehlerSichtbar ? `${m.label}, ${modulZaehler.beschreibung}` : undefined}
            onClick={() => !gesperrt && onModulKlick(m)}
            // Fokusabstand zum klebenden Einsatzdauer-Fuß (WCAG 2.4.11, `fussFokusabstand.ts`)
            // neben, nicht in `modulZeilenStil`: der ist die Dichte-Zusicherung.
            style={{
              ...modulZeilenStil(token, farben, { aktiv, gesperrt, mindestTrefflaeche }),
              ...fussFokusabstandStil,
            }}
          >
            {/* KEINE Modulikone mehr (Neuentwurf): die Zeile trägt Marke · Etikett · Zähler.
                Die Ikonen bleiben in der Kommandopalette, wo sie zwischen Modulen, Aktionen
                und Datensätzen unterscheiden. */}
            <span aria-hidden="true" style={modulMarkeStil(farben, aktiv)} />
            <span style={{ minWidth: 0, flex: 1 }}>{m.label}</span>
            {/* Zähler als Mono-Zahl rechts statt Badge-Pille (Entwurf). Neutral: er zählt
                offene Vorgänge, er alarmiert nicht — die Alarmierung trägt die
                Alarmzentrale. Die Bedeutung steht im zugänglichen Namen des Knopfes. */}
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
            {/* Dekoration neben dem Label. `aria-hidden` an der HÜLLE ist Pflicht, nicht
                Kosmetik: ein `@ant-design/icons`-Knoten bringt `role="img"` mit eigenem
                ENGLISCHEM `aria-label` mit („tool"/„lock") und landete sonst im Accessible
                Name des Knopfes. Ikone statt Emoji seit der Regel „Ein Emoji ist keine
                Ikone" (30.07.2026). */}
            {m.status === 'wip' && (
              <span title="In Arbeit" aria-hidden style={{ display: 'inline-flex', flexShrink: 0 }}>
                <ToolOutlined />
              </span>
            )}
            {m.verweistAuf && (
              <span
                title="Öffnet in der Lagekarte"
                aria-hidden
                style={{ display: 'inline-flex', flexShrink: 0 }}
              >
                <ExportOutlined />
              </span>
            )}
            {/* Ebenfalls Dekoration, und bewusst OHNE `title`: die Sperre trägt der Knopf
                selbst über `disabled` und `title="Keine Berechtigung"`. */}
            {gesperrt && (
              <span aria-hidden style={{ display: 'inline-flex', flexShrink: 0 }}>
                <LockOutlined />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Liste der Module einer Kategorie im inline-Rahmen (Ebene 2), 208 px auf `paneel`.
 *
 * Kopf 42 px mit Augenbraue und Haarlinie; Fuß „Einsatzdauer" in Mono 18, live je Minute
 * (bei abgeschlossenem Einsatz bis `abgeschlossen_at`). Der Fuß entfällt, solange der
 * Einsatz nicht geladen ist oder keinen lesbaren Beginn hat — erfunden wird nichts.
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
      // Testanker für den e2e-Trefflächennachweis (AK2). Der inline-Rahmen hat als einziger
      // der drei Navigationsträger keine Landmark — die IconRail trägt `<nav
      // aria-label="Kategorien">`, das Akkordeon `<nav aria-label="Einsatz-Navigation">`.
      // Eine zweite Landmark hier machte `getByRole('navigation')` ohne Namen mehrdeutig,
      // deshalb ein Datenmerkmal. Präzedenz: `data-lfh="datensicht-karte"` in Datensicht.tsx.
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
        // `sticky; bottom: 0` aus demselben Grund wie der Rail-Fuß (`IconRail.tsx`): die Seite
        // scrollt im Dokument, der Fuß hängt so am Fensterrand statt am Seitenende.
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
