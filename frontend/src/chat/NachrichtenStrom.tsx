import { Button, List, Space, Tag, Typography } from 'antd';
import type { ChatNachricht } from '../api/types';

interface Props {
  nachrichten: ChatNachricht[];
  eigeneBenutzerId: number | null;
  darfSchreiben: boolean;
  onBearbeiten: (n: ChatNachricht) => void;
  onLoeschen: (n: ChatNachricht) => void;
  onHeraufstufen: (n: ChatNachricht) => void;
  onHeraufstufenAuftrag: (n: ChatNachricht) => void;
}

export default function NachrichtenStrom({
  nachrichten, eigeneBenutzerId, darfSchreiben, onBearbeiten, onLoeschen, onHeraufstufen, onHeraufstufenAuftrag,
}: Props) {
  return (
    <List<ChatNachricht>
      dataSource={nachrichten}
      locale={{ emptyText: 'Noch keine Nachrichten' }}
      renderItem={(n) => {
        const geloescht = n.geloescht_at !== null;
        const eigene = eigeneBenutzerId !== null && n.autor_id === eigeneBenutzerId;
        const heraufgestuft = n.etb_eintrag_id !== null;
        const heraufgestuftZuAuftrag = n.auftrag_id !== null;
        return (
          <List.Item
            actions={
              geloescht
                ? []
                : [
                    ...(darfSchreiben && !heraufgestuft
                      ? [<Button key="hoch" type="link" size="small" onClick={() => onHeraufstufen(n)}>Zu ETB</Button>]
                      : []),
                    ...(darfSchreiben && !heraufgestuftZuAuftrag
                      ? [<Button key="auftrag" type="link" size="small" onClick={() => onHeraufstufenAuftrag(n)}>Zu Auftrag</Button>]
                      : []),
                    ...(eigene && darfSchreiben
                      ? [
                          <Button key="edit" type="link" size="small" onClick={() => onBearbeiten(n)}>Bearbeiten</Button>,
                          <Button key="del" type="link" size="small" danger onClick={() => onLoeschen(n)}>Löschen</Button>,
                        ]
                      : []),
                  ]
            }
          >
            <List.Item.Meta
              title={
                <Space size="small">
                  <Typography.Text strong>{n.autor_name}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>
                    {n.erstellt_at}
                  </Typography.Text>
                  {n.bearbeitet_at && <Tag>bearbeitet</Tag>}
                  {heraufgestuft && <Tag color="blue">heraufgestuft zu ETB</Tag>}
                  {heraufgestuftZuAuftrag && <Tag color="geekblue">heraufgestuft zu Auftrag</Tag>}
                </Space>
              }
              description={
                geloescht ? (
                  <Typography.Text type="secondary" italic>Nachricht gelöscht</Typography.Text>
                ) : (
                  <Typography.Text>{n.inhalt}</Typography.Text>
                )
              }
            />
          </List.Item>
        );
      }}
    />
  );
}
