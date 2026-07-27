import { Avatar, Button, Dropdown, Space, Tag, Typography, theme, type MenuProps } from 'antd';
import { DownOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { rollenFarbe } from '../theme/statusFarben';

/** Initialen aus dem Anzeigenamen (erstes + letztes Wort, sonst erste zwei Zeichen). */
function initialen(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return '?';
  if (teile.length === 1) return teile[0].slice(0, 2).toUpperCase();
  return (teile[0][0] + teile[teile.length - 1][0]).toUpperCase();
}

/**
 * Identitäts-Menü in der Topbar: Avatar + Name als Trigger, Dropdown mit
 * Rollen-Übersicht, Profil und Abmelden. Holt sich Benutzer und Logout selbst,
 * damit es in beiden Layout-Ebenen (global + Einsatz-Workspace) gleich nutzbar ist.
 *
 * Der Avatar trägt die MARKENFARBE (LFH-328/A2, Spec §1.2) — er ist das Markenzeichen im
 * Kopf, keine Gefahrenmeldung. Sie kommt über `rollenFarbe('marke', token)` und damit je
 * Modus aus `theme/tokens.ts`; vorher stand hier eine Kopie des Hex-Werts.
 */
export default function BenutzerMenu() {
  const { benutzer, logout } = useAuth();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const avatarFarbe = rollenFarbe('marke', token);

  if (!benutzer) return null;

  async function abmelden() {
    await logout();
    navigate('/login', { replace: true });
  }

  const rollenTags = [];
  if (benutzer.system_rolle === 'admin') {
    rollenTags.push(
      <Tag key="admin" color="gold" style={{ marginInlineEnd: 0 }}>
        Admin
      </Tag>,
    );
  }
  if (benutzer.org_rolle === 'fuehrungskraft') {
    rollenTags.push(
      <Tag key="fk" color="blue" style={{ marginInlineEnd: 0 }}>
        Führungskraft
      </Tag>,
    );
  }

  const items: MenuProps['items'] = [
    {
      key: 'kopf',
      type: 'group',
      label: (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '4px 0' }}>
          <Avatar style={{ backgroundColor: avatarFarbe, color: '#fff', flexShrink: 0 }}>
            {initialen(benutzer.anzeigename)}
          </Avatar>
          <div style={{ minWidth: 0 }}>
            <Typography.Text strong style={{ display: 'block', fontSize: 14, lineHeight: 1.3 }}>
              {benutzer.anzeigename}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              @{benutzer.benutzername}
            </Typography.Text>
            {rollenTags.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <Space size={4} wrap>
                  {rollenTags}
                </Space>
              </div>
            )}
          </div>
        </div>
      ),
    },
    { type: 'divider' },
    { key: 'profil', icon: <UserOutlined />, label: 'Profil' },
    { key: 'abmelden', icon: <LogoutOutlined />, label: 'Abmelden', danger: true },
  ];

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'profil') navigate('/profil');
    else if (key === 'abmelden') void abmelden();
  };

  return (
    <Dropdown
      menu={{ items, onClick, style: { minWidth: 240 } }}
      trigger={['click']}
      placement="bottomRight"
    >
      <Button
        type="text"
        aria-label="Benutzermenü"
        style={{
          height: 40,
          padding: '0 8px',
          color: '#fff',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Avatar
          size={28}
          style={{ backgroundColor: avatarFarbe, color: '#fff', fontSize: 13, flexShrink: 0 }}
        >
          {initialen(benutzer.anzeigename)}
        </Avatar>
        <span
          style={{
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {benutzer.anzeigename}
        </span>
        <DownOutlined style={{ fontSize: 10, opacity: 0.65 }} />
      </Button>
    </Dropdown>
  );
}
