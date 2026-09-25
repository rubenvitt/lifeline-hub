import { Input, Switch, Tooltip, Typography, theme } from 'antd';
import { useId, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import SektionHeader from '../../components/SektionHeader';
import { Select } from '../../components/Select';
import { useViewport } from '../../components/useViewport';
import {
  kategorien,
  moduleNachKategorie,
  istModulAusblendbar,
  type ModulEintrag,
} from '../../einsatz/modulRegistry';
import { ROLLEN_OPTIONEN } from './optionen';

/**
 * Trefflächenboden der Beschriftungszeile — REIN und exportiert, damit die Zusicherung über
 * die Dichtestufen ohne Render prüfbar ist (`test/utils.tsx` montiert ein nacktes
 * `ConfigProvider`, jsdom rechnet kein Layout).
 *
 * ZWEI Angaben, nicht eine (Konvention aus LFH-365): `minHeight` aus `controlHeight` PLUS
 * die Polsterung. Die Polsterung allein trägt den Boden nicht — im Handschuh-Betrieb käme
 * eine Zeile damit auf grob 54 px gegen die geforderten 72. Aufgelöste Tokens, nie
 * `var(--lfh-*)`.
 *
 * Bewusst lokal statt aus `Anmeldeverfahren.tsx` importiert — dieselbe Arbeitsteilung wie
 * dort: `Datensicht`, `SlashMenu`, `Sidebar` und `Anmeldeverfahren` halten je eine eigene.
 */
export function modulZeilenStil(token: {
  controlHeight: number;
  paddingSM: number;
  padding: number;
}): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    padding: `${token.paddingSM}px ${token.padding}px`,
  };
}

/** Warum eine Zeile gesperrt ist — je Zeile genau EINER, auch wenn mehrere Quellen greifen. */
export type ModulSperrGrund = 'modul' | 'rechte' | 'laeuft';

/**
 * Die drei Sperrquellen einer Zeile, getrennt statt in einem `disabled`-Ausdruck vermischt
 * (LFH-383). REIN und exportiert, damit der Vorrang ohne Render prüfbar ist.
 *
 * Vorrang: **Modul vor Recht vor Schreibvorgang.** Die Modul-Eigenschaft gilt auch für
 * Verwaltende und ist deshalb die genauere Aussage — an „Einsatzdaten" ohne Recht steht genau
 * EIN Grund, nicht zwei nebeneinander. Der Schreibvorgang ist vorübergehend und kommt zuletzt.
 */
export function modulSperrGrund(zeile: {
  ausblendbar: boolean;
  darfVerwalten: boolean;
  laeuft: boolean;
}): ModulSperrGrund | null {
  if (!zeile.ausblendbar) return 'modul';
  if (!zeile.darfVerwalten) return 'rechte';
  if (zeile.laeuft) return 'laeuft';
  return null;
}

/** Wortlaut eines Sperrgrunds: Kurzwort sichtbar, Begründung im Tooltip darüber. */
export interface SperrWortlaut {
  kurz: string;
  lang: string;
}

const MODUL_GRUND: SperrWortlaut = {
  // Der Kurztext ist Bestand (LFH-346 · A9) und in den Tests wörtlich gepinnt.
  kurz: 'immer sichtbar, nicht ausblendbar',
  lang: 'Selbst-Aussperr-Schutz: Einsatzdaten und Einstellungen lassen sich weder ausblenden noch auf eine Rolle beschränken — sonst käme niemand mehr an diese Einstellungen zurück.',
};

/**
 * Rückfall, wenn der Aufrufer keinen Wortlaut für das fehlende Recht mitgibt. Bewusst ein
 * Wort, das in JEDEM Fall stimmt: auf Einsatz-Ebene sperrt nicht nur die Rolle, sondern auch
 * ein abgeschlossener Einsatz — ein fest verdrahtetes „nur Verwaltung" widerspräche dort dem
 * Seitenbanner „Einsatz abgeschlossen".
 */
const RECHTE_GRUND_RUECKFALL: SperrWortlaut = {
  kurz: 'nur lesen',
  lang: 'Diese Werte lassen sich hier nicht ändern — sie stehen zum Nachlesen da.',
};

interface SichtbarSpalte {
  /** Spaltenüberschrift, z. B. „Sichtbar". */
  titel: string;
  sichtbarVon: (modulKey: string) => boolean;
  aufSichtbar: (modulKey: string, sichtbar: boolean) => void;
}

interface ModulEinstellungsListeProps {
  /** Überschrift der Rollen-Spalte („Benötigte Rolle" bzw. „… (Default)"). */
  rollenSpalte: string;
  /** Aktuelle Rolle des Moduls; '' = frei. */
  rolleVon: (modulKey: string) => string;
  aufRolle: (modulKey: string, rolle: string) => void;
  /** Fehlt sie, hat die Liste zwei Spalten und keinen Schalter (Org-Ebene). */
  sichtbarSpalte?: SichtbarSpalte;
  /** Darf der Benutzer hier überhaupt etwas ändern? */
  darfVerwalten: boolean;
  /**
   * Warum `darfVerwalten` fehlt — vom Aufrufer, weil nur er die Ursache kennt (Rolle oder
   * abgeschlossener Einsatz). Der Langtext ist derselbe wie der `rechteText` seines
   * `RechteHinweis`. Fehlt er, steht „nur lesen".
   */
  rechteGrund?: SperrWortlaut;
  /** Modul-Key der gerade mutierenden Zeile; nur DIESE ist gesperrt. */
  laeuftKey?: string | null;
  /** Modul-Key der zuletzt fehlgeschlagenen Zeile; nur DIESE wird markiert. */
  fehlerKey?: string | null;
  /** Gedämpfter Zusatz unter dem Select, z. B. der geerbte Org-Default. */
  hinweisVon?: (modulKey: string) => ReactNode;
}

/**
 * Modul-Zeilenliste der Einstellungsseiten (LFH-328 · A2, umgebaut in LFH-345 · C10).
 *
 * Zusammengezogen aus zwei handgebauten Listen: der Einsatz-Ebene (drei Spalten mit
 * Sichtbar-Schalter) und der Org-Ebene (zwei Spalten). Die Unterschiede beider Aufrufer
 * sind Props geworden; was gleich war — Zeilenraster, aria-Namen — steht nur noch hier.
 *
 * **Bewusst Callbacks statt einer Mutation als Prop:** die Payloads unterscheiden sich
 * fachlich (`{sichtbar, benoetigte_rolle}` gegen `{rolle}`), und der Aufrufer kennt seinen
 * Endpunkt. Die Liste meldet nur, WAS geändert wurde.
 *
 * **`istModulAusblendbar` wird hier ausgewertet, nicht vom Aufrufer:** Stammdaten und
 * Einstellungen selbst lassen sich weder ausblenden noch auf eine Rolle beschränken — das
 * ist eine Eigenschaft des Moduls, keine Berechtigungsfrage, und muss deshalb auch für
 * Verwaltende gesperrt bleiben.
 *
 * ── Was LFH-345 geändert hat ────────────────────────────────────────────────────
 * **Raster statt fester Breiten (H16).** Die Zeile belegte fest 268 px (64 + 180 + zwei
 * Abstände); bei 390 px Gerätebreite blieben unter 100 px fürs Modul-Label. Jetzt
 * `minmax(0, 1fr) auto auto`, und der Rollen-Select nimmt die volle Spaltenbreite statt
 * einer festen — dieselbe Beobachtung wie beim `Select` in `Datensicht.tsx:234-236`
 * (LFH-369): eine feste Mindestbreite drängt das Steuerelement aus der schmalen Karte.
 *
 * **Gestapelt unter `md`.** Label als Zeilentitel, Schalter und Rolle darunter. Die
 * Spaltenköpfe fallen dann GANZ weg: ein Kopf über gestapelten Zeilen benennt keine
 * Spalten mehr, sondern behauptet eine Ordnung, die es nicht gibt.
 *
 * **Zeilensperre statt Listensperre (H15).** Vorher sperrte jede laufende Mutation alle 50
 * Steuerelemente. `laeuftKey` sperrt nur die Zeile, die gerade schreibt.
 *
 * **Fehlermarke je Zeile (H14).** Der fehlgeschlagene Wert springt von selbst zurück (die
 * Anzeige liest aus dem Query, es gibt kein optimistisches Update) — was fehlte, war die
 * Angabe, WELCHE Zeile es war. Der linke Rand trägt sie, nach dem Muster der
 * Kommunikations-Karten aus LFH-343/C8.
 *
 * ── Was LFH-346 · A9 geändert hat (Befund M48) ──────────────────────────────────
 * **Gruppierung statt 25 flacher Zeilen.** Die Blöcke und ihre Reihenfolge kommen aus
 * `kategorien` (`einsatz/modulRegistry.ts`) — dieselbe Quelle, aus der die Icon-Rail liest.
 * Eine eigene Sortierung hier wäre eine zweite Wahrheit, die beim nächsten Modul auseinander
 * liefe.
 *
 * **Filterfeld über der Liste**, mit echtem `<label htmlFor>` (antd erzeugt keins) und ohne
 * `size`-Angabe — die Höhe erbt vom `ConfigProvider` (Dichteachse LFH-329/B1). Eine
 * Kategorie ohne Treffer fällt GANZ weg: eine Überschrift ohne Zeilen darunter behauptet eine
 * Gruppe, die die gefilterte Liste nicht hat. Trifft der Filter nirgends, sagt die Liste das,
 * statt eine leere Fläche unter dem Feld stehen zu lassen.
 *
 * **Die Spaltenköpfe stehen EINMAL über allen Blöcken**, nicht je Block: sie benennen die
 * Spalten des Rasters, und das Raster ist über alle Gruppen dasselbe. Sechsmal wiederholt
 * wären sie Zierde, die den Blick auf die Gruppenwechsel zerschneidet.
 *
 * **„immer sichtbar, nicht ausblendbar" an den zwei gesperrten Zeilen.** Sie standen grau da,
 * ohne Grund — und Grau allein ist eine Ein-Kanal-Aussage (WCAG 1.4.1), dieselbe Sorte
 * Befund, die LFH-345/M16 auf Blockebene gelöst hat.
 *
 * ── Was LFH-383 geändert hat (Zwilling von `Anmeldeverfahren`, LFH-370 · B5j) ─────
 * **Jede der drei Sperrquellen ist je Zeile unterschieden** (`modulSperrGrund`). Die
 * Modul-Eigenschaft und das fehlende Recht tragen ein gedämpftes Kurzwort, die lange
 * Begründung steht im Tooltip DARÜBER — nicht allein im Tooltip: auf dem Führungs-Tablet gibt
 * es kein Hover. Der Wortlaut fürs Recht kommt vom Aufrufer (`rechteGrund`).
 *
 * **Das Kurzwort steht auch dann an jeder Zeile, wenn der `RechteHinweis` darüber dasselbe
 * sagt.** Das reibt sich mit LFH-346/M45 (dort entfällt die Zeilenaktion, weil ein Satz auf
 * der Seite den Grund nennt) — hier aber bleibt das Steuerelement grau STEHEN, und ein grauer
 * Schalter ohne Wort ist genau der Befund; `Anmeldeverfahren` hält es ebenso.
 *
 * **Der Schreibvorgang bekommt keinen Text, sondern den Ladezustand am Steuerelement.** Ein
 * Grund, der nach 200 ms wieder geht, ist Rauschen (Begründung wie in `Anmeldeverfahren`);
 * unterschieden ist er trotzdem, und zwar dort, wo geschrieben wird. `loading` benennt den
 * Schalter nicht um — anders als an einem `Button` trägt er ein eigenes `aria-label`, das die
 * Lade-Ikone schlägt (gepinnt über die Namensabfrage im Test).
 */
export default function ModulEinstellungsListe({
  rollenSpalte,
  rolleVon,
  aufRolle,
  sichtbarSpalte,
  darfVerwalten,
  rechteGrund = RECHTE_GRUND_RUECKFALL,
  laeuftKey,
  fehlerKey,
  hinweisVon,
}: ModulEinstellungsListeProps) {
  const { token } = theme.useToken();
  const { istSchmal } = useViewport();
  const [filter, setFilter] = useState('');
  // `useId`, nicht ein fester String: die Liste ist ein Bauteil, und zwei Instanzen auf einer
  // Seite trügen sonst dieselbe `id` — das `<label for>` zeigte dann auf das falsche Feld.
  const filterId = useId();

  const suchtext = filter.trim().toLowerCase();
  const gruppen = kategorien
    .map((kategorie) => ({
      kategorie,
      module: moduleNachKategorie(kategorie.key).filter(
        (m) => !suchtext || m.label.toLowerCase().includes(suchtext),
      ),
    }))
    .filter((g) => g.module.length > 0);

  // Gestapelt: eine Spalte, Label oben. Breit: Label dehnbar, die beiden Steuerspalten
  // nehmen ihren Inhalt. `minmax(0, 1fr)` statt `1fr`, damit ein langes Label die
  // Nachbarspalten nicht aus dem Container schiebt.
  const raster: CSSProperties = istSchmal
    ? { display: 'grid', gridTemplateColumns: '1fr', gap: token.marginXXS }
    : {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto auto',
        alignItems: 'center',
        gap: token.margin,
      };

  function zeile(m: ModulEintrag) {
    const ausblendbar = istModulAusblendbar(m.key);
    const laeuft = laeuftKey === m.key;
    const sperrGrund = modulSperrGrund({ ausblendbar, darfVerwalten, laeuft });
    const gesperrt = sperrGrund !== null;
    // Nur die zwei dauerhaften Gründe tragen einen Text; der Schreibvorgang zeigt sich am
    // Steuerelement (`loading`).
    const wortlaut =
      sperrGrund === 'modul' ? MODUL_GRUND : sperrGrund === 'rechte' ? rechteGrund : null;
    const hinweis = hinweisVon?.(m.key);
    const hatFehler = fehlerKey === m.key;
    const feldId = `modul-sichtbar-${m.key}`;
    // Ein `<label htmlFor>` NUR an der bedienbaren Zeile — sonst ein `<span>` ohne
    // Zeigerform. Dieselbe Regel wie in `Anmeldeverfahren` (LFH-370): ein Label-Klick
    // auf ein `disabled` Steuerelement leitet der Browser nicht weiter, er waere also
    // eine Aufforderung ohne Reaktion. Das `aria-label` am Switch bleibt und schlaegt
    // das Label (gemessen) — die Bestandsnamen aendern sich dadurch nicht.
    const bedienbar = Boolean(sichtbarSpalte) && !gesperrt;
    const beschriftungStil: CSSProperties = {
      ...modulZeilenStil(token),
      minWidth: 0,
      gap: token.marginXS,
      flexWrap: 'wrap',
    };
    // Der Modulname steht in einem EIGENEN Element, nicht als nackter Textknoten neben dem
    // Zusatz: sonst trüge die Hülle beide Texte, und eine Abfrage auf den Modulnamen fände
    // die Zeile nicht mehr (`textContent` der Hülle wäre „Einsatzdatenimmer sichtbar …").
    const beschriftung = (
      <>
        <span>{m.label}</span>
        {wortlaut && (
          // Kurzwort sichtbar, lange Begründung im Tooltip darüber — und der Tooltip hängt an
          // einem NICHT gesperrten Element, braucht also keinen Wrapper.
          <Tooltip title={wortlaut.lang}>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {wortlaut.kurz}
            </Typography.Text>
          </Tooltip>
        )}
      </>
    );
    return (
      <div
        key={m.key}
        data-modul-zeile={m.key}
        data-fehler={hatFehler ? 'true' : undefined}
        style={{
          ...raster,
          borderInlineStart: hatFehler ? `3px solid ${token.colorError}` : undefined,
        }}
      >
        {bedienbar ? (
          <label htmlFor={feldId} style={{ ...beschriftungStil, cursor: 'pointer' }}>
            {beschriftung}
          </label>
        ) : (
          <span style={beschriftungStil}>{beschriftung}</span>
        )}
        {sichtbarSpalte && (
          <div style={{ textAlign: istSchmal ? 'start' : 'center' }}>
            <Switch
              id={feldId}
              aria-label={`Sichtbar: ${m.label}`}
              checked={ausblendbar ? sichtbarSpalte.sichtbarVon(m.key) : true}
              disabled={gesperrt}
              loading={laeuft}
              onChange={(checked) => sichtbarSpalte.aufSichtbar(m.key, checked)}
            />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <Select
            aria-label={`Benötigte Rolle: ${m.label}`}
            style={{ width: '100%' }}
            value={rolleVon(m.key)}
            disabled={gesperrt}
            loading={laeuft}
            options={ROLLEN_OPTIONEN}
            onChange={(val) => aufRolle(m.key, val)}
          />
          {hinweis && (
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {hinweis}
            </Typography.Text>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: token.margin }}>
      <div style={{ maxWidth: 260 }}>
        <label htmlFor={filterId} style={{ display: 'block', marginBottom: token.marginXXS }}>
          Modul filtern
        </label>
        <Input
          id={filterId}
          allowClear
          placeholder="Modulname"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {gruppen.length === 0 ? (
        <Typography.Text type="secondary">Kein Modul passt zum Filter.</Typography.Text>
      ) : (
        <>
          {!istSchmal && (
            <div style={{ ...raster, fontSize: token.fontSizeSM, opacity: 0.6 }}>
              <span>Modul</span>
              {sichtbarSpalte && (
                <span style={{ textAlign: 'center' }}>{sichtbarSpalte.titel}</span>
              )}
              <span>{rollenSpalte}</span>
            </div>
          )}
          {gruppen.map((g) => (
            <div key={g.kategorie.key}>
              <SektionHeader titel={g.kategorie.label} ueberschrift="h3" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
                {g.module.map(zeile)}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
