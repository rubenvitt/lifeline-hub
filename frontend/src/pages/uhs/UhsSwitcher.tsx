import { Button, Dropdown, Space, Typography, type MenuProps } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { uhsDetailPfad } from '../../routing/deeplinks';
import { listeUhs } from '../../api/einsatzUhs';
import { einsatzKeys } from '../../api/queryKeys';
import UhsAnlegenDrawer from './UhsAnlegenDrawer';
import type { Uhs, UhsStatus } from '../../api/types';
import StatusTag from '../../components/StatusTag';
import { uhsStatus } from '../../theme/statusFarben';

/**
 * Sortierrang der Status im Switcher — aktive UHS zuerst, aufgelöste zuletzt.
 *
 * Bleibt bewusst LOKAL und wandert nicht in den Statusfarb-Vertrag: das ist eine
 * fachliche Reihenfolge dieser einen Liste, keine Darstellung. `statusFarben.ts`
 * beantwortet „welche Bedeutung hat welcher Status", nicht „in welcher Reihenfolge
 * zeigt ihn ausgerechnet der Switcher".
 */
const STATUS_RANG: Record<UhsStatus, number> = {
  aktiv: 0,
  geplant: 1,
  aufgeloest: 2,
};

/** Header-Switcher im UHS-Detail: aktuelle UHS + Wechsel zu anderen + Neuanlage. */
export default function UhsSwitcher({ einsatzId, aktuelleUhs }: { einsatzId: number; aktuelleUhs: Uhs }) {
  const navigate = useNavigate();
  const [anlegen, setAnlegen] = useState(false);
  const detailPfad = (uhsId: number) => uhsDetailPfad(einsatzId, uhsId);

  const { data: liste = [] } = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
  });

  const sortiert = [...liste].sort(
    (a, b) => STATUS_RANG[a.status] - STATUS_RANG[b.status]
      || a.bezeichnung.localeCompare(b.bezeichnung, 'de'),
  );

  const items: MenuProps['items'] = [
    ...sortiert.map((u) => ({
      key: `uhs-${u.id}`,
      label: (
        <Space>
          {u.bezeichnung}
          <StatusTag darstellung={uhsStatus[u.status]} />
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
