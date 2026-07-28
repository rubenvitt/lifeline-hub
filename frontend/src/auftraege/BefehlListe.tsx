import { App, Button, Flex, Form, Input, Modal, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Select } from '../components/Select';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { legeBefehlAn, listeBefehle, type NeuerBefehl } from '../api/befehle';
import { einsatzKeys } from '../api/queryKeys';
import type { BefehlAnzeige, BefehlVorlageKey } from '../api/types';
import { VORLAGEN } from '../befehle/vorlagen';
import { befehlDetailPfad } from '../routing/deeplinks';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import { BEFEHL_STATUS, StatusBadge } from '../kommunikation';

/**
 * Befehlsliste des Aufträge/Befehle-Tabs (LFH-330 · B2, Bündel III).
 *
 * `form="karte"` — in JEDER Breite Karten, nicht erst unterhalb `md`. Ein Befehl wird als
 * EINHEIT gelesen (Schema, Fassung, Freigabestand), nicht spaltenweise verglichen; die
 * Nachbarflächen desselben Tabs (Aufträge, Meldungen, Nachforderungen) sind ebenfalls
 * kartenbasiert. Ein reiner Breakpoint-Rückfall (`form="auto"`) zeigte ab `md` wieder eine
 * Vergleichsfläche und wäre der Befund, nicht der Zielzustand.
 *
 * Das Spaltenregister bleibt trotzdem die einzige Wahrheit: es trägt `etikett`, `sortWert`,
 * `suchText` und den Schemafilter, und der Kartenplan adressiert nur seine Schlüssel.
 *
 * ── DIE V-NUMMER IST KEIN ZIERRAT ────────────────────────────────────────────────────
 * Die Fortschreibung legt eine NEUE Zeile mit `version + 1`, demselben Titel und derselben
 * Vorlage an; der Vorgänger bleibt freigegeben liegen. Die Liste enthält deshalb legitim
 * mehrere Zeilen mit identischem Titel, und die v-Nummer ist das einzige Merkmal, das sie
 * unterscheidet — sie darf nicht „nur bei `version > 1`" erscheinen. Die Gruppierung
 * Entwürfe/Freigegeben zerschneidet die Kette bewusst: nur der Entwurf ist bearbeitbar.
 *
 * Das Schema (`vorlage`) ist die SKK-Befehlsform und bestimmt, welche Abschnitte der Befehl
 * trägt. Es ist über die Fortschreibung unveränderlich — ein Merkmal der Kette, nicht der
 * Fassung — und als geschlossene Menge von vier Werten ein Filter, kein Freitext.
 */

function schemaLabel(schluessel: BefehlVorlageKey | string): string {
  return VORLAGEN.find((v) => v.schluessel === schluessel)?.label ?? String(schluessel);
}

/**
 * Modulkonstante, IN dieser Datei: der Guard verlangt die Marke `spaltenFuer` je
 * Konsumentendatei. Nie annotieren — eine Typangabe weitete `K` auf `string`, und der
 * Kartenplan nähme danach jeden Slot-Tippfehler stillschweigend an.
 */
const befehlSpalten = spaltenFuer<BefehlAnzeige>()([
  {
    key: 'titel',
    title: 'Titel',
    immerSichtbar: true,
    sortWert: (b) => b.titel,
    suchText: (b) => b.titel,
    // KEIN Anker hier: den Link setzt `karte.titel.ziel`, sonst verschachtelte Links.
    render: (_t, b) => b.titel,
  },
  {
    key: 'status',
    title: 'Status',
    // Belegt einen Sekundärslot statt `karte.status`: dieses Modul bleibt auf der
    // Kommunikations-Phasenachse (`kommunikation/phase.ts`), die bewusst außerhalb des
    // A2-Statusfarb-Vertrags liegt — damit sieht der Befehl aus wie der Auftrag im
    // Nachbar-Tab.
    render: (_t, b) => (
      <StatusBadge phase={BEFEHL_STATUS[b.status].phase} label={BEFEHL_STATUS[b.status].label} />
    ),
  },
  {
    key: 'schema',
    title: 'Schema',
    suchText: (b) => schemaLabel(b.vorlage),
    filter: {
      werte: VORLAGEN.map((v) => ({ text: v.label, value: v.schluessel })),
      trifft: (b, w) => b.vorlage === w,
    },
    render: (_t, b) => schemaLabel(b.vorlage),
  },
  {
    key: 'fassung',
    title: 'Fassung',
    sortWert: (b) => b.zeitstand,
    // v-Nummer, Zeitstand und Ersteller in EINER Zeile — drei Slots sind das Maximum.
    // `zeitstand` bleibt der rohe Wirestring: die beiden Detailseiten geben ihn ebenso
    // rohe aus, und nur hier zu formatieren zeigte für dasselbe Feld zwei verschiedene
    // Uhrzeiten (lokal vs. UTC). Die Umstellung aller vier Stellen auf die taktische DTG
    // ist ein eigener Vorgang.
    render: (_t, b) => `v${b.version} · ${b.zeitstand} · ${b.ersteller_name}`,
  },
]);

export default function BefehlListe({ einsatzId, darfSchreiben }: { einsatzId: number; darfSchreiben: boolean }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [form] = Form.useForm<NeuerBefehl>();

  const befehleQuery = useQuery({
    queryKey: einsatzKeys.befehle(einsatzId),
    queryFn: () => listeBefehle(einsatzId),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: einsatzKeys.befehle(einsatzId) });
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: (daten: NeuerBefehl) => legeBefehlAn(einsatzId, daten),
    onSuccess: () => { invalidate(); setAnlegenOffen(false); form.resetFields(); },
    onError: fehler,
  });

  const befehle = befehleQuery.data ?? [];
  const entwuerfe = befehle.filter((b) => b.status === 'entwurf').length;

  return (
    <div>
      <Flex justify="space-between" align="center" gap={16} wrap style={{ marginBottom: 16 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Befehle</Typography.Title>
          {/*
            Zählt den BESTAND, während die Gruppenköpfe das ANGEZEIGTE zählen — bei aktiver
            Suche laufen die Zahlen deshalb auseinander. Gewollt: die Kopfzeile ist die
            Lageauskunft, der Gruppenkopf die Auskunft über die Trefferliste.
          */}
          <Typography.Text type="secondary">
            {befehle.length} Befehle · {entwuerfe} im Entwurf
          </Typography.Text>
        </div>
        {darfSchreiben && (
          // Kein `size`-Prop: Träger der Dichte ist das Dichte-Token am `ConfigProvider`.
          //
          // `aria-label` ist hier PFLICHT und keine Doppelung: antds Icon rendert
          // `<span role="img" aria-label="plus">`, und dessen Etikett fließt in den
          // berechneten Namen des Knopfes ein — ohne diese Zeile heißt er für
          // Screenreader und `getByRole` „plus Befehl erteilen" (gemessen).
          <Button
            type="primary"
            icon={<PlusOutlined />}
            aria-label="Befehl erteilen"
            onClick={() => setAnlegenOffen(true)}
          >
            Befehl erteilen
          </Button>
        )}
      </Flex>

      <Datensicht
        bezeichnung="Befehle"
        form="karte"
        spalten={befehlSpalten}
        daten={befehle}
        zeilenSchluessel="id"
        ladend={befehleQuery.isLoading}
        leerText="Noch keine Befehle"
        suche={{ platzhalter: 'Titel oder Schema' }}
        standardSortierung={{ spalte: 'fassung', richtung: 'ab' }}
        gruppen={{
          schluessel: (b) => b.status,
          etikett: (w) => (w === 'entwurf' ? 'Entwürfe' : 'Freigegeben'),
          reihenfolge: ['entwurf', 'freigegeben'],
        }}
        karte={{
          art: 'plan',
          titel: { spalte: 'titel', ziel: (b) => befehlDetailPfad(einsatzId, b.id) },
          // Keine `aktion`: Freigeben/Fortschreiben/Drucken liegen auf der Detailseite,
          // die einzige Interaktion der Zeile ist der Titel-Link.
          sekundaer: ['status', 'schema', 'fassung'],
        }}
      />

      <Modal
        open={anlegenOffen}
        title="Neuen Befehl anlegen"
        okText="Anlegen"
        confirmLoading={anlegenMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAnlegenOffen(false)}
        destroyOnHidden
      >
        <Form<NeuerBefehl> form={form} layout="vertical" initialValues={{ vorlage: 'befehl_lad' }} onFinish={(w) => anlegenMutation.mutate(w)}>
          <Form.Item label="Schema" name="vorlage" rules={[{ required: true }]}>
            <Select options={VORLAGEN.map((v) => ({ value: v.schluessel, label: v.label }))} />
          </Form.Item>
          <Form.Item label="Titel" name="titel" rules={[{ required: true, message: 'Titel erforderlich' }]}>
            <Input placeholder="z. B. Befehl an 2. Zug 10:30" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
