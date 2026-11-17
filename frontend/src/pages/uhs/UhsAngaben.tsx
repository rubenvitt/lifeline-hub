import { App, Input, InputNumber } from 'antd';
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isVeraltet } from '../../api/client';
import { aktualisiereUhs } from '../../api/einsatzUhs';
import { UHS_SOLL_ANZAHL_MAX } from '../../api/eingabegrenzen';
import { einsatzKeys } from '../../api/queryKeys';
import type { Uhs, UhsDetail } from '../../api/types';
import { EinsatzOrtsfeld } from '../../anzeige/EinsatzOrtsfeld';
import BearbeitbaresPaneel, {
  type BearbeitbaresFeld,
} from '../../components/instrument/BearbeitbaresPaneel';
import QualiSollFeld from '../../kraefte/QualiSollFeld';
import { qualiSollText } from '../../kraefte/qualiSoll';
import { uhsAngabenWerte, uhsPatch, type UhsAngabenWerte } from './uhsPatch';

/**
 * Paneel „Angaben“ einer Unfallhilfsstelle im gleichnamigen Bereich der Detailseite (LLH-1920,
 * `frontend/AGENTS.md`, „Bearbeiten in der Ansicht“; Spec `uhs-bearbeitung`): Bezeichnung,
 * Standort, Soll-Anzahl, Qualifikationssoll (LLH-1553) und Notiz, „Bearbeiten“ im Paneelkopf. CAS
 * über `geaendert_at` (`basis_geaendert_at`, 409 → Rückfrage des Bausteins). Typ und Abschnitt
 * bleiben außen vor: auch das Anlegen bietet den Abschnitt nicht an, der Typ steht fest.
 */
export default function UhsAngaben({
  einsatzId,
  uhs,
  bearbeitbar,
  onNeuLaden,
}: {
  einsatzId: number;
  uhs: Uhs;
  /** Verwalten dürfen, Schreibrecht im Einsatz, weder aufgelöst noch storniert. */
  bearbeitbar: boolean;
  onNeuLaden: () => void;
}) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const werte = useMemo(() => uhsAngabenWerte(uhs), [uhs]);

  const felder: BearbeitbaresFeld<UhsAngabenWerte>[] = [
    {
      name: 'bezeichnung',
      label: 'Bezeichnung',
      anzeige: uhs.bezeichnung,
      eingabe: <Input placeholder="z. B. BHP 50" />,
      regeln: [{ required: true, whitespace: true, message: 'Bezeichnung erforderlich' }],
    },
    {
      name: 'standort',
      label: 'Standort',
      anzeige: uhs.standort ?? '—',
      eingabe: (
        <EinsatzOrtsfeld einsatzId={einsatzId} etikett="Standort" exclude={`uhs:${uhs.id}`} />
      ),
    },
    {
      name: 'soll_anzahl',
      label: 'Soll-Anzahl',
      anzeige: uhs.soll_anzahl ?? '—',
      eingabe: (
        <InputNumber min={1} max={UHS_SOLL_ANZAHL_MAX} precision={0} style={{ width: 120 }} />
      ),
      mono: true,
    },
    {
      name: 'quali_soll',
      label: 'Qualifikationssoll',
      anzeige: qualiSollText(uhs.quali_soll) || '—',
      eingabe: <QualiSollFeld bekannt={uhs.quali_soll} aria-label="Qualifikationssoll" />,
      breit: true,
    },
    {
      name: 'notiz',
      label: 'Notiz',
      anzeige: uhs.notiz ?? '—',
      eingabe: <Input.TextArea rows={3} />,
      breit: true,
    },
  ];

  return (
    <BearbeitbaresPaneel<UhsAngabenWerte, ReturnType<typeof uhsPatch>>
      titel="Angaben"
      datensatz={uhs}
      werte={werte}
      felder={felder}
      patch={uhsPatch}
      // Ohne Basis („Meine Änderung übernehmen“) fehlt der Schlüssel: JSON lässt `undefined` weg.
      onSpeichern={async (patch, basis) => {
        const neu = await aktualisiereUhs(einsatzId, uhs.id, {
          ...patch,
          basis_geaendert_at: basis,
        });
        // Der neue Stand sofort in die Stelle, nicht erst mit dem Neuabruf: sonst zeigte das Paneel
        // kurz den alten, und ein gleich wieder geöffnetes fröre das alte `geaendert_at` ein
        // (falscher 409). Plätze, Belegung und Material des Details bleiben.
        qc.setQueryData<UhsDetail>(einsatzKeys.uhsDetail(einsatzId, uhs.id), (alt) =>
          alt ? { ...alt, ...neu } : alt,
        );
        message.success('Unfallhilfsstelle gespeichert');
        void qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
        void qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhs.id) });
        // Der Lagemonitor nennt die UHS mit Namen und Punkt.
        void qc.invalidateQueries({ queryKey: einsatzKeys.lagemonitor(einsatzId) });
      }}
      onNeuLaden={onNeuLaden}
      // Der Server zeichnet den Sperrkonflikt aus; storniert oder doppelt steht als Grund am Paneel.
      isSperrkonflikt={isVeraltet}
      darfSchreiben={bearbeitbar}
    />
  );
}
