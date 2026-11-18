import { dauer } from '../anzeige/dauer';
import { Switch, theme, Typography } from 'antd';
import { Select } from '../components/Select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  speichereAutoAktualisierung,
  type AktualisierungsStatus,
  type AutoAktualisierungBody,
} from '../api/offlineKarten';
import { globalKeys } from '../api/queryKeys';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { MetaZeile, Stapel } from '../components/instrument';

/** Auswahl des Prüfabstands (Stunden); der Server nimmt 1…168. */
const ABSTAENDE = [1, 3, 6, 12, 24, 168];

/** „6 h“ bzw. „7 Tage“. */
export function abstandText(stunden: number): string {
  return stunden === 168 ? '7 Tage' : dauer(stunden * 60);
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
  const { zeitpunkt } = useAnzeigeKonventionen();
  const speichern = useMutation({
    mutationFn: (body: AutoAktualisierungBody) => speichereAutoAktualisierung(body),
    onSuccess: (neu) => qc.setQueryData(globalKeys.adminKarteBereich('aktualisierung'), neu),
  });

  const abstaende = ABSTAENDE.includes(status.intervall_stunden)
    ? ABSTAENDE
    : [...ABSTAENDE, status.intervall_stunden].sort((a, b) => a - b);

  // Wort und Zeit getrennt: die Zeit steht in Mono (Spec `schriftstufen`, Metazeile).
  const zeiten: { schluessel: string; wort: string; zeit?: string }[] = [];
  if (status.letzte_pruefung_at) {
    zeiten.push({
      schluessel: 'letzte',
      wort: 'zuletzt geprüft',
      zeit: zeitpunkt(status.letzte_pruefung_at),
    });
  }
  if (status.automatisch && status.naechste_pruefung_at) {
    zeiten.push({
      schluessel: 'naechste',
      wort: 'nächste Prüfung',
      zeit: zeitpunkt(status.naechste_pruefung_at),
    });
  }
  if (status.bau_dienst === 'unerreichbar') {
    zeiten.push({ schluessel: 'bau', wort: 'Kartenbau-Dienst nicht erreichbar' });
  } else if (status.bau_dienst === 'erreichbar' && status.naechster_bau_at) {
    zeiten.push({
      schluessel: 'bau',
      wort: 'nächster Kartenbau',
      zeit: zeitpunkt(status.naechster_bau_at),
    });
  }

  return (
    <div data-testid="auto-aktualisierung" style={{ marginBottom: 12 }}>
      <Stapel richtung="zeile" umbruch abstand="md" ausrichten="mitte">
        {istAdmin ? (
          <>
            <Stapel richtung="zeile" abstand="sm" ausrichten="mitte">
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
            </Stapel>
            {/* Mindestbreite über die Hülle; das Raster streckt die Auswahl auf ihre Breite. */}
            <div style={{ display: 'grid', minWidth: 'var(--lfh-feld-kurz)' }}>
              <Select
                aria-label="Prüfabstand"
                value={status.intervall_stunden}
                disabled={speichern.isPending}
                options={abstaende.map((h) => ({ value: h, label: `alle ${abstandText(h)}` }))}
                onChange={(h: number) =>
                  speichern.mutate({ automatisch: status.automatisch, intervall_stunden: h })
                }
              />
            </div>
          </>
        ) : (
          <Typography.Text>
            {status.automatisch
              ? `Automatisch aktualisieren: an, alle ${abstandText(status.intervall_stunden)}`
              : 'Automatisch aktualisieren: aus'}
          </Typography.Text>
        )}
        <MetaZeile>
          {zeiten.map((z) => (
            <MetaZeile.Teil key={z.schluessel}>
              {z.wort}
              {z.zeit && (
                <>
                  {' '}
                  <MetaZeile.Zahl>{z.zeit}</MetaZeile.Zahl>
                </>
              )}
            </MetaZeile.Teil>
          ))}
        </MetaZeile>
      </Stapel>
      {speichern.error != null && (
        <div style={{ marginTop: token.marginXS }}>
          <SpeicherFehler fehler={speichern.error} titel="Einstellung nicht gespeichert" />
        </div>
      )}
    </div>
  );
}
