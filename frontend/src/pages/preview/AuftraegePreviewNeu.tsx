import { Button, Card, Empty, Flex, Segmented, Select, Typography } from 'antd';
import { CloseOutlined, PlusOutlined, UpOutlined } from '@ant-design/icons';
import { useState } from 'react';
import type { Auftrag } from '../../api/types';
import {
  AUFTRAG_STATUS, GRUPPE_LABEL, GRUPPE_ORDNUNG, faelligGruppe, istAbgeschlossen, prioRang,
  type FaelligGruppe,
} from '../../kommunikation';
import AuftragListe from '../../auftraege/AuftragListe';
import AuftragFormular from '../../auftraege/AuftragFormular';
import { MOCK_ABSCHNITTE, MOCK_AUFTRAEGE, MOCK_EINHEITEN } from './auftraegeMock';

const { Text, Title } = Typography;

/**
 * DEV-Vorschau (geshippter Stand, LFH-112): zentrierte Karten-Spalte mit inline aufklappbarem
 * Anlegen-Formular. Nutzt die ECHTEN Komponenten (AuftragListe/AuftragKarte + AuftragFormular
 * card={false}) mit Mock-Daten, kein Backend. Route /preview/auftraege-neu.
 */
function vergleicheOffen(a: Auftrag, b: Auftrag): number {
  const p = prioRang(a.prioritaet) - prioRang(b.prioritaet);
  if (p !== 0) return p;
  return (a.frist_at ?? '￿').localeCompare(b.frist_at ?? '￿');
}

export default function AuftraegePreviewNeu() {
  const [ansicht, setAnsicht] = useState<'offen' | 'abgeschlossen'>('offen');
  const [formOffen, setFormOffen] = useState(false);
  const alle = MOCK_AUFTRAEGE;
  const offene = alle.filter((a) => !istAbgeschlossen(AUFTRAG_STATUS[a.bearbeitungsstatus]?.phase ?? 'offen'));
  const abgeschlossene = alle.filter((a) => istAbgeschlossen(AUFTRAG_STATUS[a.bearbeitungsstatus]?.phase ?? 'offen'));

  const offeneGruppen: { gruppe: FaelligGruppe; auftraege: Auftrag[] }[] = GRUPPE_ORDNUNG
    .map((gruppe) => ({
      gruppe,
      auftraege: offene.filter((a) => faelligGruppe(a.frist_at, a.ist_ueberfaellig) === gruppe).sort(vergleicheOffen),
    }))
    .filter(({ auftraege }) => auftraege.length > 0);

  const listenProps = { darfSchreiben: true, einsatzId: 1 };

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '24px 24px 64px' }}>
      <Flex justify="space-between" align="center" gap={16} wrap style={{ marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>Aufträge/Befehle</Title>
          <Text type="secondary">{offene.length} offen · {abgeschlossene.length} abgeschlossen</Text>
        </div>
        <Button type="primary" size="large" icon={formOffen ? <UpOutlined /> : <PlusOutlined />} onClick={() => setFormOffen((o) => !o)}>
          {formOffen ? 'Formular schließen' : 'Auftrag erteilen'}
        </Button>
      </Flex>

      {formOffen && (
        <Card
          size="small"
          title="Neuer Auftrag/Befehl"
          style={{ marginBottom: 16 }}
          extra={<Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setFormOffen(false)} aria-label="Formular schließen" />}
        >
          <AuftragFormular
            card={false}
            senden={false}
            abschnitte={MOCK_ABSCHNITTE}
            einheiten={MOCK_EINHEITEN}
            onAnlegen={() => setFormOffen(false)}
          />
        </Card>
      )}

      <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
        <Segmented value={ansicht} onChange={(v) => setAnsicht(v as 'offen' | 'abgeschlossen')}
          options={[{ value: 'offen', label: `Offen (${offene.length})` }, { value: 'abgeschlossen', label: `Abgeschlossen (${abgeschlossene.length})` }]} />
        <Segmented options={[{ value: 'alle', label: 'Alle Richtungen' }, { value: 'intern', label: 'Intern' }, { value: 'extern', label: 'Extern' }]} value="alle" />
        <Select allowClear placeholder="Empfänger filtern" style={{ minWidth: 200 }}
          options={[{ label: 'Einsatzabschnitte', options: MOCK_ABSCHNITTE.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })) }]} />
      </Flex>

      {(ansicht === 'offen' ? offene : abgeschlossene).length === 0 ? (
        <Empty description="Keine Aufträge in dieser Ansicht" style={{ marginTop: 64 }} />
      ) : ansicht === 'offen' ? (
        offeneGruppen.map(({ gruppe, auftraege }) => (
          <div key={gruppe} style={{ marginBottom: 20 }}>
            <Text strong style={{ display: 'block', marginBottom: 8, textTransform: 'uppercase', fontSize: 12, letterSpacing: 0.4 }}>
              {GRUPPE_LABEL[gruppe]} · {auftraege.length}
            </Text>
            <AuftragListe auftraege={auftraege} ansicht="offen" {...listenProps} />
          </div>
        ))
      ) : (
        <AuftragListe auftraege={abgeschlossene} ansicht="abgeschlossen" {...listenProps} />
      )}
    </div>
  );
}
