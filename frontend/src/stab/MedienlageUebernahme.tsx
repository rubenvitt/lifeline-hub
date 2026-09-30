import { Button, Flex, Modal, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { taktischeDtgVoll } from '../anzeige/format';
import { abrufZustand, type AbrufZustand } from '../api/abrufZustand';
import { ladeAnrufe } from '../api/infotelefon';
import { ladeMedienkontakte, ladePressemitteilungen } from '../api/presse';
import { einsatzKeys } from '../api/queryKeys';
import { useRollen } from '../components/instrument';
import { baueMedienlage, rendereMedienlageMarkdown } from './medienlage';
import { useStabFreigabe } from './useStabFreigabe';

/**
 * „Aus S5 übernehmen“ im Abschnitt „Medienlage“ eines Lagevortrag-Entwurfs (LFH-554, Spec
 * `stab-medienlage`, D7).
 *
 * - **Fehlt** ohne Freigabe des Stabs (auch solange sie nicht ermittelt ist): dann gibt es die
 *   Quelle für diese Person nicht. Die Seite zeigt den Knopf nur im Schreibzweig.
 * - **Lädt erst beim Klick** (`fetchQuery` über dieselben Keys wie die Presseseite): ein Lagebericht
 *   ohne Übernahme kostet keine Abrufe. Scheitert eine Quelle, trägt der Text „—“ mit Grund.
 * - **Ersetzt nie still:** ein leerer Abschnitt wird gefüllt, ein gefüllter erst nach Rückfrage.
 *   Ersetzen ist unumkehrbar (der Entwurf speichert danach von selbst), deshalb Rückfrage statt
 *   Rückgängig.
 * - Die Übernahme ändert nur das Formular und meldet die Änderung an den Verlustschutz
 *   (`onGeaendert`); gespeichert wird mit dem nächsten Speichern bzw. Autosave.
 */
export default function MedienlageUebernahme({
  einsatzId,
  form,
  feld,
  onGeaendert,
}: {
  einsatzId: number;
  form: FormInstance;
  feld: string;
  onGeaendert: () => void;
}) {
  const freigabe = useStabFreigabe(einsatzId);
  const qc = useQueryClient();
  const { konventionen } = useAnzeigeKonventionen();
  const { token } = useRollen();
  const [laeuft, setLaeuft] = useState(false);
  const [ersetzen, setErsetzen] = useState<string | null>(null);

  if (freigabe.zustand !== 'frei') return null;

  async function quelle<T>(
    key: readonly unknown[],
    fn: () => Promise<T[]>,
  ): Promise<{ zustand: AbrufZustand; daten: T[] }> {
    try {
      return { zustand: 'daten', daten: await qc.fetchQuery({ queryKey: key, queryFn: fn }) };
    } catch (e) {
      return { zustand: abrufZustand({ error: e, isError: true, isPending: false }), daten: [] };
    }
  }

  const einsetzen = (text: string) => {
    form.setFieldValue(feld, text);
    onGeaendert();
  };

  const uebernehmen = async () => {
    setLaeuft(true);
    try {
      const [kontakte, mitteilungen, anrufe] = await Promise.all([
        quelle(einsatzKeys.medienkontakte(einsatzId), () => ladeMedienkontakte(einsatzId)),
        quelle(einsatzKeys.pressemitteilungen(einsatzId), () => ladePressemitteilungen(einsatzId)),
        quelle(einsatzKeys.infotelefon(einsatzId), () => ladeAnrufe(einsatzId)),
      ]);
      const text = rendereMedienlageMarkdown(
        baueMedienlage({ kontakte, mitteilungen, anrufe }),
        (w) => taktischeDtgVoll(w, konventionen),
      );
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
        Aus S5 übernehmen
      </Button>
      <Typography.Text type="secondary">
        Presse-Log, Pressemitteilungen und Informationstelefon, ohne Personenbezug
      </Typography.Text>
      <Modal
        open={ersetzen != null}
        title="Medienlage ersetzen?"
        okText="Ersetzen"
        cancelText="Abbrechen"
        onOk={() => {
          if (ersetzen != null) einsetzen(ersetzen);
          setErsetzen(null);
        }}
        onCancel={() => setErsetzen(null)}
      >
        Der Abschnitt enthält schon Text. Er wird durch die aktuelle Medienlage aus S5 ersetzt.
      </Modal>
    </Flex>
  );
}
