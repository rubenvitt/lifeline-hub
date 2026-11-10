import { useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Spin, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconKreuz, IconPlus } from '../../icons';
import AdminPage from '../../components/AdminPage';
import { Paneel, monoStil, useRollen } from '../../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../../components/Liste';
import type { WeitereAktionen } from '../../components/Datensicht';
import { ZeilenMenueAusloeser } from '../../components/ZeilenMenueAusloeser';
import { useZeilenMenueKontext } from '../../components/useDatensatzKontextMenue';
import KopierbarerText from '../../components/KopierbarerText';
import { ErfassungsModal } from '../../components/Erfassung';
import { SeitenHinweise, SpeicherFehler } from '../../components/SpeicherHinweis';
import { NUR_ADMIN } from '../../components/nurAnsicht';
import { useAuth } from '../../auth/AuthContext';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import {
  ladeLagemonitorZugaenge,
  lagemonitorAdresse,
  legeLagemonitorZugangAn,
  widerrufeLagemonitorZugang,
} from '../../api/lagemonitorZugaenge';
import { LAGEMONITOR_BEZEICHNUNG_MAX } from '../../api/eingabegrenzen';
import { globalKeys } from '../../api/queryKeys';
import type { LesezugangAnzeige, LesezugangMitSchluessel } from '../../api/types';

interface AnlegenWerte {
  bezeichnung?: string;
}

/** Zustandszeile eines Zugangs, rein und exportiert für den Test. */
export function zugangZustand(z: LesezugangAnzeige, zeit: (wert: string) => string): string {
  const teile: (string | null)[] = z.widerrufen_at
    ? [`widerrufen ${zeit(z.widerrufen_at)}`]
    : [z.einsatz_bezeichnung ? `zeigt ${z.einsatz_bezeichnung}` : 'kein Einsatz freigegeben'];
  teile.push(z.zuletzt_genutzt_at ? `zuletzt ${zeit(z.zuletzt_genutzt_at)}` : 'noch nie abgerufen');
  teile.push(z.angelegt_von_name ? `angelegt von ${z.angelegt_von_name}` : null);
  return teile.filter(Boolean).join(' · ');
}

/**
 * Admin-Sektion `/admin/einstellungen/lagemonitore` — Lesezugänge externer Lagemonitore
 * (LLH-1484). Anlegen und Widerrufen nur der System-Admin; den Einsatz gibt die Einsatzleitung auf
 * der Seite „Geräte“ ihres Einsatzes frei.
 *
 * Der Schlüssel steht genau einmal im Dialog nach dem Anlegen; der Server speichert nur seinen
 * Hash. Ein verlorener Schlüssel heißt: widerrufen und neu anlegen.
 */
export default function LagemonitorZugaenge() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [neu, setNeu] = useState<LesezugangMitSchluessel | null>(null);
  const [widerrufFuer, setWiderrufFuer] = useState<LesezugangAnzeige | null>(null);
  const [form] = Form.useForm<AnlegenWerte>();

  const zugaengeQ = useQuery({
    queryKey: globalKeys.lagemonitorZugaenge(),
    queryFn: ladeLagemonitorZugaenge,
  });

  const uebernimm = (z: LesezugangAnzeige) =>
    qc.setQueryData<LesezugangAnzeige[]>(globalKeys.lagemonitorZugaenge(), (alt) =>
      alt
        ? alt.some((x) => x.id === z.id)
          ? alt.map((x) => (x.id === z.id ? z : x))
          : [...alt, z]
        : [z],
    );

  const anlegen = useMutation({
    mutationFn: (bezeichnung: string) => legeLagemonitorZugangAn(bezeichnung),
    onSuccess: (antwort) => {
      uebernimm(antwort.zugang);
      setNeu(antwort);
    },
  });
  const widerrufen = useMutation({
    mutationFn: (z: LesezugangAnzeige) => widerrufeLagemonitorZugang(z.id),
    onSuccess: (z) => {
      uebernimm(z);
      setWiderrufFuer(null);
      message.success(`${z.bezeichnung} widerrufen`);
    },
  });

  const zugaenge = zugaengeQ.data ?? [];
  /**
   * Aktionen eines Zugangs, EINE Quelle für ⋮ und Kontextmenü (LLH-1599, design.md D3). Widerrufene
   * Zugänge tragen keine Aktion.
   */
  const zugangMenue: WeitereAktionen<LesezugangAnzeige> | undefined = istAdmin
    ? {
        eintraege: (z) =>
          z.widerrufen_at
            ? []
            : [{ key: 'widerrufen', icon: <IconKreuz />, label: 'Widerrufen …', gefahr: true }],
        zugaenglicherName: (z) => `Aktionen zu Lagemonitor ${z.bezeichnung}`,
        laeuft: () => widerrufen.isPending,
        onWahl: (_key, z) => {
          widerrufen.reset();
          setWiderrufFuer(z);
        },
      }
    : undefined;
  const kontext = useZeilenMenueKontext(zugangMenue, {
    finde: (id) => zugaenge.find((z) => z.id === id),
    schluessel: (z) => z.id,
  });
  const zeit = (wert: string) => zeitKurz(wert, konv);

  return (
    <AdminPage
      titel="Lagemonitore"
      breite="schmal"
      aktionen={
        istAdmin && (
          <Button type="primary" icon={<IconPlus />} onClick={() => setAnlegenOffen(true)}>
            Zugang anlegen
          </Button>
        )
      }
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={NUR_ADMIN} />}
    >
      <Paneel
        titel="Lesezugänge"
        meta={zugaengeQ.isSuccess ? zugaenge.length : undefined}
        koerperPolster
      >
        {zugaengeQ.isLoading ? (
          <Spin />
        ) : zugaengeQ.isError ? (
          <Alert type="error" title="Lagemonitore nicht ladbar" showIcon />
        ) : (
          <Liste<LesezugangAnzeige>
            bordered
            dataSource={zugaenge}
            rowKey={(z) => z.id}
            emptyText="Noch kein Lagemonitor"
            renderItem={(z) => (
              // Hülle für das Kontextmenü: `ListenEintrag` nimmt keine Ereignis-Props (LLH-1599 D3).
              <div data-lfh="lagemonitor-eintrag" {...(zugangMenue ? kontext.ausloeser(z) : {})}>
                <ListenEintrag
                  actions={
                    zugangMenue && !z.widerrufen_at
                      ? [<ZeilenMenueAusloeser key="aktionen" menue={zugangMenue} zeile={z} />]
                      : undefined
                  }
                >
                  <ListenEintragMeta
                    title={<span data-lfh="lagemonitor-titel">{z.bezeichnung}</span>}
                    description={
                      <span style={{ color: rollen.gedaempft }} data-lfh="lagemonitor-zustand">
                        {zugangZustand(z, zeit)}
                      </span>
                    }
                  />
                </ListenEintrag>
              </div>
            )}
          />
        )}
        {kontext.menue}
      </Paneel>

      <ErfassungsModal<AnlegenWerte>
        offen={anlegenOffen}
        titel="Lagemonitor anlegen"
        form={form}
        erfassenText="Anlegen"
        laeuft={anlegen.isPending}
        onErfassen={(w) => anlegen.mutateAsync((w.bezeichnung ?? '').trim())}
        onFertig={() => setAnlegenOffen(false)}
        onAbbrechen={() => {
          anlegen.reset();
          setAnlegenOffen(false);
        }}
      >
        <Form.Item
          label="Bezeichnung"
          name="bezeichnung"
          rules={[
            { required: true, whitespace: true, message: 'Bezeichnung angeben' },
            {
              max: LAGEMONITOR_BEZEICHNUNG_MAX,
              message: `Höchstens ${LAGEMONITOR_BEZEICHNUNG_MAX} Zeichen`,
            },
          ]}
        >
          <Input placeholder="FüKW Monitor" maxLength={LAGEMONITOR_BEZEICHNUNG_MAX} />
        </Form.Item>
        <SpeicherFehler fehler={anlegen.error} titel="Nicht angelegt" />
      </ErfassungsModal>

      <Modal
        open={widerrufFuer != null}
        title={widerrufFuer ? `${widerrufFuer.bezeichnung} widerrufen?` : 'Widerrufen?'}
        okText="Widerrufen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: widerrufen.isPending }}
        onOk={() => widerrufFuer && widerrufen.mutate(widerrufFuer)}
        onCancel={() => setWiderrufFuer(null)}
        destroyOnHidden
      >
        <p>
          Der Schlüssel gilt sofort nicht mehr; ein freigegebener Einsatz wird dort nicht mehr
          gezeigt.
        </p>
        <SpeicherFehler fehler={widerrufen.error} titel="Nicht widerrufen" />
      </Modal>

      <Modal
        open={neu != null}
        title={neu ? `Schlüssel für ${neu.zugang.bezeichnung}` : 'Schlüssel'}
        footer={
          <Button type="primary" onClick={() => setNeu(null)}>
            Fertig
          </Button>
        }
        onCancel={() => setNeu(null)}
        destroyOnHidden
      >
        {neu && (
          <div data-lfh="lagemonitor-schluessel">
            <p>Nur jetzt sichtbar.</p>
            <div style={{ marginBlockEnd: token.marginSM }}>
              <KopierbarerText text={neu.schluessel} bezeichnung="Schlüssel">
                <span
                  data-lfh="lagemonitor-schluessel-text"
                  style={{ ...monoStil(14, 500), wordBreak: 'break-all' }}
                >
                  {neu.schluessel}
                </span>
              </KopierbarerText>
            </div>
            <KopierbarerText
              text={lagemonitorAdresse(window.location.origin)}
              bezeichnung="Adresse"
            >
              <Typography.Text style={{ color: rollen.gedaempft, wordBreak: 'break-all' }}>
                {lagemonitorAdresse(window.location.origin)}
              </Typography.Text>
            </KopierbarerText>
          </div>
        )}
      </Modal>
    </AdminPage>
  );
}
