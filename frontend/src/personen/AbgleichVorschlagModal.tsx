import { Modal, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Select } from '../components/Select';
import { registrierAnzeige } from '../api/einsatzPerson';
import type { Person } from '../api/types';

/**
 * Abgleich-Vorschlag für eine vermisste Person (LFH-330 · B2, Bündel I).
 *
 * WARUM ES DIESES MODAL GIBT: die Tabellenspalte `abgleich` trägt ein Auswahlfeld in der
 * Zelle — ~24 px hoch, 200 px fest breit. Auf einer 390-px-Karte ist das dreifach
 * regelwidrig (Trefffläche, Überlauf, Klein-Variante), und der Aktions-Deskriptor des
 * Kartenplans nimmt bewusst keinen fremden Knoten an. Er ERSETZT das Feld also durch einen
 * Knopf, der diesen Dialog öffnet; ein Feld ⇒ Modal nach der UI-Form-Leitlinie (LFH-19).
 *
 * Kein `size`-Prop am Auswahlfeld: die Höhe kommt aus `controlHeight` und zieht mit der
 * Dichtestufe mit.
 */
export default function AbgleichVorschlagModal({
  vermisst,
  gefundene,
  isPending,
  onCancel,
  onFinish,
}: {
  /** `null` = geschlossen. Trägt die vermisste Person, zu der ein Treffer gesucht wird. */
  vermisst: Person | null;
  gefundene: readonly Person[];
  isPending?: boolean;
  onCancel: () => void;
  onFinish: (gefundenId: number) => void;
}) {
  const [gewaehlt, setGewaehlt] = useState<number | undefined>(undefined);

  // Auf die vermisste Person, nicht auf `open` gehört: sonst behielte ein zweiter Aufruf für
  // eine ANDERE Person die Auswahl des ersten und schlüge sie still am falschen Satz vor.
  useEffect(() => setGewaehlt(undefined), [vermisst?.id]);

  return (
    <Modal
      open={vermisst !== null}
      title={
        vermisst
          ? `Abgleich vorschlagen — ${registrierAnzeige(vermisst.registrier_nr)}`
          : 'Abgleich vorschlagen'
      }
      okText="Vorschlagen"
      okButtonProps={{ disabled: gewaehlt === undefined }}
      confirmLoading={isPending}
      onOk={() => gewaehlt !== undefined && onFinish(gewaehlt)}
      onCancel={onCancel}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        Welche gefundene Person könnte dieselbe sein?
      </Typography.Paragraph>
      <Select<number>
        aria-label="gefundene Person"
        placeholder="gefundene Person …"
        style={{ width: '100%' }}
        value={gewaehlt}
        onChange={(id) => setGewaehlt(id)}
        options={gefundene.map((g) => ({
          value: g.id,
          label: `${registrierAnzeige(g.registrier_nr)} ${g.name ?? 'unbekannt'}`,
        }))}
        disabled={gefundene.length === 0}
      />
      {gefundene.length === 0 && (
        <Typography.Paragraph type="secondary" style={{ marginBlockStart: 8, marginBlockEnd: 0 }}>
          Es ist noch niemand als betroffen oder verstorben erfasst.
        </Typography.Paragraph>
      )}
    </Modal>
  );
}
