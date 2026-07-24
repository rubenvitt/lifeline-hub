import { useState } from 'react';
import { Button, Dropdown, Input, Modal, Radio, Space, Typography } from 'antd';
import { Select } from '../../components/Select';
import {
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons';
import type { KartenAnsicht } from '../../api/types';

interface AnsichtSwitcherProps {
  ansichten: KartenAnsicht[];
  aktiveAnsichtId?: number;
  darfSchreiben: boolean;
  busy?: boolean;
  onWaehlen: (id: number) => void;
  onNeu: (name: string) => void;
  onUmbenennen: (id: number, name: string) => void;
  onStandard: (id: number) => void;
  onLoeschen: (id: number, objekte: 'freigeben' | 'loeschen') => void;
}

/** Dialog-State der Namens-Eingabe (Neu / Umbenennen teilen ihn). */
type NameDialog = { modus: 'neu' } | { modus: 'umbenennen'; id: number; start: string } | null;

/**
 * Ansichts-Switcher (B/LFH-320) oben in der Lagekarten-Sidebar: Select zum Umschalten plus
 * die Verwaltungs-Aktionen Neu / Umbenennen / Als Standard / Löschen. Kompaktes
 * Navigationsmuster (Select + ⋯-Menü) statt einer eigenen Seite. Löschen fragt, was mit den
 * ansichtsgebundenen Objekten geschieht (freigeben vs. mitlöschen).
 */
export default function AnsichtSwitcher({
  ansichten,
  aktiveAnsichtId,
  darfSchreiben,
  busy,
  onWaehlen,
  onNeu,
  onUmbenennen,
  onStandard,
  onLoeschen,
}: AnsichtSwitcherProps) {
  const [nameDialog, setNameDialog] = useState<NameDialog>(null);
  const [nameWert, setNameWert] = useState('');
  const [loeschDialog, setLoeschDialog] = useState<boolean>(false);
  const [objektBehandlung, setObjektBehandlung] = useState<'freigeben' | 'loeschen'>('freigeben');

  // Ladezustand (noch keine Ansicht geladen): kein Switcher — der Lazy-Seed liefert stets ≥1.
  if (ansichten.length === 0) return null;

  const aktive =
    ansichten.find((a) => a.id === aktiveAnsichtId) ??
    ansichten.find((a) => a.ist_standard) ??
    ansichten[0];

  function oeffneNeu() {
    setNameWert('');
    setNameDialog({ modus: 'neu' });
  }
  function oeffneUmbenennen() {
    if (!aktive) return;
    setNameWert(aktive.name);
    setNameDialog({ modus: 'umbenennen', id: aktive.id, start: aktive.name });
  }
  function bestaetigeName() {
    const name = nameWert.trim();
    if (!name || !nameDialog) return;
    if (nameDialog.modus === 'neu') onNeu(name);
    else onUmbenennen(nameDialog.id, name);
    setNameDialog(null);
  }
  function bestaetigeLoeschen() {
    if (!aktive) return;
    onLoeschen(aktive.id, objektBehandlung);
    setLoeschDialog(false);
  }

  const nurEineAnsicht = ansichten.length <= 1;
  const aktiveIstStandard = !!aktive?.ist_standard;
  // Standardansicht/letzte Ansicht sind nicht löschbar (Backend → 422) — hier schon ausgrauen.
  const loeschenGesperrt = nurEineAnsicht || aktiveIstStandard;

  const menuItems = [
    { key: 'neu', icon: <PlusOutlined />, label: 'Neue Ansicht …' },
    { key: 'umbenennen', icon: <EditOutlined />, label: 'Umbenennen …', disabled: !aktive },
    {
      key: 'standard',
      icon: <StarOutlined />,
      label: 'Als Standard',
      disabled: !aktive || aktiveIstStandard,
    },
    { type: 'divider' as const },
    {
      key: 'loeschen',
      icon: <DeleteOutlined />,
      label: 'Löschen …',
      danger: true,
      disabled: loeschenGesperrt,
    },
  ];

  function onMenu(key: string) {
    if (key === 'neu') oeffneNeu();
    else if (key === 'umbenennen') oeffneUmbenennen();
    else if (key === 'standard' && aktive) onStandard(aktive.id);
    else if (key === 'loeschen') {
      setObjektBehandlung('freigeben');
      setLoeschDialog(true);
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Ansicht
      </Typography.Text>
      <Space.Compact block style={{ marginTop: 4 }}>
        <Select<number>
          style={{ flex: 1 }}
          value={aktive?.id}
          onChange={onWaehlen}
          disabled={busy}
          aria-label="Kartenansicht wählen"
          options={ansichten.map((a) => ({
            value: a.id,
            label: (
              <Space size={4}>
                {a.ist_standard && <StarFilled style={{ color: '#faad14' }} />}
                {a.name}
              </Space>
            ),
          }))}
        />
        {darfSchreiben && (
          <Dropdown
            trigger={['click']}
            menu={{ items: menuItems, onClick: ({ key }) => onMenu(key) }}
          >
            <Button icon={<MoreOutlined />} aria-label="Ansichts-Aktionen" loading={busy} />
          </Dropdown>
        )}
      </Space.Compact>

      <Modal
        open={nameDialog != null}
        title={nameDialog?.modus === 'umbenennen' ? 'Ansicht umbenennen' : 'Neue Ansicht'}
        okText="Speichern"
        cancelText="Abbrechen"
        okButtonProps={{ disabled: !nameWert.trim() }}
        onOk={bestaetigeName}
        onCancel={() => setNameDialog(null)}
        destroyOnHidden
      >
        <Input
          autoFocus
          placeholder="Name der Ansicht"
          value={nameWert}
          onChange={(e) => setNameWert(e.target.value)}
          onPressEnter={bestaetigeName}
          aria-label="Ansichts-Name"
        />
      </Modal>

      <Modal
        open={loeschDialog}
        title={`Ansicht „${aktive?.name ?? ''}" löschen`}
        okText="Löschen"
        okButtonProps={{ danger: true }}
        cancelText="Abbrechen"
        onOk={bestaetigeLoeschen}
        onCancel={() => setLoeschDialog(false)}
        destroyOnHidden
      >
        <Typography.Paragraph>
          Was soll mit den auf dieser Ansicht angelegten Objekten (Zeichen, Zonen, Bilder)
          geschehen?
        </Typography.Paragraph>
        <Radio.Group
          name="objekt-behandlung"
          value={objektBehandlung}
          onChange={(e) => setObjektBehandlung(e.target.value)}
        >
          <Space direction="vertical">
            <Radio value="freigeben">Auf allen Ansichten sichtbar machen (empfohlen)</Radio>
            <Radio value="loeschen">Mitlöschen</Radio>
          </Space>
        </Radio.Group>
      </Modal>
    </div>
  );
}
