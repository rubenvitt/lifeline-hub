import { useMemo } from 'react';
import { Checkbox, Form, Radio } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { koppleOrtung, listOrtungKandidaten, type TrackingCandidate } from '../api/ortung';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzFahrzeug } from '../api/types';
import { vorText } from '../anzeige/dauer';
import { ErfassungsModal } from '../components/Erfassung';
import { Feld, Kennung, Stapel, Textstufe } from '../components/instrument';
import { pflicht } from '../components/pflichtRegel';
import { useMinutenTakt } from '../components/useMinutenTakt';

type Werte = { kennung?: string; ehrenamt?: boolean };

/** Der Wert einer Auswahl: Zugang und Kennung zusammen bestimmen die Kennung eindeutig. */
const kennungWert = (k: Pick<TrackingCandidate, 'access_id' | 'device_id'>) =>
  `${k.access_id}\u0000${k.device_id}`;

export interface OrtungKoppelnDialogProps {
  einsatzId: number;
  /** Das Fahrzeug, dessen Ortung gekoppelt wird; `null` = Dialog zu. */
  fahrzeug: EinsatzFahrzeug | null;
  onSchliessen: () => void;
}

/**
 * Dialog „Ortung koppeln“ (LLH-2091, Spec `fahrzeugortung`, „Oberfläche“): wählt eine der
 * Kennungen, von denen in den letzten 24 Stunden eine Position eingegangen ist („Zugang · Kennung ·
 * vor 2 min“; schon gekoppelte stehen ausgegraut). „Besatzung ist ehrenamtlich“ ist Pflicht, solange
 * der Org-Schalter `ortung_hauptamt` nicht an ist; ist er an, steht das Kästchen nicht da. Ob es
 * Pflicht ist, steht als `volunteer_crew_required` in der Kandidatenliste (die Org-Einstellungen
 * darf nicht jeder Schreibberechtigte lesen). Maßgeblich ist ohnehin der Server (422
 * `volunteer_crew_required`). Die Kandidaten werden beim Öffnen geholt, nicht live und
 * nicht im Lagebild ohne Netz (`NICHT_LIVE_KEYS`). Die Liste trägt keine Koordinaten.
 */
export default function OrtungKoppelnDialog({
  einsatzId,
  fahrzeug,
  onSchliessen,
}: OrtungKoppelnDialogProps) {
  const qc = useQueryClient();
  const [form] = Form.useForm<Werte>();
  const jetzt = useMinutenTakt();
  const offen = fahrzeug !== null;
  const efId = fahrzeug?.id ?? 0;

  const kandidatenQuery = useQuery({
    queryKey: einsatzKeys.ortungKandidaten(einsatzId, efId),
    queryFn: () => listOrtungKandidaten(einsatzId, efId),
    enabled: offen,
    // Ein Schnappschuss beim Öffnen: ein erneutes Öffnen holt frisch.
    staleTime: 0,
    gcTime: 0,
  });
  /** Der Server nennt den Org-Schalter mit der Liste; solange sie fehlt, ist die Bestätigung Pflicht. */
  const bestaetigungPflicht = kandidatenQuery.data?.volunteer_crew_required ?? true;

  const kennung = Form.useWatch('kennung', form);
  const ehrenamt = Form.useWatch('ehrenamt', form);
  const kandidaten = useMemo(() => kandidatenQuery.data?.candidates ?? [], [kandidatenQuery.data]);
  const bereit = kennung != null && (!bestaetigungPflicht || ehrenamt === true);

  const mutation = useMutation({
    mutationFn: (v: { efId: number; kandidat: TrackingCandidate; ehrenamt: boolean }) =>
      koppleOrtung(einsatzId, v.efId, {
        access_id: v.kandidat.access_id,
        device_id: v.kandidat.device_id,
        volunteer_crew_confirmed: v.ehrenamt,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
      // Der Server schreibt einen ETB-Eintrag „Ortung gekoppelt: …“.
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    },
  });

  let auswahl;
  if (kandidatenQuery.isError) {
    auswahl = (
      <Textstufe ton="alarm" als="p">
        Kennungen konnten nicht geladen werden.
      </Textstufe>
    );
  } else if (kandidatenQuery.isPending) {
    auswahl = (
      <Textstufe ton="gedaempft" als="p">
        Kennungen werden geladen …
      </Textstufe>
    );
  } else if (kandidaten.length === 0) {
    auswahl = (
      <Textstufe ton="gedaempft" als="p">
        Keine Position in den letzten 24 Stunden eingegangen.
      </Textstufe>
    );
  } else {
    auswahl = (
      <Feld label="Kennung" name="kennung" rules={[pflicht('Kennung')]}>
        <Radio.Group>
          <Stapel abstand="xxs">
            {kandidaten.map((k) => (
              <Radio key={kennungWert(k)} value={kennungWert(k)} disabled={k.coupled}>
                {k.access_name} · <Kennung>{k.device_id}</Kennung> · {vorText(k.received_at, jetzt)}
              </Radio>
            ))}
          </Stapel>
        </Radio.Group>
      </Feld>
    );
  }

  return (
    <ErfassungsModal<Werte>
      offen={offen}
      titel={fahrzeug ? `Ortung koppeln: ${fahrzeug.funkrufname}` : 'Ortung koppeln'}
      form={form}
      erfassenText="Koppeln"
      laeuft={mutation.isPending}
      gesperrt={!bereit}
      speicherung={mutation}
      speicherFehlerTitel="Nicht gekoppelt"
      speicherFehlerFallback="Koppeln fehlgeschlagen"
      onErfassen={async (werte) => {
        if (!fahrzeug) return;
        const kandidat = kandidaten.find((k) => kennungWert(k) === werte.kennung);
        if (!kandidat || kandidat.coupled) return;
        await mutation.mutateAsync({
          efId: fahrzeug.id,
          kandidat,
          ehrenamt: werte.ehrenamt === true,
        });
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {auswahl}
      {bestaetigungPflicht && kandidaten.length > 0 && (
        <Feld
          name="ehrenamt"
          valuePropName="checked"
          abstand="ohne"
          rules={[
            {
              validator: (_, wert: boolean | undefined) =>
                wert === true ? Promise.resolve() : Promise.reject(new Error('Bestätigung fehlt')),
            },
          ]}
        >
          <Checkbox>Besatzung ist ehrenamtlich</Checkbox>
        </Feld>
      )}
    </ErfassungsModal>
  );
}
