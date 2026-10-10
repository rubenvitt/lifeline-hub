import {
  IconMuelleimer,
  IconPlus,
  IconPunkteSenkrecht,
  IconStern,
  IconSternGefuellt,
  IconStift,
} from '../../icons';
import { useState } from 'react';
import { Button, Dropdown, Input, Modal, Radio, Space, Typography } from 'antd';
import { Select } from '../../components/Select';
import { useRollen } from '../../components/instrument';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import type { KartenAnsicht } from '../../api/types';

interface AnsichtSwitcherProps {
  ansichten: KartenAnsicht[];
  aktiveAnsichtId?: number;
  darfSchreiben: boolean;
  busy?: boolean;
  onWaehlen: (id: number) => void;
  /**
   * Neu, Umbenennen und Löschen geben die Antwort zurück: der Dialog wartet darauf, schließt nur
   * beim Erfolg und nennt eine Ablehnung in sich (LFH-1077, design.md D3).
   */
  onNeu: (name: string) => Promise<unknown> | void;
  onUmbenennen: (id: number, name: string) => Promise<unknown> | void;
  onStandard: (id: number) => void;
  onLoeschen: (id: number, objekte: 'freigeben' | 'loeschen') => Promise<unknown> | void;
}

/** Dialog-State der Namens-Eingabe (Neu / Umbenennen teilen ihn). */
type NameDialog = { modus: 'neu' } | { modus: 'umbenennen'; id: number; start: string } | null;

/**
 * Ansichts-Switcher oben in der Lagekarten-Sidebar: Select zum Umschalten plus Neu / Umbenennen /
 * Als Standard / Löschen. Löschen fragt, was mit den ansichtsgebundenen Objekten geschieht
 * (freigeben vs. mitlöschen).
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
  const { token, rollen } = useRollen();
  const [nameDialog, setNameDialog] = useState<NameDialog>(null);
  const [nameWert, setNameWert] = useState('');
  const [loeschDialog, setLoeschDialog] = useState<boolean>(false);
  const [objektBehandlung, setObjektBehandlung] = useState<'freigeben' | 'loeschen'>('freigeben');
  // Laufende Antwort und Grund der letzten Ablehnung; beide Dialoge teilen sie, offen ist einer.
  const [laeuft, setLaeuft] = useState(false);
  const [dialogFehler, setDialogFehler] = useState<unknown>(null);

  // Ladezustand (noch keine Ansicht geladen): kein Switcher — der Lazy-Seed liefert stets ≥1.
  if (ansichten.length === 0) return null;

  const aktive =
    ansichten.find((a) => a.id === aktiveAnsichtId) ??
    ansichten.find((a) => a.ist_standard) ??
    ansichten[0];

  function oeffneNeu() {
    setNameWert('');
    setDialogFehler(null);
    setNameDialog({ modus: 'neu' });
  }
  function oeffneUmbenennen() {
    if (!aktive) return;
    setNameWert(aktive.name);
    setDialogFehler(null);
    setNameDialog({ modus: 'umbenennen', id: aktive.id, start: aktive.name });
  }
  /** Wartet auf die Antwort; geschlossen wird nur beim Erfolg, sonst steht der Grund im Dialog. */
  async function sende(aufruf: () => Promise<unknown> | void, schliessen: () => void) {
    if (laeuft) return;
    setDialogFehler(null);
    setLaeuft(true);
    try {
      await aufruf();
      schliessen();
    } catch (e) {
      setDialogFehler(e);
    } finally {
      setLaeuft(false);
    }
  }
  function bestaetigeName() {
    const name = nameWert.trim();
    const dialog = nameDialog;
    if (!name || !dialog) return;
    void sende(
      () => (dialog.modus === 'neu' ? onNeu(name) : onUmbenennen(dialog.id, name)),
      () => setNameDialog(null),
    );
  }
  function bestaetigeLoeschen() {
    if (!aktive) return;
    const id = aktive.id;
    void sende(
      () => onLoeschen(id, objektBehandlung),
      () => setLoeschDialog(false),
    );
  }
  // Abbrechen ist während des Laufs gesperrt, sonst hätte die Ablehnung keinen Ort mehr.
  function schliesseName() {
    if (laeuft) return;
    setNameDialog(null);
    setDialogFehler(null);
  }
  function schliesseLoeschen() {
    if (laeuft) return;
    setLoeschDialog(false);
    setDialogFehler(null);
  }

  const nurEineAnsicht = ansichten.length <= 1;
  const aktiveIstStandard = !!aktive?.ist_standard;
  // Standardansicht/letzte Ansicht sind nicht löschbar (Backend → 422) — hier schon ausgrauen.
  const loeschenGesperrt = nurEineAnsicht || aktiveIstStandard;

  const menuItems = [
    { key: 'neu', icon: <IconPlus />, label: 'Neue Ansicht …' },
    { key: 'umbenennen', icon: <IconStift />, label: 'Umbenennen …', disabled: !aktive },
    {
      key: 'standard',
      icon: <IconStern />,
      label: 'Als Standard',
      disabled: !aktive || aktiveIstStandard,
    },
    { type: 'divider' as const },
    {
      key: 'loeschen',
      icon: <IconMuelleimer />,
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
      setDialogFehler(null);
      setLoeschDialog(true);
    }
  }

  return (
    // Kein Außenabstand: die Polsterung des Paneels „Kartenansicht" trägt den Abstand.
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Ansicht
      </Typography.Text>
      <Space.Compact block style={{ marginTop: token.marginXS }}>
        <Select<number>
          style={{ flex: 1 }}
          value={aktive?.id}
          onChange={onWaehlen}
          disabled={busy}
          aria-label="Kartenansicht wählen"
          options={ansichten.map((a) => ({
            value: a.id,
            label: (
              <Space size={token.marginXS}>
                {/* Kennzeichnung, keine Warnung: Iconrolle `schwach` statt `achtung` (LFH-704).
                    Zweiter Kanal ist „Als Standard“ im Menü. */}
                {a.ist_standard && <IconSternGefuellt style={{ color: rollen.schwach }} />}
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
            <Button icon={<IconPunkteSenkrecht />} aria-label="Ansichts-Aktionen" loading={busy} />
          </Dropdown>
        )}
      </Space.Compact>

      <Modal
        open={nameDialog != null}
        title={nameDialog?.modus === 'umbenennen' ? 'Ansicht umbenennen' : 'Neue Ansicht'}
        okText="Speichern"
        cancelText="Abbrechen"
        okButtonProps={{ disabled: !nameWert.trim() }}
        confirmLoading={laeuft}
        cancelButtonProps={{ disabled: laeuft }}
        closable={!laeuft}
        mask={{ closable: !laeuft }}
        keyboard={!laeuft}
        onOk={bestaetigeName}
        onCancel={schliesseName}
        destroyOnHidden
      >
        <Space orientation="vertical" size={token.marginSM} style={{ width: '100%' }}>
          <Input
            autoFocus
            placeholder="Name der Ansicht"
            value={nameWert}
            onChange={(e) => setNameWert(e.target.value)}
            onPressEnter={bestaetigeName}
            aria-label="Ansichts-Name"
          />
          {/* Nur mit Grund: ein leeres Kind hielte in `Space` trotzdem seinen Abstand. */}
          {dialogFehler != null &&
            (nameDialog?.modus === 'neu' ? (
              <SpeicherFehler
                fehler={dialogFehler}
                titel="Nicht angelegt"
                fallback="Anlegen fehlgeschlagen"
              />
            ) : (
              <SpeicherFehler fehler={dialogFehler} />
            ))}
        </Space>
      </Modal>

      <Modal
        open={loeschDialog}
        title={`Ansicht „${aktive?.name ?? ''}" löschen`}
        okText="Löschen"
        okButtonProps={{ danger: true }}
        cancelText="Abbrechen"
        confirmLoading={laeuft}
        cancelButtonProps={{ disabled: laeuft }}
        closable={!laeuft}
        mask={{ closable: !laeuft }}
        keyboard={!laeuft}
        onOk={bestaetigeLoeschen}
        onCancel={schliesseLoeschen}
        destroyOnHidden
      >
        <Typography.Paragraph>Zeichen, Zonen und Bilder dieser Ansicht:</Typography.Paragraph>
        <Radio.Group
          name="objekt-behandlung"
          value={objektBehandlung}
          onChange={(e) => setObjektBehandlung(e.target.value)}
        >
          <Space orientation="vertical">
            <Radio value="freigeben">Auf allen Ansichten sichtbar machen (empfohlen)</Radio>
            <Radio value="loeschen">Mitlöschen</Radio>
          </Space>
        </Radio.Group>
        {dialogFehler != null && (
          <div style={{ marginTop: token.marginSM }}>
            <SpeicherFehler
              fehler={dialogFehler}
              titel="Nicht gelöscht"
              fallback="Löschen fehlgeschlagen"
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
