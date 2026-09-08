import { Alert, App, Button, Form, Input, Modal, Popconfirm, Space } from 'antd';
import { Select } from '../components/Select';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { EinsatzRolle, MitgliedAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import { entferneMitglied, ladeMitglieder, setzeMitglied } from '../api/einsaetze';
import { listeBenutzer } from '../api/benutzer';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import KatalogTabelle from '../components/KatalogTabelle';
import SektionHeader from '../components/SektionHeader';

const ROLLEN: { value: EinsatzRolle; label: string }[] = [
  { value: 'einsatzleitung', label: 'Einsatzleitung' },
  { value: 'fuehrungspersonal', label: 'Führungspersonal' },
  { value: 'beobachter', label: 'Beobachter' },
];

interface Props {
  einsatzId: number;
  darfVerwalten: boolean;
}

/**
 * Zugriffsverwaltung eines Einsatzes (gemountet in `EinsatzdatenPage`).
 *
 * ── WARUM HIER KEINE KARTEN UNTER `md` STEHEN (LFH-339 · C4) ─────────────────────────
 *
 * Das Ticket verlangt, die Zeilen unter `md` „als Zeilen-Karte" zu rendern. Das wird
 * bewusst NICHT getan, und der Grund ist eine Regel, die dem Ticket vorausgeht: Träger ist
 * `KatalogTabelle`, und für die gilt „auf schmalem Schirm wird eine Tabelle ANGEPASST,
 * nicht in Karten aufgelöst" — das Primitiv bringt Scrollcontainer, stehende Kopfzeile und
 * fixierte Kennungsspalte selbst mit. Drei Spalten (Name · Rolle · Aktion) passen damit
 * auch auf 390 px, ohne dass die Seite quer läuft.
 *
 * Was am schmalen Schirm tatsächlich drückte, war die feste `width: 170` am Rollenfeld —
 * die ist unten zu einem `minWidth` geworden. Das ist die Anpassung, die der Befund
 * verlangt; die Kartenform wäre eine Formänderung ohne Not.
 */
export default function MitgliederAbschnitt({ einsatzId, darfVerwalten }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [neuerBenutzer, setNeuerBenutzer] = useState<number | undefined>();
  const [neueRolle, setNeueRolle] = useState<EinsatzRolle>('fuehrungspersonal');
  const [stelleZiel, setStelleZiel] = useState<(MitgliedAnzeige & { einsatzId: number }) | null>(null);
  const [stelleWert, setStelleWert] = useState('');

  const stelleSetzen = useMutation({
    mutationFn: ({ mitglied, wert }: { mitglied: MitgliedAnzeige & { einsatzId: number }; wert: string | null }) =>
      setzeMitglied(mitglied.einsatzId, mitglied.benutzer_id, mitglied.einsatz_rolle, wert),
    onSuccess: (liste, { mitglied }) => {
      qc.setQueryData(einsatzKeys.mitglieder(mitglied.einsatzId), liste);
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(mitglied.einsatzId) });
      setStelleZiel((aktuell) => aktuell?.einsatzId === mitglied.einsatzId ? null : aktuell);
    },
  });

  const stelleSpeichern = () => {
    if (!stelleZiel || stelleZiel.einsatzId !== einsatzId || !darfVerwalten || stelleSetzen.isPending) return;
    const wert = stelleWert.trim() || null;
    if (wert === (stelleZiel.fuehrungsstelle ?? null)) {
      setStelleZiel(null);
      return;
    }
    stelleSetzen.mutate({ mitglied: stelleZiel, wert });
  };

  const mitgliederQuery = useQuery({
    queryKey: einsatzKeys.mitglieder(einsatzId),
    queryFn: () => ladeMitglieder(einsatzId),
  });
  const benutzerQuery = useQuery({
    queryKey: globalKeys.benutzer(),
    queryFn: listeBenutzer,
    enabled: darfVerwalten,
  });

  const setzen = useMutation({
    mutationFn: (v: { benutzerId: number; rolle: EinsatzRolle }) =>
      setzeMitglied(einsatzId, v.benutzerId, v.rolle),
    onSuccess: (liste) => {
      qc.setQueryData(einsatzKeys.mitglieder(einsatzId), liste);
      setNeuerBenutzer(undefined);
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });
  const entfernen = useMutation({
    mutationFn: (benutzerId: number) => entferneMitglied(einsatzId, benutzerId),
    onSuccess: (liste) => qc.setQueryData(einsatzKeys.mitglieder(einsatzId), liste),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const mitglieder = mitgliederQuery.data ?? [];
  const mitgliedIds = new Set(mitglieder.map((m) => m.benutzer_id));
  const verfuegbar = (benutzerQuery.data ?? []).filter((b) => b.aktiv && !mitgliedIds.has(b.id));

  const spalten: ColumnsType<MitgliedAnzeige> = [
    { title: 'Name', dataIndex: 'anzeigename' },
    {
      title: 'Führungsstelle',
      key: 'fuehrungsstelle',
      render: (_, m) => darfVerwalten ? (
        <Button
          type="link"
          disabled={stelleSetzen.isPending}
          aria-label={`Führungsstelle für ${m.anzeigename} bearbeiten`}
          onClick={() => {
            stelleSetzen.reset();
            setStelleWert(m.fuehrungsstelle ?? '');
            setStelleZiel({ ...m, einsatzId });
          }}
        >
          {m.fuehrungsstelle || 'Führungsstelle festlegen'}
        </Button>
      ) : (m.fuehrungsstelle || '—'),
    },
    {
      title: 'Rolle',
      key: 'rolle',
      render: (_, m) => (
        <Select
          value={m.einsatz_rolle}
          disabled={!darfVerwalten}
          // `minWidth` statt fester `width` (LFH-339 · C4): eine feste Breite drückt die
          // Zelle am schmalen Schirm auf, statt mitzugehen. Der Boden bleibt, damit
          // „Führungspersonal" nicht abgeschnitten wird.
          style={{ minWidth: 170, maxWidth: '100%' }}
          options={ROLLEN}
          onChange={(rolle) => setzen.mutate({ benutzerId: m.benutzer_id, rolle })}
        />
      ),
    },
    {
      // Beschriftet (LFH-339 · C4, Befund N7): eine namenlose Spalte ist für einen
      // Screenreader eine Zelle ohne Zugehörigkeit.
      title: 'Aktion',
      key: 'aktion',
      render: (_, m) =>
        darfVerwalten ? (
          <Popconfirm
            title="Mitglied entfernen?"
            okText="Ja"
            cancelText="Abbrechen"
            okButtonProps={{ danger: true }}
            onConfirm={() => entfernen.mutate(m.benutzer_id)}
          >
            {/* Regulärer Knopf statt `type="link"`: ein Textlink sieht aus wie Fliesstext,
                obwohl er die einzige destruktive Handlung der Zeile auslöst. `danger`
                bleibt — Löschen IST Gefahr, und die Rückfrage ist der zweite Handgriff. */}
            <Button danger>Entfernen</Button>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <section style={{ marginTop: 32 }}>
      <SektionHeader titel="Zugriff" dataUpdatedAt={mitgliederQuery.dataUpdatedAt} />
      {darfVerwalten && (
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            placeholder="Benutzer …"
            style={{ width: 200 }}
            value={neuerBenutzer}
            options={verfuegbar.map((b) => ({ value: b.id, label: b.anzeigename }))}
            onChange={(v) => setNeuerBenutzer(v)}
            notFoundContent={
              benutzerQuery.error instanceof ApiError && benutzerQuery.error.status === 403
                ? 'Benutzerliste nur für Admins'
                : benutzerQuery.isError
                  ? 'Benutzerliste nicht verfügbar'
                  : undefined
            }
          />
          <Select value={neueRolle} style={{ width: 170 }} options={ROLLEN} onChange={setNeueRolle} />
          <Button
            type="primary"
            disabled={neuerBenutzer == null}
            loading={setzen.isPending}
            onClick={() =>
              neuerBenutzer != null && setzen.mutate({ benutzerId: neuerBenutzer, rolle: neueRolle })
            }
          >
            Hinzufügen
          </Button>
        </Space>
      )}
      <KatalogTabelle<MitgliedAnzeige>
        rowKey="benutzer_id"
        size="small"
        pagination={false}
        loading={mitgliederQuery.isLoading}
        columns={spalten}
        dataSource={mitglieder}
      />
      <Modal
        title={`Führungsstelle für ${stelleZiel?.anzeigename ?? ''}`}
        open={stelleZiel !== null && stelleZiel.einsatzId === einsatzId && darfVerwalten}
        onCancel={() => { if (!stelleSetzen.isPending) setStelleZiel(null); }}
        onOk={stelleSpeichern}
        okText="Speichern"
        cancelText="Abbrechen"
        confirmLoading={stelleSetzen.isPending}
        cancelButtonProps={{ disabled: stelleSetzen.isPending }}
        destroyOnHidden
      >
        <Form layout="vertical" onFinish={stelleSpeichern}>
          <Form.Item label="Führungsstelle" htmlFor="mitglied-fuehrungsstelle" extra="Wird beim ersten neuen ETB-Eintrag als Empfänger vorbelegt. Leer lassen entfernt die Vorbelegung.">
            <Input
              id="mitglied-fuehrungsstelle"
              autoFocus
              maxLength={200}
              value={stelleWert}
              disabled={stelleSetzen.isPending}
              onChange={(e) => setStelleWert(e.target.value)}
            />
          </Form.Item>
          {stelleSetzen.isError && <Alert type="error" title={stelleSetzen.error.message} showIcon />}
        </Form>
      </Modal>
    </section>
  );
}
