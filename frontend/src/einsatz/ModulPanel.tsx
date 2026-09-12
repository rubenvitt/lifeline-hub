import type { CSSProperties } from 'react';
import { Badge, theme, Typography } from 'antd';
import { ExportOutlined, LockOutlined, ToolOutlined } from '@ant-design/icons';
import { istModulGesperrt, istModulSichtbar, type ModulEintrag } from './modulRegistry';
import { form } from '../theme/tokens';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import type { ModulZaehlerMap } from './useModulZaehler';

/** Breite des Aktivbalkens. Markermaß, keine Dichte-Angabe — dieselbe Kategorie wie
 *  die 48 in `IconRail.tsx:43-44`. */
const AKTIVBALKEN = 3;

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
   * Dichte-Angabe (dieselbe Begründung wortgleich in `ModulAkkordeon.tsx:39-43` und
   * `IconRail.tsx:43-44`).
   *
   * Deshalb `Math.max` und NICHT `??`: mit `??` deckelte die Drawer-Trefffläche 48 die
   * Handschuh-Stufe auf 48 statt 72 — die Prop drehte die Staffel dort zurück, statt sie
   * zu ergänzen.
   */
  mindestTrefflaeche?: number;
  /** Bereits berechnete, berechtigungsgesteuerte Zähler je Registry-Quelle. */
  zaehler?: ModulZaehlerMap;
}

/**
 * Zeilenstil eines Modulknopfes — REIN und exportiert, damit die Zusicherung über die
 * Dichtestufen prüfbar ist, OHNE zu rendern.
 *
 * `test/utils.tsx:31` montiert ein nacktes `ConfigProvider` ohne unser Theme: `useToken()`
 * liefert dort den antd-Seed (`controlHeight: 32`), also KEINE der Stufen 30/48/72. Ein
 * gerenderter Wert belegte antd-Vorgaben statt der Staffel — und jsdom rechnet ohnehin kein
 * Layout. Präzedenz: `pages/lagekarte/Sidebar.tsx:239` (`bedienzielStil`) mit
 * `Sidebar.test.tsx:591-637`.
 *
 * ZWEI Angaben, nicht eine (Konvention aus LFH-365): `minHeight` aus `controlHeight` PLUS
 * die mitziehende Polsterung. Die Polsterung allein trägt den Boden nicht, `minHeight`
 * allein klebt den Text im Handschuh-Betrieb an die Kante.
 *
 * Aufgelöste Tokens, nie `var(--lfh-*)` — die Arbeitsteilung steht in `theme/rollen.css`
 * („ZWEI QUELLEN, EINE WAHRHEIT"): handgeschriebenes CSS liest die Custom Properties,
 * TSX liest `theme.useToken()`.
 */
export function modulZeilenStil(
  token: {
    controlHeight: number;
    padding: number;
    paddingSM: number;
    marginSM: number;
    colorPrimary: string;
    colorPrimaryBg: string;
    colorTextDisabled: string;
  },
  zustand: { aktiv: boolean; gesperrt: boolean; mindestTrefflaeche?: number },
): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: token.marginSM,
    padding: `${token.paddingSM}px ${token.padding}px`,
    minHeight: Math.max(zustand.mindestTrefflaeche ?? 0, token.controlHeight),
    border: 'none',
    // Der Balken ist der ZWEITE Kanal neben der Fläche (WCAG 1.4.1), nicht ihr Ersatz —
    // deshalb steht `background` unten weiterhin. Inaktiv bleibt er `transparent` statt
    // zu entfallen: sonst springt die Zeile beim Aktivieren um 3 px zur Seite.
    borderLeft: `${AKTIVBALKEN}px solid ${zustand.aktiv ? token.colorPrimary : 'transparent'}`,
    borderRadius: form.radiusSteuer,
    textAlign: 'left',
    width: '100%',
    cursor: zustand.gesperrt ? 'not-allowed' : 'pointer',
    background: zustand.aktiv ? token.colorPrimaryBg : 'transparent',
    color: zustand.gesperrt
      ? token.colorTextDisabled
      : zustand.aktiv
        ? token.colorPrimary
        : 'inherit',
  };
}

/**
 * Stil der Knopfspalte. Rein und exportiert aus demselben Grund wie {@link modulZeilenStil}.
 *
 * Träger ist `token.marginXS` und NICHT der Modul-Export `abstand` aus `theme/tokens.ts:171`:
 * der ist die eingefrorene KOMPAKTE Stufe (immer 3) und zieht mit der Dichte nicht mit.
 * `ModulAkkordeon.tsx:59` und `IconRail.tsx:28` benutzen ihn — das ist Bestand aus der Zeit
 * vor der Dichteachse, keine Präzedenz für sie.
 */
export function modulListenStil(token: { marginXS: number; marginSM: number }): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: token.marginXS,
    marginTop: token.marginSM,
  };
}

interface Props extends ListeProps {
  titel: string;
  /**
   * Bereits aufgelöste, sichtbare und freigegebene Module der „Zuletzt"-Abkürzung
   * (LFH-337 · H12). Kommt fertig herein statt als Schlüsselliste: die Auflösung
   * braucht Registry, Overrides und Benutzer, und die hat der Rahmen ohnehin schon —
   * eine zweite Auflösung hier wäre eine zweite Wahrheit über „freigegeben".
   */
  zuletztModule?: ModulEintrag[];
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
}: ListeProps) {
  const { token } = theme.useToken();
  // Ausgeblendete Module nicht rendern (nicht-ausblendbare bleiben immer sichtbar).
  //
  // BLEIBT STEHEN, obwohl die „Zuletzt"-Liste seit der Fix-Welle (LFH-337 · B3) schon
  // gefiltert hereinkommt: `ModulListe` bedient DREI Aufrufer, und nur einer davon ist
  // vorgefiltert. Die Kategorielisten — im Panel darunter und im `ModulAkkordeon` —
  // kommen roh aus `moduleNachKategorie`. Den Filter hier zu entfernen hieße, ihn an
  // zwei andere Stellen zu kopieren; doppeltes `istModulSichtbar` ist dagegen
  // idempotent, also Redundanz und kein Fehler.
  const sichtbareModule = module.filter((m) => istModulSichtbar(m, overrides));
  return (
    <div style={modulListenStil(token)}>
      {sichtbareModule.map((m) => {
        const gesperrt = istModulGesperrt(m, benutzer, overrides);
        const aktiv = m.key === aktiverModulKey;
        const Icon = m.icon;
        const modulZaehler = m.zaehlerQuelle ? zaehler?.[m.zaehlerQuelle] : undefined;
        const zaehlerSichtbar = modulZaehler !== undefined && modulZaehler.wert > 0;
        return (
          <button
            key={m.key}
            type="button"
            disabled={gesperrt}
            title={gesperrt ? 'Keine Berechtigung' : undefined}
            // Der aktive Zustand war bisher NUR optisch (Fläche + Schriftfarbe) und für
            // Screenreader unsichtbar. Muster: `IconRail.tsx:40`, dort von
            // `IconRail.test.tsx:30-35` gepinnt.
            aria-current={aktiv ? 'true' : undefined}
            aria-label={zaehlerSichtbar ? `${m.label}, ${modulZaehler.beschreibung}` : undefined}
            onClick={() => !gesperrt && onModulKlick(m)}
            style={modulZeilenStil(token, { aktiv, gesperrt, mindestTrefflaeche })}
          >
            {/* `flexShrink: 0`, weil die Ikone sonst statt des Etiketts nachgibt: gemessen
                schrumpft sie bei „Gefahren-/Absperrzonen" im 220-px-Panel auf 4,1 px. */}
            <Icon size={18} style={{ flexShrink: 0 }} />
            <span style={{ minWidth: 0 }}>{m.label}</span>
            {zaehlerSichtbar && (
              <span
                aria-hidden="true"
                title={modulZaehler.beschreibung}
                style={{ display: 'inline-flex', flexShrink: 0, marginLeft: 'auto' }}
              >
                <Badge
                  count={modulZaehler.wert}
                  overflowCount={999}
                  styles={{
                    indicator: {
                      backgroundColor: token.colorText,
                      color: token.colorBgContainer,
                      boxShadow: 'none',
                    },
                  }}
                />
              </span>
            )}
            {/* Dekoration neben dem Label. `aria-hidden` an der HÜLLE ist Pflicht, nicht
                Kosmetik: ein `@ant-design/icons`-Knoten bringt `role="img"` mit eigenem
                ENGLISCHEM `aria-label` mit („tool"/„lock") und landete sonst im Accessible
                Name des Knopfes — dieselbe Falle, die vorher die Emojis stellten.
                Ikone statt Emoji seit der Regel „Ein Emoji ist keine Ikone" (30.07.2026):
                Zeichnung, Farbe und Breite eines Emojis kommen aus der Systemschrift statt
                aus dem Entwurf. Kein `size`-Prop — antd-Ikonen kennen keins, ihr SVG ist
                1em und erbt damit die Schriftgröße der Stufe. */}
            {m.status === 'wip' && (
              <span title="In Arbeit" aria-hidden style={{ display: 'inline-flex', flexShrink: 0 }}>
                <ToolOutlined />
              </span>
            )}
            {m.verweistAuf && (
              <span
                title="Öffnet in der Lagekarte"
                aria-hidden
                style={{
                  display: 'inline-flex',
                  flexShrink: 0,
                  marginLeft: zaehlerSichtbar ? 0 : 'auto',
                }}
              >
                <ExportOutlined />
              </span>
            )}
            {/* Ebenfalls Dekoration, und bewusst OHNE `title`: die Sperre trägt der Knopf
                selbst über `disabled` und `title="Keine Berechtigung"`. Ein zweiter Titel
                am inneren Span verdrängte beim Zeigen den des Knopfes (der innerste
                gewinnt) und zerlegte ein Bedienelement in zwei Tooltip-Zonen mit
                verschiedenem Wortlaut, um dieselbe Sache zu sagen. */}
            {gesperrt && (
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  flexShrink: 0,
                  marginLeft: zaehlerSichtbar ? 0 : 'auto',
                }}
              >
                <LockOutlined />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Liste der Module einer Kategorie im inline-Rahmen (Ebene 2). */
export default function ModulPanel({ titel, zuletztModule, ...liste }: Props) {
  const { token } = theme.useToken();
  const ueberschrift: CSSProperties = {
    fontSize: 12,
    textTransform: 'uppercase',
  };
  return (
    <div
      // Testanker für den e2e-Trefflächennachweis (AK2). Der inline-Rahmen hat als einziger
      // der drei Navigationsträger keine Landmark — die IconRail trägt `<nav
      // aria-label="Kategorien">`, das Akkordeon `<nav aria-label="Einsatz-Navigation">`.
      // Eine zweite Landmark hier machte `getByRole('navigation')` ohne Namen mehrdeutig,
      // deshalb ein Datenmerkmal. Präzedenz: `data-lfh="datensicht-karte"` in Datensicht.tsx.
      data-lfh="modul-panel"
      style={{ width: 220, padding: 12, borderRight: `1px solid ${token.colorBorderSecondary}` }}
    >
      {/* Die Abkürzung steht ÜBER der Kategorie, nicht darunter: sie soll den Weg
          verkürzen, und ein Ziel unterhalb der vollständigen Liste verkürzt nichts.
          Ganz weg, wenn nichts gemerkt ist — eine leere Überschrift belegte Platz im
          220-px-Panel und verspräche eine Abkürzung, die es nicht gibt. */}
      {zuletztModule && zuletztModule.length > 0 && (
        <div style={{ marginBottom: token.marginSM }}>
          <Typography.Text type="secondary" style={ueberschrift}>
            Zuletzt
          </Typography.Text>
          <ModulListe {...liste} module={zuletztModule} />
        </div>
      )}
      <Typography.Text type="secondary" style={ueberschrift}>
        {titel}
      </Typography.Text>
      <ModulListe {...liste} />
    </div>
  );
}
