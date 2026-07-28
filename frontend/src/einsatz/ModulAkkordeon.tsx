import { theme } from 'antd';
import { abstand, form } from '../theme/tokens';
import { ModulListe } from './ModulPanel';
import {
  moduleNachKategorie,
  type Kategorie, type KategorieKey, type ModulEintrag,
} from './modulRegistry';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';

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
}: Props) {
  const { token } = theme.useToken();
  return (
    <nav
      aria-label="Einsatz-Navigation"
      style={{ display: 'flex', flexDirection: 'column', gap: abstand.xs }}
    >
      {kategorien.map((k) => {
        const offen = k.key === offeneKategorie;
        const Icon = k.icon;
        return (
          <div key={k.key}>
            <button
              type="button"
              aria-expanded={offen}
              onClick={() => onKategorieKlick(k.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: abstand.md,
                width: '100%',
                minHeight: TREFFLAECHE,
                padding: `0 ${abstand.sm}px`,
                border: 'none',
                borderRadius: form.radiusSteuer,
                textAlign: 'left',
                cursor: 'pointer',
                // Bedienung, nicht Marke: der aufgeklappte Zustand ist ein
                // Navigationszustand („Rot bedient nichts", LFH-315/A0).
                background: offen ? token.colorPrimaryBg : 'transparent',
                color: offen ? token.colorPrimary : 'inherit',
              }}
            >
              <Icon size={24} />
              <span>{k.label}</span>
            </button>
            {offen && (
              <div style={{ paddingLeft: abstand.md }}>
                <ModulListe
                  module={moduleNachKategorie(k.key)}
                  benutzer={benutzer}
                  overrides={overrides}
                  aktiverModulKey={aktiverModulKey}
                  onModulKlick={onModulKlick}
                  mindestTrefflaeche={TREFFLAECHE}
                />
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
