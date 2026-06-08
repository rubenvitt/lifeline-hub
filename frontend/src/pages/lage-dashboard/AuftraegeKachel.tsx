import { Card, Empty } from 'antd';

/**
 * Platzhalter: Das Aufträge-Modul (Backend) existiert noch nicht (Status 'geplant').
 * Die Kachel zeigt die geplante Struktur, bis die Daten verfügbar sind.
 */
export default function AuftraegeKachel() {
  return (
    <Card size="small" title="Aufträge / Befehle" style={{ height: '100%' }}>
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Kommt mit dem Aufträge-Modul" />
    </Card>
  );
}
