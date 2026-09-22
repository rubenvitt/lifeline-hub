import { theme } from 'antd';
import { form } from '../theme/tokens';
import { useModusFarben } from '../components/rahmenStil';
import { ModulListe } from './ModulPanel';
import {
  moduleNachKategorie,
  type Kategorie,
  type KategorieKey,
  type ModulEintrag,
} from './modulRegistry';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import type { ModulZaehlerMap } from './useModulZaehler';

/**
 * Die Einsatz-Navigation als flaches Akkordeon in EINER Spalte (LFH-329 · B1/H11).
 *
 * WARUM NICHT RAIL + MODUL-SPALTE IM DRAWER: die beiden nebeneinander brauchen
 * mehr Breite, als der Drawer trägt (`navDrawerBreite`), und ein entsprechend
 * verbreiterter Drawer belegte auf dem Handschirm (~390 px) über vier Fünftel
 * der Fläche. Hier steht deshalb je Kategorie eine Kopfzeile, und nur unter der
 * offenen stehen ihre Module.
 *
 * DIE KOPFZEILE IST DER UMSCHALTER — im Drawer gibt es kein zusätzliches
 * Einklappen. Das gemerkte „Panel eingeklappt" (`navPersistenz`) gehört
 * ausschließlich zum inline-Rahmen; sonst trüge derselbe Schalter in zwei
 * Darstellungen zwei Bedeutungen.
 *
 * Der Name der Landmarke ist bewusst NICHT „Kategorien": so heißt die
 * {@link IconRail}. Zwei gleichnamige Landmarken machten jede Abfrage danach
 * mehrdeutig, sobald beide gleichzeitig im Baum stehen.
 */
interface Props {
  kategorien: Kategorie[];
  offeneKategorie: KategorieKey | null;
  aktiverModulKey: string | null;
  benutzer: BenutzerAnzeige | null;
  /** Modul-Overrides des Einsatzes (LFH-132); wird an die Modulliste durchgereicht. */
  overrides?: ModulOverrides;
  onKategorieKlick: (key: KategorieKey) => void;
  onModulKlick: (modul: ModulEintrag) => void;
  zaehler?: ModulZaehlerMap;
}

/**
 * 48 px ist die Trefffläche aus A1 Festlegung 4 (Material 48 dp) — dieselbe Zahl,
 * die die Rail schon trägt. Der Drawer ist der Berührungsfall; das ist eine
 * Trefffläche, keine Dichte-Angabe an einem Steuerelement.
 */
const TREFFLAECHE = 48;

export default function ModulAkkordeon({
  kategorien,
  offeneKategorie,
  aktiverModulKey,
  benutzer,
  overrides,
  onKategorieKlick,
  onModulKlick,
  zaehler,
}: Props) {
  const { token } = theme.useToken();
  const farben = useModusFarben();
  return (
    <nav aria-label="Einsatz-Navigation" style={{ display: 'flex', flexDirection: 'column' }}>
      {kategorien.map((k) => {
        const offen = k.key === offeneKategorie;
        const Icon = k.icon;
        return (
          <div key={k.key}>
            <button
              type="button"
              aria-expanded={offen}
              onClick={() => onKategorieKlick(k.key)}
              // Optisch an die Rail angeglichen (Neuentwurf): aufgeklappt `flaeche3` mit
              // heller Schrift und der 2-px-Ortsmarke in `marke`, zu gedämpft. Die Marke ist
              // Ort, nicht Bedienung — die Fläche bleibt neutral („Rot bedient nichts").
              // `Math.max(48, controlHeight)`: 48 ist der A1-Boden des Berührungsfalls, in
              // `handschuh` wächst die Kopfzeile auf 72 mit (Befund LFH-537 für diese Stelle).
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: token.marginSM,
                width: '100%',
                minHeight: Math.max(TREFFLAECHE, token.controlHeight),
                padding: `0 ${token.padding}px`,
                border: 'none',
                borderRadius: form.radiusSteuer,
                textAlign: 'left',
                cursor: 'pointer',
                fontWeight: offen ? 600 : 400,
                background: offen ? farben.flaeche3 : 'transparent',
                boxShadow: offen ? `inset 2px 0 0 ${farben.marke}` : 'none',
                color: offen ? farben.text : farben.gedaempft,
              }}
            >
              <span aria-hidden="true" style={{ display: 'inline-flex', flexShrink: 0 }}>
                <Icon size={20} />
              </span>
              <span>{k.label}</span>
            </button>
            {offen && (
              <div style={{ background: farben.paneel }}>
                <ModulListe
                  module={moduleNachKategorie(k.key)}
                  benutzer={benutzer}
                  overrides={overrides}
                  aktiverModulKey={aktiverModulKey}
                  onModulKlick={onModulKlick}
                  mindestTrefflaeche={TREFFLAECHE}
                  zaehler={zaehler}
                />
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
