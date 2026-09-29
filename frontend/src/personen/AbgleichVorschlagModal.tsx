import { Modal, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Select } from '../components/Select';
import { registrierAnzeige } from '../api/einsatzPerson';
import type { Person } from '../api/types';

/**
 * Abgleich-Vorschlag für eine vermisste Person. Das Auswahlfeld der Tabellenspalte trägt auf
 * einer 390-px-Karte nicht (Trefffläche, Überlauf); der Kartenzweig ersetzt es durch einen
 * Knopf, der diesen Dialog öffnet. Die Höhe des Felds kommt aus `controlHeight`.
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

  // Auf die vermisste Person, nicht auf `open` gehört: sonst behielte ein Aufruf für eine ANDERE
  // Person die Auswahl des ersten und schlüge sie still am falschen Satz vor.
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
