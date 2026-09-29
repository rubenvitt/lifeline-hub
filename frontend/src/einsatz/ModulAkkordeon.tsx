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
import { sprungmarkenNachKategorie, type Sprungmarke } from './sprungmarken';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import type { ModulZaehlerMap } from './useModulZaehler';

/**
 * Die Einsatz-Navigation als flaches Akkordeon in EINER Spalte (LFH-329).
 *
 * Rail und Modul-Spalte nebeneinander bräuchten mehr Breite, als der Drawer trägt; auf dem
 * Handschirm belegte er sonst über vier Fünftel der Fläche. Je Kategorie steht deshalb eine
 * Kopfzeile, und nur unter der offenen stehen ihre Module.
 *
 * DIE KOPFZEILE IST DER UMSCHALTER. Das gemerkte „Panel eingeklappt" (`navPersistenz`) gehört
 * nur zum inline-Rahmen, sonst trüge derselbe Schalter zwei Bedeutungen.
 *
 * Die Landmarke heißt bewusst NICHT „Kategorien" wie die {@link IconRail}: zwei gleichnamige
 * Landmarken machten jede Abfrage mehrdeutig.
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
  /** Sprungmarken (LFH-620) — dieselben wie im Panel, je Kategorie. */
  onSprungKlick?: (marke: Sprungmarke) => void;
  zaehler?: ModulZaehlerMap;
}

/**
 * 48 px ist die Trefffläche des Berührungsfalls (Material 48 dp), dieselbe Zahl wie an der
 * Rail — eine Trefffläche, keine Dichte-Angabe.
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
  onSprungKlick,
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
              // An die Rail angeglichen: aufgeklappt `flaeche3` mit heller Schrift und der 2-px-Ortsmarke
              // in `marke`, zu gedämpft. Die Marke ist Ort, nicht Bedienung („Rot bedient nichts").
              // `Math.max(48, controlHeight)`: 48 ist der Boden, in `handschuh` wächst die Kopfzeile auf 72.
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
                  sprungmarken={sprungmarkenNachKategorie(k.key)}
                  onSprungKlick={onSprungKlick}
                />
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
