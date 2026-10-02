import type { CSSProperties } from 'react';
import { theme } from 'antd';
import { form, type Farbrollen } from '../theme/tokens';
import { useModusFarben } from '../components/rahmenStil';
import { ModulListe } from './ModulPanel';
import {
  moduleNachKategorie,
  type Kategorie,
  type KategorieKey,
  type ModulEintrag,
} from './modulRegistry';
import { sprungmarkenNachKategorie, type Sprungmarke } from './sprungmarken';
import type { ModulFreigaben } from '../api/types';
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
  /** Modulfreigaben des Servers (LFH-669); wird an die Modulliste durchgereicht. */
  freigaben?: ModulFreigaben;
  onKategorieKlick: (key: KategorieKey) => void;
  onModulKlick: (modul: ModulEintrag) => void;
  /** Sprungmarken (LFH-620) — dieselben wie im Panel, je Kategorie. */
  onSprungKlick?: (marke: Sprungmarke) => void;
  zaehler?: ModulZaehlerMap;
}

/**
 * 48 px ist die Trefffläche des Berührungsfalls (Material 48 dp) — ein BODEN unter der Staffel,
 * nie ihr Deckel: `handschuh` hält 72 (LFH-384, LFH-537). So trägt die Rail seit LFH-337 ihren
 * Boden (`railZielStil`), und so rechnen Hamburger und Drawer-Schließer (`navGriffMass`).
 */
const TREFFLAECHE = 48;

/** Die Farbrollen, die eine Kopfzeile liest — als Ausschnitt, damit der Test sie setzen kann. */
type KopfFarben = Pick<Farbrollen, 'flaeche3' | 'marke' | 'text' | 'gedaempft'>;

/**
 * Stil einer Kategorie-Kopfzeile — rein und exportiert, damit die Dichte-Zusicherung ohne
 * Rendern prüfbar ist: `test/utils.tsx` hat kein Theme (`controlHeight: 32`), dort sähe der
 * Knopf 48 mit und ohne Staffel (LFH-537). Bauform wie `railZielStil` (`IconRail.tsx`).
 *
 * `Math.max` und NICHT `??`: die Staffel darf den Boden heben, nie senken. ZWEI Angaben:
 * `minHeight` PLUS Polsterung; aufgelöste Tokens, nie `var(--lfh-*)`.
 *
 * An die Rail angeglichen: aufgeklappt `flaeche3` mit heller Schrift und der 2-px-Ortsmarke in
 * `marke`, zu gedämpft. Die Marke ist Ort, nicht Bedienung („Rot bedient nichts").
 */
export function akkordeonKopfStil(
  token: { controlHeight: number; padding: number; marginSM: number },
  farben: KopfFarben,
  zustand: { offen: boolean },
): CSSProperties {
  const { offen } = zustand;
  return {
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
  };
}

export default function ModulAkkordeon({
  kategorien,
  offeneKategorie,
  aktiverModulKey,
  freigaben,
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
        // Umriss auch aufgeklappt: „offen“ ist kein aktiver Zustand, die Füllung trägt allein die
        // Rail (LFH-595, Spec `iconsatz`).
        const Icon = k.icon.umriss;
        return (
          <div key={k.key}>
            <button
              type="button"
              aria-expanded={offen}
              onClick={() => onKategorieKlick(k.key)}
              style={akkordeonKopfStil(token, farben, { offen })}
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
                  freigaben={freigaben}
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
