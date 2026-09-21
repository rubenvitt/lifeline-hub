import type { ReactNode } from 'react';
import Datenstand from '../Datenstand';
import Paneel, { type PaneelUeberschrift } from './Paneel';
import { useRollen } from './rollenwerte';

/**
 * Feldgruppe einer Formularseite im Neuentwurf: ein `Paneel` mit Augenbrauen-Kopf statt
 * einer Überschrift über losen Feldern. Die Gruppe ist eine Überschrift der Ebene 2 — der
 * Seitentitel im Kopf ist das `h1`, die Paneele gliedern direkt darunter.
 *
 * Seit 22.09.2026 ein Baustein (vorher lokal in `pages/einstellungen/`): die Stammdaten-
 * Formulare (Organisation, Fahrzeug- und Personal-Detail) nutzen dieselbe feste Kombination
 * (Kopf + optionale Beschreibung + gepolsterter Körper + Abstand nach unten).
 *
 * Die Felder bleiben Kinder desselben `<Form>` — das Paneel ist reine Hülle. Die sticky
 * Speichern-Leiste steht DANACH im selben `<form>` (Enter sendet, Erfassungs-Norm B4).
 */
export default function Formularpaneel({
  titel,
  beschreibung,
  aktion,
  dataUpdatedAt,
  ueberschrift = 'h2',
  children,
}: {
  titel: ReactNode;
  /** Einzeilige Erklärung unter dem Kopf, gedämpft. */
  beschreibung?: ReactNode;
  /** Aktion rechts im Kopf (öffnet etwas — nie ein Absende-Knopf). */
  aktion?: ReactNode;
  /** Letzter erfolgreicher Abruf (`query.dataUpdatedAt`) — steht als Mono-Meta im Kopf. */
  dataUpdatedAt?: number;
  /** Überschriftenebene; Vorgabe `h2` (direkt unter dem Seitentitel). */
  ueberschrift?: PaneelUeberschrift;
  children: ReactNode;
}) {
  const { token, rollen } = useRollen();
  return (
    <Paneel
      titel={titel}
      ueberschrift={ueberschrift}
      aktion={aktion}
      meta={dataUpdatedAt ? <Datenstand dataUpdatedAt={dataUpdatedAt} /> : undefined}
      koerperPolster
      style={{ marginBlockEnd: token.margin }}
    >
      {beschreibung != null && (
        <p style={{ margin: 0, marginBlockEnd: token.marginSM, color: rollen.gedaempft }}>
          {beschreibung}
        </p>
      )}
      {children}
    </Paneel>
  );
}
