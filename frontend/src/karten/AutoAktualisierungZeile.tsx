import { Space, Switch, theme, Typography } from 'antd';
import { Select } from '../components/Select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  speichereAutoAktualisierung,
  type AktualisierungsStatus,
  type AutoAktualisierungBody,
} from '../api/offlineKarten';
import { globalKeys } from '../api/queryKeys';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { ortszeit } from './ortszeit';

/** Auswahl des Prüfabstands (Stunden); der Server nimmt 1…168. */
const ABSTAENDE = [1, 3, 6, 12, 24, 168];

/** „6 h“ bzw. „7 Tage“. */
export function abstandText(stunden: number): string {
  return stunden === 168 ? '7 Tage' : `${stunden} h`;
}

/**
 * Zeile über der Offline-Karten-Tabelle (LFH-993, D9): ob automatisch aktualisiert wird, in
 * welchem Abstand, wann zuletzt und wann als Nächstes geprüft wird und wann der karten-service
 * das nächste Mal baut. Auskunft, keine Warnung — deshalb Text, keine Hinweisfläche.
 *
 * Admins schalten die Automatik und den Abstand hier; jede Änderung speichert sofort. Der Schalter
 * folgt dem Server: scheitert das Speichern, bleibt er stehen, und der Grund steht an der Zeile bis
 * zur nächsten Änderung — kein Toast (`frontend/AGENTS.md`, „Rückwege und Fehler“, LFH-1077).
 */
export default function AutoAktualisierungZeile({
  status,
  istAdmin,
}: {
  status: AktualisierungsStatus;
  istAdmin: boolean;
}) {
  const qc = useQueryClient();
  const { token } = theme.useToken();
  const speichern = useMutation({
    mutationFn: (body: AutoAktualisierungBody) => speichereAutoAktualisierung(body),
    onSuccess: (neu) => qc.setQueryData(globalKeys.adminKarteBereich('aktualisierung'), neu),
  });

  const abstaende = ABSTAENDE.includes(status.intervall_stunden)
    ? ABSTAENDE
    : [...ABSTAENDE, status.intervall_stunden].sort((a, b) => a - b);

  const zeiten: string[] = [];
  if (status.letzte_pruefung_at) {
    zeiten.push(`zuletzt geprüft ${ortszeit(status.letzte_pruefung_at)}`);
  }
  if (status.automatisch && status.naechste_pruefung_at) {
    zeiten.push(`nächste Prüfung ${ortszeit(status.naechste_pruefung_at)}`);
  }
  if (status.bau_dienst === 'unerreichbar') {
    zeiten.push('Kartenbau-Dienst nicht erreichbar');
  } else if (status.bau_dienst === 'erreichbar' && status.naechster_bau_at) {
    zeiten.push(`nächster Kartenbau ${ortszeit(status.naechster_bau_at)}`);
  }

  return (
    <div data-testid="auto-aktualisierung" style={{ marginBottom: 12 }}>
      <Space wrap size={12}>
        {istAdmin ? (
          <>
            <Space size={8}>
              <Switch
                aria-label="Automatisch aktualisieren"
                checked={status.automatisch}
                loading={speichern.isPending}
                onChange={(an) =>
                  speichern.mutate({
                    automatisch: an,
                    intervall_stunden: status.intervall_stunden,
                  })
                }
              />
              <Typography.Text>Automatisch aktualisieren</Typography.Text>
            </Space>
            <Select
              aria-label="Prüfabstand"
              value={status.intervall_stunden}
              disabled={speichern.isPending}
              style={{ minWidth: 130 }}
              options={abstaende.map((h) => ({ value: h, label: `alle ${abstandText(h)}` }))}
              onChange={(h: number) =>
                speichern.mutate({ automatisch: status.automatisch, intervall_stunden: h })
              }
            />
          </>
        ) : (
          <Typography.Text>
            {status.automatisch
              ? `Automatisch aktualisieren: an, alle ${abstandText(status.intervall_stunden)}`
              : 'Automatisch aktualisieren: aus'}
          </Typography.Text>
        )}
        {zeiten.length > 0 && (
          <Typography.Text type="secondary">{zeiten.join(' · ')}</Typography.Text>
        )}
      </Space>
      {speichern.error != null && (
        <div style={{ marginTop: token.marginXS }}>
          <SpeicherFehler fehler={speichern.error} titel="Einstellung nicht gespeichert" />
        </div>
      )}
    </div>
  );
}
