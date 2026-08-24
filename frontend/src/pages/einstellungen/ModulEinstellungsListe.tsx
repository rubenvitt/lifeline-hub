import { Switch, Typography, theme } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { Select } from '../../components/Select';
import { useViewport } from '../../components/useViewport';
import { modulRegistry, istModulAusblendbar } from '../../einsatz/modulRegistry';
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
 */
export default function ModulEinstellungsListe({
  rollenSpalte,
  rolleVon,
  aufRolle,
  sichtbarSpalte,
  darfVerwalten,
  laeuftKey,
  fehlerKey,
  hinweisVon,
}: ModulEinstellungsListeProps) {
  const { token } = theme.useToken();
  const { istSchmal } = useViewport();

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
      {!istSchmal && (
        <div style={{ ...raster, fontSize: token.fontSizeSM, opacity: 0.6 }}>
          <span>Modul</span>
          {sichtbarSpalte && <span style={{ textAlign: 'center' }}>{sichtbarSpalte.titel}</span>}
          <span>{rollenSpalte}</span>
        </div>
      )}
      {modulRegistry.map((m) => {
        const ausblendbar = istModulAusblendbar(m.key);
        const gesperrt = !darfVerwalten || !ausblendbar || laeuftKey === m.key;
        const hinweis = hinweisVon?.(m.key);
        const hatFehler = fehlerKey === m.key;
        const feldId = `modul-sichtbar-${m.key}`;
        // Ein `<label htmlFor>` NUR an der bedienbaren Zeile — sonst ein `<span>` ohne
        // Zeigerform. Dieselbe Regel wie in `Anmeldeverfahren` (LFH-370): ein Label-Klick
        // auf ein `disabled` Steuerelement leitet der Browser nicht weiter, er waere also
        // eine Aufforderung ohne Reaktion. Das `aria-label` am Switch bleibt und schlaegt
        // das Label (gemessen) — die Bestandsnamen aendern sich dadurch nicht.
        const bedienbar = Boolean(sichtbarSpalte) && !gesperrt;
        const beschriftungStil = { ...modulZeilenStil(token), minWidth: 0 };
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
                {m.label}
              </label>
            ) : (
              <span style={beschriftungStil}>{m.label}</span>
            )}
            {sichtbarSpalte && (
              <div style={{ textAlign: istSchmal ? 'start' : 'center' }}>
                <Switch
                  id={feldId}
                  aria-label={`Sichtbar: ${m.label}`}
                  checked={ausblendbar ? sichtbarSpalte.sichtbarVon(m.key) : true}
                  disabled={gesperrt}
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
      })}
    </div>
  );
}
