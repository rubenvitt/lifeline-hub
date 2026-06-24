import { Button, Dropdown, Space, Tag, Typography, type MenuProps } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { uhsDetailPfad } from '../../routing/deeplinks';
import { listeUhs } from '../../api/einsatzUhs';
import UhsAnlegenDrawer from './UhsAnlegenDrawer';
import type { Uhs, UhsStatus } from '../../api/types';

const STATUS_META: Record<UhsStatus, { label: string; color: string; rang: number }> = {
  aktiv: { label: 'aktiv', color: 'green', rang: 0 },
  geplant: { label: 'geplant', color: 'default', rang: 1 },
  aufgeloest: { label: 'aufgelöst', color: 'red', rang: 2 },
};

/** Header-Switcher im UHS-Detail: aktuelle UHS + Wechsel zu anderen + Neuanlage. */
export default function UhsSwitcher({ einsatzId, aktuelleUhs }: { einsatzId: number; aktuelleUhs: Uhs }) {
  const navigate = useNavigate();
  const [anlegen, setAnlegen] = useState(false);
  const detailPfad = (uhsId: number) => uhsDetailPfad(einsatzId, uhsId);

  const { data: liste = [] } = useQuery({
    queryKey: ['einsatz-uhs', einsatzId],
    queryFn: () => listeUhs(einsatzId),
  });

  const sortiert = [...liste].sort(
    (a, b) => STATUS_META[a.status].rang - STATUS_META[b.status].rang
      || a.bezeichnung.localeCompare(b.bezeichnung, 'de'),
  );

  const items: MenuProps['items'] = [
    ...sortiert.map((u) => ({
      key: `uhs-${u.id}`,
      label: (
        <Space>
          {u.bezeichnung}
          <Tag color={STATUS_META[u.status].color} style={{ marginInlineEnd: 0 }}>
            {STATUS_META[u.status].label}
          </Tag>
        </Space>
      ),
    })),
    { type: 'divider' as const },
    { key: 'neu', label: '+ Neue UHS' },
  ];

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'neu') setAnlegen(true);
    else if (key.startsWith('uhs-')) navigate(detailPfad(Number(key.slice('uhs-'.length))));
  };

  return (
    <>
      <Dropdown menu={{ items, onClick }} trigger={['click']}>
        <Button type="text" style={{ padding: 0, height: 'auto' }}>
          <Typography.Text strong style={{ fontSize: 20 }}>
            {aktuelleUhs.bezeichnung} <DownOutlined style={{ fontSize: 14 }} />
          </Typography.Text>
        </Button>
      </Dropdown>
      <UhsAnlegenDrawer
        einsatzId={einsatzId}
        open={anlegen}
        onClose={() => setAnlegen(false)}
        onAngelegt={(uhs) => navigate(detailPfad(uhs.id))}
      />
    </>
  );
}
