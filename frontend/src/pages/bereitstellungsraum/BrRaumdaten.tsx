import { App, Input } from 'antd';
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { aktualisiereBr } from '../../api/einsatzBereitstellungsraum';
import { BR_BEZEICHNUNG_MAX, BR_NOTIZ_MAX, BR_STANDORT_MAX } from '../../api/eingabegrenzen';
import { einsatzKeys } from '../../api/queryKeys';
import type { Bereitstellungsraum } from '../../api/types';
import { EinsatzOrtsfeld } from '../../anzeige/EinsatzOrtsfeld';
import BearbeitbaresPaneel, {
  type BearbeitbaresFeld,
} from '../../components/instrument/BearbeitbaresPaneel';
import { ortZeichenRegel, zeichenGrenze, zeichenRegel } from '../../components/zeichenGrenze';
import AufKarteVerorten from './AufKarteVerorten';
import { brPatch, brRaumdatenWerte, type BrRaumdatenWerte } from './brRaumdaten';

/**
 * Paneel „Raumdaten“ eines Bereitstellungsraums (LFH-1147), bearbeitet in der Ansicht (LLH-1920,
 * `frontend/AGENTS.md`, „Bearbeiten in der Ansicht“; Spec `bereitstellungsraum-bearbeitung`):
 * „Bearbeiten“ im Paneelkopf, davor „Auf Karte verorten“ (LLH-1107). CAS über `geaendert_at`
 * (`basis_geaendert_at`, 409 → Rückfrage des Bausteins). Der Abschnitt bleibt außen vor: auch das
 * Anlegen bietet ihn nicht an.
 */
export default function BrRaumdaten({
  einsatzId,
  br,
  bearbeitbar,
  onNeuLaden,
}: {
  einsatzId: number;
  br: Bereitstellungsraum;
  /** Verwalten dürfen, Schreibrecht im Einsatz, weder aufgelöst noch storniert. */
  bearbeitbar: boolean;
  onNeuLaden: () => void;
}) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const werte = useMemo(() => brRaumdatenWerte(br), [br]);

  const felder: BearbeitbaresFeld<BrRaumdatenWerte>[] = [
    {
      name: 'bezeichnung',
      label: 'Bezeichnung',
      anzeige: br.bezeichnung,
      eingabe: <Input placeholder="z. B. BR Ost" count={zeichenGrenze(BR_BEZEICHNUNG_MAX)} />,
      regeln: [
        { required: true, whitespace: true, message: 'Bezeichnung erforderlich' },
        zeichenRegel(BR_BEZEICHNUNG_MAX, 'Bezeichnung'),
      ],
    },
    {
      name: 'standort',
      label: 'Standort',
      anzeige: br.standort ?? '—',
      eingabe: (
        <EinsatzOrtsfeld
          einsatzId={einsatzId}
          etikett="Standort"
          count={zeichenGrenze(BR_STANDORT_MAX)}
        />
      ),
      regeln: [ortZeichenRegel(BR_STANDORT_MAX, 'Standort')],
    },
    {
      name: 'notiz',
      label: 'Notiz',
      anzeige: br.notiz ?? '—',
      eingabe: <Input.TextArea rows={3} count={zeichenGrenze(BR_NOTIZ_MAX)} />,
      regeln: [zeichenRegel(BR_NOTIZ_MAX, 'Notiz')],
    },
  ];

  return (
    <BearbeitbaresPaneel<BrRaumdatenWerte, ReturnType<typeof brPatch>>
      titel="Raumdaten"
      datensatz={br}
      werte={werte}
      felder={felder}
      patch={brPatch}
      // Ohne Basis („Meine Änderung übernehmen“) fehlt der Schlüssel: JSON lässt `undefined` weg.
      onSpeichern={async (patch, basis) => {
        await aktualisiereBr(einsatzId, br.id, { ...patch, basis_geaendert_at: basis });
        message.success('Bereitstellungsraum gespeichert');
        void qc.invalidateQueries({ queryKey: einsatzKeys.br(einsatzId) });
        void qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(einsatzId, br.id) });
        // Die Gerätekopplungen nennen den Raum mit Namen (Einstellungen › Geräte).
        void qc.invalidateQueries({ queryKey: einsatzKeys.geraete(einsatzId) });
      }}
      onNeuLaden={onNeuLaden}
      darfSchreiben={bearbeitbar}
      zusatz={bearbeitbar ? <AufKarteVerorten einsatzId={einsatzId} br={br} /> : undefined}
    />
  );
}
