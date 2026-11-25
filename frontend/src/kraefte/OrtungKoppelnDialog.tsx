import { useMemo } from 'react';
import { Form, Radio } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { koppleOrtung, listOrtungKandidaten, type TrackingCandidate } from '../api/ortung';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzFahrzeug } from '../api/types';
import { vorText } from '../anzeige/dauer';
import { ErfassungsModal } from '../components/Erfassung';
import { Feld, Kennung, Stapel, Textstufe } from '../components/instrument';
import { pflicht } from '../components/pflichtRegel';
import { useMinutenTakt } from '../components/useMinutenTakt';

type Werte = { kennung?: string };

/** Der Wert einer Auswahl: Zugang und Kennung zusammen bestimmen die Kennung eindeutig. */
const kennungWert = (k: Pick<TrackingCandidate, 'access_id' | 'device_id'>) =>
  `${k.access_id}\u0000${k.device_id}`;

export interface OrtungKoppelnDialogProps {
  einsatzId: number;
  /** Das Fahrzeug, dessen Ortung gekoppelt wird; `null` = Dialog zu. */
  fahrzeug: EinsatzFahrzeug | null;
  onSchliessen: () => void;
}

/** Warum Koppeln gesperrt ist, wenn der Org-Schalter „Ortung im Einsatz“ aus ist. */
const SCHALTER_AUS_TEXT =
  'Ortung ist für diese Organisation ausgeschaltet. Ein Admin schaltet sie unter Verwaltung → ' +
  'Einsatz-Vorgaben ein.';

/**
 * Dialog „Ortung koppeln“ (LLH-2091, Spec `fahrzeugortung`, „Oberfläche“, Nachtrag 25.11.2026):
 * wählt eine der Kennungen, von denen in den letzten 24 Stunden eine Position eingegangen ist
 * („Zugang · Kennung · vor 2 min“; schon gekoppelte stehen ausgegraut). Koppeln geht nur mit dem
 * Org-Schalter „Ortung im Einsatz“ (ADR-0101); ob er an ist, steht als `tracking_enabled` in der
 * Kandidatenliste (die Org-Einstellungen darf nicht jeder Schreibberechtigte lesen). Ist er aus,
 * erklärt der Dialog das und sperrt „Koppeln“; maßgeblich ist der Server (422). Die Kandidaten
 * werden beim Öffnen geholt, nicht live und nicht im Lagebild ohne Netz (`NICHT_LIVE_KEYS`). Die
 * Liste trägt keine Koordinaten.
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
  /** Der Server nennt den Org-Schalter mit der Liste; solange sie fehlt, gilt er als aus. */
  const schalterAn = kandidatenQuery.data?.tracking_enabled === true;

  const kennung = Form.useWatch('kennung', form);
  const kandidaten = useMemo(() => kandidatenQuery.data?.candidates ?? [], [kandidatenQuery.data]);
  const bereit = schalterAn && kennung != null;

  const mutation = useMutation({
    mutationFn: (v: { efId: number; kandidat: TrackingCandidate }) => {
      // Nach einem Neuabruf kann die gewählte Kennung inzwischen vergeben sein: nicht still schließen.
      if (v.kandidat.coupled) {
        form.setFieldValue('kennung', undefined);
        return Promise.reject(
          new Error('Diese Kennung ist inzwischen gekoppelt. Bitte eine andere wählen.'),
        );
      }
      return koppleOrtung(einsatzId, v.efId, {
        access_id: v.kandidat.access_id,
        device_id: v.kandidat.device_id,
      });
    },
    // Der Server hat anders entschieden als die Liste beim Öffnen: die Kennung ist inzwischen
    // vergeben (409), oder der Org-Schalter ist aus bzw. der Zugang ungültig (422). Der Dialog
    // bleibt offen, die Kandidaten werden neu geholt (ausgegraute Kennung, Hinweis zum Schalter),
    // die Fehlerzeile nennt den Zustand.
    onError: (fehler) => {
      if (fehler instanceof ApiError && (fehler.status === 409 || fehler.status === 422)) {
        if (fehler.status === 409) form.setFieldValue('kennung', undefined);
        void kandidatenQuery.refetch();
      }
    },
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
  } else if (!schalterAn) {
    auswahl = (
      <Textstufe ton="gedaempft" als="p">
        {SCHALTER_AUS_TEXT}
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
        if (!kandidat) return;
        await mutation.mutateAsync({ efId: fahrzeug.id, kandidat });
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {auswahl}
    </ErfassungsModal>
  );
}
