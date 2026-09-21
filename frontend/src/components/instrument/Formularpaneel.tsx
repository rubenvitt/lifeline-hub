import type { ReactNode } from 'react';
import Datenstand from '../../components/Datenstand';
import { Paneel, useRollen } from '../../components/instrument';

/**
 * Feldgruppe einer Einstellungsseite im Neuentwurf: ein `Paneel` mit Augenbrauen-Kopf statt
 * einer Überschrift über losen Feldern. Die Gruppe ist eine Überschrift der Ebene 3 (die
 * Seite trägt h4 im Seitenkopf nicht als Gliederungsanfang, sondern als Titel — Paneele
 * gliedern darunter, wie auf `EinsatzdatenPage`).
 *
 * LOKAL in `pages/einstellungen/`, weil `components/instrument/**` parallel benutzt wird;
 * gebraucht wird hier nur eine feste Kombination (Kopf + optionale Beschreibung + gepolsterter
 * Körper + Abstand nach unten), keine neue Fähigkeit des Bausteins.
 *
 * Die Felder bleiben Kinder desselben `<Form>` — das Paneel ist reine Hülle. Die sticky
 * Speichern-Leiste steht DANACH im selben `<form>` (Enter sendet, Erfassungs-Norm B4).
 */
export default function Formularpaneel({
  titel,
  beschreibung,
  aktion,
  dataUpdatedAt,
  children,
}: {
  titel: ReactNode;
  /** Einzeilige Erklärung unter dem Kopf, gedämpft. */
  beschreibung?: ReactNode;
  /** Aktion rechts im Kopf (öffnet etwas — nie ein Absende-Knopf). */
  aktion?: ReactNode;
  /** Letzter erfolgreicher Abruf (`query.dataUpdatedAt`) — steht als Mono-Meta im Kopf. */
  dataUpdatedAt?: number;
  children: ReactNode;
}) {
  const { token, rollen } = useRollen();
  return (
    <Paneel
      titel={titel}
      ueberschrift="h3"
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
