import { Empty, Typography } from 'antd';

interface Props {
  titel: string;
  beschreibung?: string;
}

/** Einheitlicher Platzhalter für noch nicht implementierte Bereiche. */
export default function Platzhalter({ titel, beschreibung }: Props) {
  return (
    <div style={{ textAlign: 'center', paddingTop: 64 }}>
      <Typography.Title level={3} style={{ marginBottom: 8 }}>
        {`🚧 ${titel}`}
      </Typography.Title>
      {beschreibung && (
        <Typography.Paragraph type="secondary" style={{ maxWidth: 480, margin: '0 auto' }}>
          {beschreibung}
        </Typography.Paragraph>
      )}
      <Empty description="In Arbeit" image={Empty.PRESENTED_IMAGE_SIMPLE} />
    </div>
  );
}
