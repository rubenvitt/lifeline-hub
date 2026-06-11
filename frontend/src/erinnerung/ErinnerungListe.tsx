import { List, Tag, Button, Space, Typography } from 'antd';
import dayjs from 'dayjs';
import type { Erinnerung } from '../api/types';

interface Props {
  erinnerungen: Erinnerung[];
  darfSchreiben: boolean;
  onErledigen: (id: number) => void;
  onQuittieren: (id: number) => void;
}

/// Gespeicherte UTC-Fälligkeit zur lokalen Anzeige (utc-Plugin global aktiv, s. main.tsx).
function faelligLokal(wert: string): string {
  return dayjs.utc(wert).local().format('YYYY-MM-DD HH:mm');
}

export default function ErinnerungListe({ erinnerungen, darfSchreiben, onErledigen, onQuittieren }: Props) {
  if (erinnerungen.length === 0) {
    return <Typography.Text type="secondary">Keine offenen Erinnerungen.</Typography.Text>;
  }
  return (
    <List
      dataSource={erinnerungen}
      renderItem={(e) => (
        <List.Item
          actions={darfSchreiben ? [
            <Button key="q" size="small" onClick={() => onQuittieren(e.id)}>Quittieren</Button>,
            <Button key="e" size="small" type="primary" onClick={() => onErledigen(e.id)}>Erledigt</Button>,
          ] : []}
        >
          <List.Item.Meta
            title={
              <Space>
                {e.titel}
                {e.ist_faellig && <Tag color="red">fällig</Tag>}
                {e.intervall_minuten && <Tag>alle {e.intervall_minuten} Min</Tag>}
                {e.quelle === 'auto_frist' && <Tag color="orange">automatisch</Tag>}
              </Space>
            }
            description={
              <Space direction="vertical" size={0}>
                <span>fällig: {faelligLokal(e.faellig_at)}</span>
                {e.empfaenger_funktion && <span>für: {e.empfaenger_funktion}</span>}
                {e.beschreibung && <span>{e.beschreibung}</span>}
              </Space>
            }
          />
        </List.Item>
      )}
    />
  );
}
