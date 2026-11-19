/**
 * Paneel „Pegel" der Modulseite „Wetter & Pegel".
 *
 * Eine LISTE, keine Tabelle: 1 bis 5 Stationen, gelesen statt verglichen. Die Werte kommen aus
 * {@link pegelZeile}, damit Dashboard, Überblick und diese Seite dieselben Schwellen lesen.
 * Der Verlauf ist eine eigene Abfrage; fällt nur sie aus, bleiben die Werte stehen.
 *
 * Ohne festgelegten Pegel steht statt des Paneels {@link PegelLeerzeile} (LLH-1117).
 */
import type { PegelAnzeige, PegelVerlauf } from '../api/types';
import type { AnzeigeKonventionen } from '../anzeige/format';
import {
  Augenbraue,
  Paneel,
  PaneelLink,
  PaneelZustand,
  Stapel,
  Textstufe,
  monoStil,
  useRollen,
  type PaneelDatenzustand,
} from '../components/instrument';
import { KEIN_PEGEL, VERALTET, pegelZeile, prognoseOffen } from '../pegel/pegelKennzahl';
import Verlaufslinie from './Verlaufslinie';

const VERLAUF_FEHLT = 'Verlauf nicht abrufbar';
const KEIN_VERLAUF = 'noch kein Verlauf';
/** Wortlaut des Leerzustands — bewusst NICHT „Pegel festlegen": so heißt der Nebenweg im
    Seitenkopf, zwei gleichnamige Ziele wären für Vorlesende nicht zu unterscheiden. */
const ZU_DEN_EINSTELLUNGEN = 'Zu Einstellungen › Pegel';

/**
 * Der Pegel als EINE Zeile, wenn am Einsatz kein Pegel festgelegt ist (LLH-1117, Spec
 * `lage-wetter-pegel`, „Reihenfolge der Modulseite"): nur der Kopf eines Paneels, „kein Pegel
 * festgelegt" als Meta, der Weg zu Einstellungen › Pegel als Aktion. Ein Pegel ist nur in einer
 * Hochwasserlage die führende Größe; sonst steht er zuletzt und klein.
 */
export function PegelLeerzeile({ onEinstellungen }: { onEinstellungen: () => void }) {
  return (
    <Paneel
      titel="Pegel"
      meta={KEIN_PEGEL}
      aktion={<PaneelLink label={ZU_DEN_EINSTELLUNGEN} onKlick={onEinstellungen} />}
    />
  );
}

interface PegelPaneelProps {
  zustand: PaneelDatenzustand;
  pegel: readonly PegelAnzeige[];
  /** `undefined` solange geladen wird, `null` bei Fehler der Verlaufsabfrage. */
  verlauf: readonly PegelVerlauf[] | null | undefined;
  jetzt: number;
  konv: AnzeigeKonventionen;
  onEinstellungen: () => void;
  onNeuladen: () => void;
}

export default function PegelPaneel({
  zustand,
  pegel,
  verlauf,
  jetzt,
  konv,
  onEinstellungen,
  onNeuladen,
}: PegelPaneelProps) {
  const { token, rollen } = useRollen();
  return (
    <Paneel
      titel="Pegel"
      meta={zustand === 'daten' ? `${pegel.length} maßgeblich · 24 h` : undefined}
    >
      <PaneelZustand
        zustand={zustand}
        titel="Pegel"
        leerText={KEIN_PEGEL}
        leerAktion={ZU_DEN_EINSTELLUNGEN}
        onLeerAktion={onEinstellungen}
        onNeuladen={onNeuladen}
      >
        <ul aria-label="Maßgebliche Pegel" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {pegel.map((p) => {
            const z = pegelZeile(p, jetzt, konv);
            const reihe = verlauf?.find((v) => v.pegel_id === p.id)?.punkte ?? [];
            const prognoseCm =
              p.prognose && prognoseOffen(p.prognose, jetzt) ? p.prognose.hoechststand_cm : null;
            return (
              <li
                key={p.id}
                data-lfh="pegel-zeile"
                data-fall={z.fall}
                data-ton={z.ton}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                  gap: token.marginSM,
                  alignItems: 'center',
                  paddingBlock: token.paddingSM,
                  paddingInline: token.padding,
                  borderBlockEnd: `1px solid ${rollen.flaeche3}`,
                  // Zweiter Kanal zum Wort „veraltet"/„Stand unbekannt": die Kante in der Rollenfarbe.
                  boxShadow: z.ton === 'achtung' ? `inset 3px 0 0 ${rollen.achtung}` : undefined,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <Augenbraue als="h3">
                    {z.name}
                    {z.gewaesser ? ` · ${z.gewaesser}` : ''}
                  </Augenbraue>
                  <Stapel richtung="zeile" abstand="xs" ausrichten="baseline">
                    <span style={{ ...monoStil(28, 500), color: rollen.text }}>{z.wert}</span>
                    {z.einheit && <Textstufe ton="gedaempft">{z.einheit}</Textstufe>}
                  </Stapel>
                  <Textstufe als="div" stufe="textKlein" ton="text2">
                    {[z.trend, z.stand].filter(Boolean).join(' · ')}
                    {z.veraltet && (
                      <span style={{ color: rollen.achtungText, fontWeight: 600 }}>
                        {' · '}
                        {VERALTET}
                      </span>
                    )}
                  </Textstufe>
                  {z.prognose && (
                    <Textstufe als="div" stufe="textKlein" ton="text2">
                      {z.prognose}
                    </Textstufe>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  {z.fall === 'ausfall' ? null : verlauf === null ? (
                    <Textstufe stufe="textKlein" ton="gedaempft">
                      {VERLAUF_FEHLT}
                    </Textstufe>
                  ) : verlauf === undefined ? null : reihe.length === 0 ? (
                    <Textstufe stufe="textKlein" ton="gedaempft">
                      {KEIN_VERLAUF}
                    </Textstufe>
                  ) : (
                    <Verlaufslinie
                      punkte={reihe}
                      richtung={z.richtung}
                      prognoseCm={prognoseCm}
                      konv={konv}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </PaneelZustand>
    </Paneel>
  );
}
