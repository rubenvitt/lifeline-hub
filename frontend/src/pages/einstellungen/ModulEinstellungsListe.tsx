import { Switch, Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import { Select } from '../../components/Select';
import { modulRegistry, istModulAusblendbar } from '../../einsatz/modulRegistry';
import { ROLLEN_OPTIONEN } from './optionen';

/** Breite der Rollen-Spalte — beide Aufrufer hatten dieselbe. */
const ROLLEN_BREITE = 180;
/** Breite der Sichtbar-Spalte. */
const SICHTBAR_BREITE = 64;

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
  /** Läuft gerade eine Mutation? Dann bleibt alles gesperrt. */
  laeuft: boolean;
  /** Gedämpfter Zusatz unter dem Select, z. B. der geerbte Org-Default. */
  hinweisVon?: (modulKey: string) => ReactNode;
}

/**
 * Modul-Zeilenliste der Einstellungsseiten (LFH-328 · A2).
 *
 * Zusammengezogen aus zwei handgebauten Listen: der Einsatz-Ebene
 * (`EinsatzEinstellungenPage`, drei Spalten mit Sichtbar-Schalter) und der Org-Ebene
 * (`einstellungen/EinsatzDefaults`, zwei Spalten). Die Unterschiede beider Aufrufer
 * sind Props geworden; was gleich war — Zeilenraster, Spaltenbreiten, aria-Namen —
 * steht nur noch hier.
 *
 * **Bewusst Callbacks statt einer Mutation als Prop:** die Payloads unterscheiden
 * sich fachlich (`{sichtbar, benoetigte_rolle}` gegen `{rolle}`), und der Aufrufer
 * kennt seinen Endpunkt. Die Liste meldet nur, WAS geändert wurde.
 *
 * **`istModulAusblendbar` wird hier ausgewertet, nicht vom Aufrufer:** Stammdaten und
 * Einstellungen selbst lassen sich weder ausblenden noch auf eine Rolle beschränken —
 * das ist eine Eigenschaft des Moduls, keine Berechtigungsfrage, und muss deshalb auch
 * für Verwaltende gesperrt bleiben.
 */
export default function ModulEinstellungsListe({
  rollenSpalte,
  rolleVon,
  aufRolle,
  sichtbarSpalte,
  darfVerwalten,
  laeuft,
  hinweisVon,
}: ModulEinstellungsListeProps) {
  const { token } = theme.useToken();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: token.margin,
          fontSize: token.fontSizeSM,
          opacity: 0.6,
        }}
      >
        <span style={{ flex: 1 }}>Modul</span>
        {sichtbarSpalte && (
          <span style={{ width: SICHTBAR_BREITE, textAlign: 'center' }}>{sichtbarSpalte.titel}</span>
        )}
        <span style={{ width: ROLLEN_BREITE }}>{rollenSpalte}</span>
      </div>
      {modulRegistry.map((m) => {
        const ausblendbar = istModulAusblendbar(m.key);
        const gesperrt = !darfVerwalten || !ausblendbar || laeuft;
        const hinweis = hinweisVon?.(m.key);
        return (
          <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: token.margin }}>
            <span style={{ flex: 1 }}>{m.label}</span>
            {sichtbarSpalte && (
              <div style={{ width: SICHTBAR_BREITE, textAlign: 'center' }}>
                <Switch
                  aria-label={`Sichtbar: ${m.label}`}
                  checked={ausblendbar ? sichtbarSpalte.sichtbarVon(m.key) : true}
                  disabled={gesperrt}
                  onChange={(checked) => sichtbarSpalte.aufSichtbar(m.key, checked)}
                />
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Select
                aria-label={`Benötigte Rolle: ${m.label}`}
                style={{ width: ROLLEN_BREITE }}
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
