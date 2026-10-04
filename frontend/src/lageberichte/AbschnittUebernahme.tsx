import { Button, Flex, Modal, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { taktischeDtgVoll } from '../anzeige/format';
import { ladeModulFreigaben } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { useRollen } from '../components/instrument';
import type { UebernahmeQuelle, Verfuegbarkeit } from './uebernahmeQuelle';

/**
 * Übernahme-Knopf über einem Abschnitt eines Lagevortrag-Entwurfs (LFH-870, Spec
 * `lagevortrag-uebernahme`; zuerst LFH-554 für die Medienlage). Was übernommen wird, sagt die
 * {@link UebernahmeQuelle}; hier liegt nur, was für jede Quelle gleich gilt:
 *
 * - **Rechte je Quelle:** die Quelle prüft die Modulfreigaben selbst. Solange sie nicht ermittelt
 *   sind, steht nichts (fail-closed); gesperrt oder nicht ermittelbar steht ein Hinweis mit Grund
 *   statt des Knopfes, damit der fehlende Knopf sich erklärt.
 * - **Lädt erst beim Klick:** ein Lagebericht ohne Übernahme kostet keine Abrufe.
 * - **Ersetzt nie still:** ein leerer Abschnitt wird gefüllt, ein gefüllter erst nach Rückfrage.
 *   Ersetzen ist unumkehrbar (der Entwurf speichert danach von selbst), deshalb Rückfrage statt
 *   Rückgängig.
 * - Ändert nur das Formular und meldet die Änderung an den Verlustschutz (`onGeaendert`);
 *   gespeichert wird mit dem nächsten Speichern bzw. Autosave.
 *
 * Die Seite rendert den Baustein nur im Schreibzweig (Entwurf und Schreibrecht).
 */
export default function AbschnittUebernahme({
  quelle,
  einsatzId,
  form,
  feld,
  onGeaendert,
}: {
  quelle: UebernahmeQuelle;
  einsatzId: number;
  form: FormInstance;
  feld: string;
  onGeaendert: () => void;
}) {
  // Dieselbe Abfrage wie `useStabFreigabe` (gemeinsamer Cache).
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const qc = useQueryClient();
  const { konventionen } = useAnzeigeKonventionen();
  const { token } = useRollen();
  const [laeuft, setLaeuft] = useState(false);
  const [ersetzen, setErsetzen] = useState<string | null>(null);

  const freigaben = freigabenQuery.data;
  if (freigaben == null && !freigabenQuery.isError) return null;
  const verfuegbar: Verfuegbarkeit =
    freigaben == null
      ? { frei: false, grund: 'Freigaben nicht ermittelbar' }
      : quelle.verfuegbar(freigaben);
  if (freigaben == null || !verfuegbar.frei) {
    const grund = verfuegbar.frei ? '' : verfuegbar.grund;
    return (
      <Typography.Paragraph
        className="lagebericht-no-print"
        type="secondary"
        style={{ marginBottom: token.marginXS }}
      >
        {`${quelle.knopf} nicht verfügbar: ${grund}`}
      </Typography.Paragraph>
    );
  }

  const einsetzen = (text: string) => {
    form.setFieldValue(feld, text);
    onGeaendert();
  };

  const uebernehmen = async () => {
    setLaeuft(true);
    try {
      const text = await quelle.erzeuge({
        qc,
        einsatzId,
        freigaben,
        dtg: (iso) => taktischeDtgVoll(iso, konventionen),
      });
      const bisher = form.getFieldValue(feld);
      if (typeof bisher === 'string' && bisher.trim() !== '') setErsetzen(text);
      else einsetzen(text);
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Flex
      className="lagebericht-no-print"
      align="center"
      gap={token.marginXS}
      style={{ marginBottom: token.marginXS }}
    >
      <Button onClick={() => void uebernehmen()} loading={laeuft}>
        {quelle.knopf}
      </Button>
      <Typography.Text type="secondary">{quelle.unterzeile}</Typography.Text>
      <Modal
        open={ersetzen != null}
        title={quelle.ersetzenTitel}
        okText="Ersetzen"
        cancelText="Abbrechen"
        onOk={() => {
          if (ersetzen != null) einsetzen(ersetzen);
          setErsetzen(null);
        }}
        onCancel={() => setErsetzen(null)}
      >
        {quelle.ersetzenText}
      </Modal>
    </Flex>
  );
}
