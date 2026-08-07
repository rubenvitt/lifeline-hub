import { App, Breadcrumb, Button, Flex, Form, Input, Modal, Spin, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Select } from '../components/Select';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lageberichtDetailPfad } from '../routing/deeplinks';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { legeLageberichtAn, listeLageberichte, type NeuerLagebericht } from '../api/lageberichte';
import type { LageberichtAnzeige, LageberichtVorlageKey } from '../api/types';
import { VORLAGEN } from '../lageberichte/vorlagen';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import { LAGEBERICHT_STATUS, StatusBadge } from '../kommunikation';
import Datenstand from '../components/Datenstand';

/**
 * Lageberichte als Kartensicht (LFH-330 · B2, Bündel III) — der Zwilling der Befehlsliste.
 *
 * `form="karte"` in JEDER Breite: ein Lagebericht wird als EINHEIT gelesen (Vorlage,
 * Fassung, Freigabestand), nicht spaltenweise verglichen. Beide Flächen werden gemeinsam
 * umgestellt, weil sie bis auf die Fachbegriffe gleich gebaut sind — nur eine von beiden
 * umzustellen erzeugte eine Divergenz zwischen zwei nahezu identischen Seiten.
 *
 * Die v-Nummer trägt dieselbe Last wie beim Befehl: die Fortschreibung legt eine NEUE Zeile
 * mit `version + 1` und demselben Titel an, der Vorgänger bleibt freigegeben liegen. Zwei
 * Zeilen der Liste können sich also allein in der Fassung unterscheiden.
 */

function vorlageLabel(schluessel: LageberichtVorlageKey | string): string {
  return VORLAGEN.find((v) => v.schluessel === schluessel)?.label ?? String(schluessel);
}

/**
 * Modulkonstante, IN dieser Datei: der Guard verlangt die Marke `spaltenFuer` je
 * Konsumentendatei. Nie annotieren — eine Typangabe weitete `K` auf `string`, und der
 * Kartenplan nähme danach jeden Slot-Tippfehler stillschweigend an.
 */
const lageberichtSpalten = spaltenFuer<LageberichtAnzeige>()([
  {
    key: 'titel',
    title: 'Titel',
    immerSichtbar: true,
    sortWert: (lb) => lb.titel,
    suchText: (lb) => lb.titel,
    // KEIN Anker hier: den Link setzt `karte.titel.ziel`, sonst verschachtelte Links.
    render: (_t, lb) => lb.titel,
  },
  {
    key: 'status',
    title: 'Status',
    // Sekundärslot statt `karte.status`: das Modul bleibt auf der Phasenachse aus
    // `kommunikation/phase.ts`, die bewusst außerhalb des A2-Statusfarb-Vertrags liegt.
    render: (_t, lb) => (
      <StatusBadge
        phase={LAGEBERICHT_STATUS[lb.status].phase}
        label={LAGEBERICHT_STATUS[lb.status].label}
      />
    ),
  },
  {
    key: 'vorlage',
    // Bezeichnung „Vorlage" beibehalten — beim Lagebericht heißt die Achse so, beim Befehl
    // „Schema". Eine Umbenennung wäre eine fachliche Änderung ohne Anlass.
    title: 'Vorlage',
    suchText: (lb) => vorlageLabel(lb.vorlage),
    filter: {
      werte: VORLAGEN.map((v) => ({ text: v.label, value: v.schluessel })),
      trifft: (lb, w) => lb.vorlage === w,
    },
    render: (_t, lb) => vorlageLabel(lb.vorlage),
  },
  {
    key: 'fassung',
    title: 'Fassung',
    sortWert: (lb) => lb.zeitstand,
    // v-Nummer, Zeitstand und Ersteller in EINER Zeile — drei Slots sind das Maximum.
    // `zeitstand` bleibt der rohe Wirestring, wie auf der Detailseite: nur hier zu
    // formatieren zeigte für dasselbe Feld zwei verschiedene Uhrzeiten (lokal vs. UTC).
    render: (_t, lb) => `v${lb.version} · ${lb.zeitstand} · ${lb.ersteller_name}`,
  },
]);

export default function LageberichtePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [form] = Form.useForm<NeuerLagebericht>();


  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const berichteQuery = useQuery({
    queryKey: einsatzKeys.lageberichte(einsatzId),
    queryFn: () => listeLageberichte(einsatzId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: einsatzKeys.lageberichte(einsatzId) });
  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: (daten: NeuerLagebericht) => legeLageberichtAn(einsatzId, daten),
    onSuccess: () => {
      invalidate();
      setAnlegenOffen(false);
      form.resetFields();
    },
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Typography.Text type="danger">Einsatz nicht gefunden oder kein Zugriff.</Typography.Text>;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const berichte = berichteQuery.data ?? [];
  const entwuerfe = berichte.filter((lb) => lb.status === 'entwurf').length;

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Lageberichte' },
        ]}
      />
      <Flex justify="space-between" align="center" gap={16} wrap style={{ marginBottom: 16 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Lageberichte
          </Typography.Title>
          {/*
            Zählt den BESTAND, während die Gruppenköpfe das ANGEZEIGTE zählen — bei aktiver
            Suche laufen die Zahlen deshalb auseinander. Gewollt: die Kopfzeile ist die
            Lageauskunft, der Gruppenkopf die Auskunft über die Trefferliste.
          */}
          <Typography.Text type="secondary">
            {berichte.length} Berichte · {entwuerfe} im Entwurf
          </Typography.Text>
          <div><Datenstand dataUpdatedAt={berichteQuery.dataUpdatedAt} /></div>
        </div>
        {darfSchreiben && (
          // Kein `size`-Prop: Träger der Dichte ist das Dichte-Token am `ConfigProvider`.
          // `aria-label` gegen antds Icon-Etikett: `<span role="img" aria-label="plus">`
          // fließt sonst in den berechneten Namen ein („plus Neuer Bericht", gemessen).
          <Button
            type="primary"
            icon={<PlusOutlined />}
            aria-label="Neuer Bericht"
            onClick={() => setAnlegenOffen(true)}
          >
            Neuer Bericht
          </Button>
        )}
      </Flex>

      <Datensicht
        bezeichnung="Lageberichte"
        form="karte"
        spalten={lageberichtSpalten}
        daten={berichte}
        zeilenSchluessel="id"
        ladend={berichteQuery.isLoading}
        leerText="Noch keine Lageberichte"
        suche={{ platzhalter: 'Titel oder Vorlage' }}
        standardSortierung={{ spalte: 'fassung', richtung: 'ab' }}
        gruppen={{
          schluessel: (lb) => lb.status,
          etikett: (w) => (w === 'entwurf' ? 'Entwürfe' : 'Freigegeben'),
          reihenfolge: ['entwurf', 'freigegeben'],
        }}
        karte={{
          art: 'plan',
          titel: { spalte: 'titel', ziel: (lb) => lageberichtDetailPfad(einsatzId, lb.id) },
          // Keine `aktion`: Freigeben/Fortschreiben/Drucken liegen auf der Detailseite,
          // die einzige Interaktion der Zeile ist der Titel-Link.
          sekundaer: ['status', 'vorlage', 'fassung'],
        }}
      />

      <Modal
        open={anlegenOffen}
        title="Neuer Lagebericht"
        okText="Anlegen"
        confirmLoading={anlegenMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAnlegenOffen(false)}
        destroyOnHidden
      >
        <Form<NeuerLagebericht>
          form={form}
          layout="vertical"
          initialValues={{ vorlage: 'lagebericht' }}
          onFinish={(w) => anlegenMutation.mutate(w)}
        >
          <Form.Item label="Vorlage" name="vorlage" rules={[{ required: true }]}>
            <Select options={VORLAGEN.map((v) => ({ value: v.schluessel, label: v.label }))} />
          </Form.Item>
          <Form.Item label="Titel" name="titel" rules={[{ required: true, message: 'Titel erforderlich' }]}>
            <Input placeholder="z. B. Lageüberblick 10:30 Uhr" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
