import { Alert, Button } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { zeitpunkt } from '../anzeige/zeitDarstellung';
import { globalKeys } from '../api/queryKeys';
import { listeSchnappschuesse } from '../api/stammdatenEingang';
import type { StammdatenSchnappschuss } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Stapel } from '../components/instrument';
import { StammdatenEinlesenDialog } from './StammdatenEinlesen';

/**
 * Hinweis auf offene Schnappschüsse des Stammdaten-Abrufs (LLH-1194, Entwurf `personal-abruf`,
 * „Oberfläche“): je offenem Schnappschuss eine Zeile „Neue Personaldaten aus ‹Herkunft› vom ‹Zeit›
 * zum Prüfen“ mit „Prüfen“, das den Dialog des Stammdaten-Eingangs mit dieser Quelle öffnet.
 *
 * Nur für Admins (dieselbe Tür wie die Route): ohne Recht fragt der Hinweis nichts an. Ohne
 * offenen Schnappschuss steht nichts da. Der Dialog hängt nicht an der Zeile: nach dem Übernehmen
 * verschwindet die Zeile, das Ergebnis bleibt bis „Schließen“ stehen. Ein neuer Schnappschuss
 * erscheint beim nächsten Laden, nicht live (`api/queryKeys.ts`, `NICHT_LIVE_GLOBAL_KEYS`).
 */

interface SchnappschussHinweisProps {
  /** Nur die Schnappschüsse dieses Adapters (Ansicht des Adapters); sonst alle der Org. */
  adapterId?: string;
}

export default function SchnappschussHinweis({ adapterId }: SchnappschussHinweisProps) {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const { konventionen: konv } = useAnzeigeKonventionen();
  const [pruefe, setPruefe] = useState<StammdatenSchnappschuss | null>(null);

  const liste = useQuery({
    queryKey: globalKeys.stammdatenSchnappschuesse(),
    queryFn: listeSchnappschuesse,
    enabled: istAdmin,
  });

  const offen = (liste.data ?? []).filter((s) => adapterId == null || s.adapter_id === adapterId);
  if (!istAdmin || (offen.length === 0 && pruefe == null)) return null;

  return (
    <div data-lfh="schnappschuss-hinweise">
      <Stapel abstand="sm">
        {offen.map((s) => (
          <Alert
            key={s.id}
            type="info"
            showIcon
            data-lfh="schnappschuss-hinweis"
            title={`Neue Personaldaten aus ${s.herkunft} vom ${zeitpunkt(s.abgerufen_at, konv)} zum Prüfen`}
            action={<Button onClick={() => setPruefe(s)}>Prüfen</Button>}
          />
        ))}
      </Stapel>
      {pruefe != null && (
        <StammdatenEinlesenDialog
          key={pruefe.id}
          quelle={{ art: 'schnappschuss', id: pruefe.id }}
          offen
          onSchliessen={() => setPruefe(null)}
        />
      )}
    </div>
  );
}
