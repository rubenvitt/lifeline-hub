import { Col, Row, Segmented, Select, Typography } from 'antd';
import { useState } from 'react';
import type { Auftrag } from '../../api/types';
import {
  AUFTRAG_STATUS, GRUPPE_LABEL, GRUPPE_ORDNUNG, faelligGruppe, istAbgeschlossen, prioRang,
  type FaelligGruppe,
} from '../../kommunikation';
import AuftragListe from '../../auftraege/AuftragListe';
import AuftragFormular from '../../auftraege/AuftragFormular';
import { MOCK_ABSCHNITTE, MOCK_AUFTRAEGE, MOCK_EINHEITEN } from './auftraegeMock';

/**
 * DEV-Vorschau: BASELINE = aktuelles Aufträge-Layout (Liste + schmales Sidebar-Formular).
 * Rendert die echten Komponenten mit Mock-Daten, kein Backend. Route /preview/auftraege.
 */
function vergleicheOffen(a: Auftrag, b: Auftrag): number {
  const p = prioRang(a.prioritaet) - prioRang(b.prioritaet);
  if (p !== 0) return p;
  return (a.frist_at ?? '￿').localeCompare(b.frist_at ?? '￿');
}

export default function AuftraegePreview() {
  const [ansicht, setAnsicht] = useState<'offen' | 'abgeschlossen'>('offen');
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
    <div style={{ padding: 24 }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>Aufträge/Befehle</Typography.Title>
      <Row gutter={24}>
        <Col flex="auto">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, alignItems: 'center' }}>
            <Segmented
              value={ansicht}
              onChange={(v) => setAnsicht(v as 'offen' | 'abgeschlossen')}
              options={[
                { value: 'offen', label: `Offen (${offene.length})` },
                { value: 'abgeschlossen', label: `Abgeschlossen (${abgeschlossene.length})` },
              ]}
            />
            <Segmented options={[{ value: 'alle', label: 'Alle Richtungen' }, { value: 'intern', label: 'Intern' }, { value: 'extern', label: 'Extern' }]} value="alle" />
            <Select allowClear placeholder="Empfänger filtern" style={{ minWidth: 220 }}
              options={[{ label: 'Einsatzabschnitte', options: MOCK_ABSCHNITTE.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })) }]} />
          </div>
          {ansicht === 'offen' ? (
            offeneGruppen.map(({ gruppe, auftraege }) => (
              <div key={gruppe} style={{ marginBottom: 16 }}>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                  {GRUPPE_LABEL[gruppe]} ({auftraege.length})
                </Typography.Text>
                <AuftragListe auftraege={auftraege} ansicht="offen" {...listenProps} />
              </div>
            ))
          ) : (
            <AuftragListe auftraege={abgeschlossene} ansicht="abgeschlossen" {...listenProps} />
          )}
        </Col>
        <Col flex="360px">
          <AuftragFormular senden={false} abschnitte={MOCK_ABSCHNITTE} einheiten={MOCK_EINHEITEN} onAnlegen={() => {}} />
        </Col>
      </Row>
    </div>
  );
}
