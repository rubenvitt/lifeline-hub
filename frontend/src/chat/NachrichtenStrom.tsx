import { PaperClipOutlined } from '@ant-design/icons';
import { Button, List, Space, Tag, Typography } from 'antd';
import type { BezugTyp, ChatNachricht } from '../api/types';

/** Menschlich lesbare Dateigröße. */
function formatGroesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  nachrichten: ChatNachricht[];
  eigeneBenutzerId: number | null;
  darfSchreiben: boolean;
  onBearbeiten: (n: ChatNachricht) => void;
  onLoeschen: (n: ChatNachricht) => void;
  onHeraufstufen: (n: ChatNachricht) => void;
  onHeraufstufenAuftrag: (n: ChatNachricht) => void;
  /** Sachbezug setzen/ändern (LFH-103). Ohne diesen Callback wird kein Bezug-Button gezeigt. */
  onBezugSetzen?: (n: ChatNachricht) => void;
  /** Sachbezug lösen (LFH-103). */
  onBezugLoeschen?: (n: ChatNachricht) => void;
  /** Löst einen gesetzten Bezug zu einem Anzeige-Label auf. */
  bezugLabel?: (typ: BezugTyp, id: number) => string;
}

export default function NachrichtenStrom({
  nachrichten, eigeneBenutzerId, darfSchreiben, onBearbeiten, onLoeschen, onHeraufstufen, onHeraufstufenAuftrag,
  onBezugSetzen, onBezugLoeschen, bezugLabel,
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
        const hatBezug = n.bezug_typ !== null && n.bezug_id !== null;
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
                    ...(darfSchreiben && onBezugSetzen
                      ? [<Button key="bezug" type="link" size="small" onClick={() => onBezugSetzen(n)}>
                          {hatBezug ? 'Bezug ändern' : 'Bezug'}
                        </Button>]
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
                  {!geloescht && hatBezug && bezugLabel && (
                    <Tag
                      color="cyan"
                      closable={darfSchreiben && onBezugLoeschen !== undefined}
                      onClose={(e) => {
                        e.preventDefault();
                        onBezugLoeschen?.(n);
                      }}
                    >
                      {bezugLabel(n.bezug_typ as BezugTyp, n.bezug_id as number)}
                    </Tag>
                  )}
                </Space>
              }
              description={
                geloescht ? (
                  <Typography.Text type="secondary" italic>Nachricht gelöscht</Typography.Text>
                ) : (
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    {n.inhalt && <Typography.Text>{n.inhalt}</Typography.Text>}
                    {n.anhaenge.map((a) => (
                      <Typography.Link
                        key={a.id}
                        href={`/api/einsaetze/${n.einsatz_id}/anhaenge/${a.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <PaperClipOutlined /> {a.dateiname}{' '}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          ({formatGroesse(a.groesse)})
                        </Typography.Text>
                      </Typography.Link>
                    ))}
                  </Space>
                )
              }
            />
          </List.Item>
        );
      }}
    />
  );
}
