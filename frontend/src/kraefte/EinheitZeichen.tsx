import { baueTzProps } from '../pages/lagekarte/taktischesZeichen';
import { useRollen } from '../components/instrument';
import EinsatzZeichen from '../zeichen/EinsatzZeichen';
import { useZeichenTheme } from '../zeichen/useZeichenTheme';
import type { TzEinheit, TzFahrzeug } from './meldebildRaster';

/**
 * Der Symbolplatz „TZ" der Einheitenzeile: das taktische Zeichen der Einheit, 26 × 26 px.
 * Dieselbe Ableitung wie auf der Lagekarte (`baueTzProps`) und dieselbe Zeichnung
 * (`EinsatzZeichen`, @einsatzzeichen, LFH-835). Der Organisations-Vorgabewert der Karte fehlt
 * bewusst — eine weitere Query für einen Zierrahmen wäre zu teuer. Ohne eigene Organisation
 * zeichnet die Bibliothek nur einen schwarzen Umriss, im Nachtbetrieb sonst schwarz auf schwarz;
 * deshalb zeichnet sie es nachts selbst hell (Render-Theme `dark`, `useZeichenTheme`, LLH-1409).
 * Reine Zierde, `aria-hidden`: die Bezeichnung daneben benennt die Einheit.
 *
 * Die Einheit-Ansicht (LLH-1036, design.md D4) zeigt dasselbe Zeichen groß im Kopf (`groesse`)
 * und mit der Vorgabe der Organisation (`orgDefault`), wie die Lagekarte; das Meldebild ruft ohne
 * beide und bleibt, wie es ist.
 */
export default function EinheitZeichen({
  tz,
  groesse = 26,
  orgDefault = null,
}: {
  tz: TzEinheit | null;
  /** Kantenlänge des Rahmens in px; das Zeichen darin ist 4 px kleiner. */
  groesse?: number;
  /** Organisations-Vorgabe aus `/api/organisation`; eine eigene Organisation geht vor. */
  orgDefault?: string | null;
}) {
  const { rollen } = useRollen();
  const theme = useZeichenTheme();
  return (
    <span
      aria-hidden
      data-lfh="einheit-zeichen"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: `0 0 ${groesse}px`,
        width: groesse,
        height: groesse,
        border: `1px solid ${rollen.linieStark}`,
      }}
    >
      {tz && (
        <EinsatzZeichen
          tz={baueTzProps({
            objekttyp: 'einheit',
            einheitTypLabel: tz.typLabel,
            fachaufgabe: tz.fachaufgabe,
            organisation: tz.organisation,
            orgDefault,
          })}
          size={groesse - 4}
          theme={theme}
        />
      )}
    </span>
  );
}

/**
 * Das taktische Zeichen eines Fahrzeugs in der Fahrzeugzeile des Kräftebaums (LLH-1025), 22 × 22
 * px und damit kleiner als das der Einheit: Zeichen UND Größe unterscheiden die Zeilenart ohne
 * Farbe (Graustufendruck). Grundzeichen aus dem Fahrzeugtyp, Organisation aus Träger bzw. OPTA,
 * wie auf der Lagekarte (`baueTzProps`); ohne Treffer der Rückfall „Fahrzeug“, nie ein leeres
 * Zeichen (Spec `lagekarte-taktische-zeichen`). Reine Zierde, `aria-hidden`.
 */
export function FahrzeugZeichen({ tz }: { tz: TzFahrzeug }) {
  const { rollen } = useRollen();
  const theme = useZeichenTheme();
  return (
    <span
      aria-hidden
      data-lfh="fahrzeug-zeichen"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 22px',
        width: 22,
        height: 22,
        border: `1px solid ${rollen.linieStark}`,
      }}
    >
      <EinsatzZeichen
        tz={baueTzProps({
          objekttyp: 'fahrzeug',
          fahrzeugtyp: tz.fahrzeugtyp,
          traegerorganisation: tz.traegerorganisation,
          opta: tz.opta,
          fachaufgabe: tz.fachaufgabe,
          organisation: tz.organisation,
        })}
        size={18}
        theme={theme}
      />
    </span>
  );
}
