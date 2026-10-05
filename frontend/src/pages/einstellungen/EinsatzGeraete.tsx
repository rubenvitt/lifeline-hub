import { useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import type { Dayjs } from 'dayjs';
import { QRCodeSVG } from 'qrcode.react';
import { IconKreuz, IconPlus, IconSchluessel, IconUhr } from '../../icons';
import { Formularpaneel, monoStil, useRollen } from '../../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../../components/Liste';
import { MenueAusloeser } from '../../components/MenueAusloeser';
import { Select } from '../../components/Select';
import KopierbarerText from '../../components/KopierbarerText';
import { ErfassungsModal } from '../../components/Erfassung';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise, SpeicherFehler } from '../../components/SpeicherHinweis';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { ZeitpunktEingabe } from '../../anzeige/ZeitpunktEingabe';
import { alsBackendZeit } from '../../anzeige/zeitEingabe';
import { formatUhrzeitMitTag } from '../../anzeige/format';
import {
  ladeGeraete,
  legeKopplungAn,
  stelleCodeAus,
  verlaengereKopplung,
  widerrufeKopplung,
  type NeueKopplung,
} from '../../api/geraete';
import { listeUhs } from '../../api/einsatzUhs';
import { einsatzKeys } from '../../api/queryKeys';
import type {
  Funktionsansicht,
  GeraeteUebersicht,
  KopplungAnzeige,
  KopplungMitCode,
} from '../../api/types';
import { istEinsatzLeitung } from '../../einsatz/schreibrecht';
import { modulRegistry } from '../../einsatz/modulRegistry';
import { koppelnAdresse } from '../../routing/deeplinks';
import { useEinstellungenDaten } from '../EinsatzEinstellungenPage';
import {
  ANSICHT_LABEL,
  ANSICHT_ZWECK,
  STATUS_WORT,
  codeGruppiert,
  endeFehler,
  istBeendet,
  istStellengebunden,
  sperrSatz,
  verlaengernVorbelegung,
} from './geraeteKern';

const RECHTE_TEXT =
  'Geräte koppelt nur die Einsatzleitung. Ein gekoppeltes Gerät arbeitet ohne Personenkonto in diesem Einsatz.';

const ZEITFORMAT = 'YYYY-MM-DD HH:mm';

interface AnlegenWerte {
  ansicht?: Funktionsansicht;
  uhs_id?: number;
  bezeichnung?: string;
}

interface VerlaengernWerte {
  ende: Dayjs | null;
}

function modulName(key: string): string {
  return modulRegistry.find((m) => m.key === key)?.label ?? key;
}

/**
 * Sektion `…/einstellungen/geraete` — Gerätekopplung (LFH-892, Spec `geraete-kopplung`).
 *
 * Die Einsatzleitung koppelt hier UHS-Tablet, UHS-Laptop oder Lagemonitor an diesen Einsatz.
 * Das Anlegen gibt einen Code aus, der 10 Minuten gilt und genau einmal einlösbar ist; er steht
 * einmal als Text und als QR im Dialog und ist danach nicht mehr abrufbar (der Server speichert
 * nur seinen Hash). Für einen weiteren Versuch stellt „Neuen Code ausstellen" einen frischen aus.
 *
 * Speicherweg sofort, wie die Pegel: jede Handlung ist ein eigener Aufruf, kein Entwurf. Widerruf
 * ist unumkehrbar und fragt deshalb zurück (LFH-363); Verlängern und Neu-Ausstellen nicht.
 *
 * Rechte: der Server lässt nur die Einsatzleitung zu (`EinsatzLeitungszugriff`), auch keinen
 * System-Admin ohne Mitgliedschaft. Ohne sie lädt die Sektion nichts und erklärt das.
 */
export default function EinsatzGeraete() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const daten = useEinstellungenDaten(einsatzId);
  const leitung = istEinsatzLeitung(daten.einsatz);
  const darf = leitung && daten.istAktiv;

  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [anzeigeCode, setAnzeigeCode] = useState<KopplungMitCode | null>(null);
  const [verlaengernFuer, setVerlaengernFuer] = useState<KopplungAnzeige | null>(null);
  const [widerrufFuer, setWiderrufFuer] = useState<KopplungAnzeige | null>(null);
  const [anlegenForm] = Form.useForm<AnlegenWerte>();
  const [verlaengernForm] = Form.useForm<VerlaengernWerte>();
  const gewaehlteAnsicht = Form.useWatch('ansicht', anlegenForm);

  const geraeteQ = useQuery({
    queryKey: einsatzKeys.geraete(einsatzId),
    queryFn: () => ladeGeraete(einsatzId),
    enabled: leitung,
  });
  const uhsQ = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
    enabled: darf,
  });

  /** Übernimmt eine geänderte Kopplung in die geladene Übersicht. */
  const uebernimm = (k: KopplungAnzeige) =>
    qc.setQueryData<GeraeteUebersicht>(einsatzKeys.geraete(einsatzId), (alt) =>
      alt
        ? {
            ...alt,
            kopplungen: alt.kopplungen.some((x) => x.id === k.id)
              ? alt.kopplungen.map((x) => (x.id === k.id ? k : x))
              : [...alt.kopplungen, k],
          }
        : alt,
    );

  const anlegen = useMutation({
    mutationFn: (werte: NeueKopplung) => legeKopplungAn(einsatzId, werte),
    onSuccess: (antwort) => {
      uebernimm(antwort.kopplung);
      setAnzeigeCode(antwort);
    },
  });
  const neuerCode = useMutation({
    mutationFn: (k: KopplungAnzeige) => stelleCodeAus(einsatzId, k.id),
    onSuccess: (antwort) => {
      uebernimm(antwort.kopplung);
      setAnzeigeCode(antwort);
    },
  });
  const verlaengern = useMutation({
    mutationFn: (v: { k: KopplungAnzeige; ende: Dayjs }) =>
      verlaengereKopplung(einsatzId, v.k.id, alsBackendZeit(v.ende)),
    onSuccess: (k) => {
      uebernimm(k);
      message.success(`${k.anzeigename} verlängert`);
    },
  });
  const widerrufen = useMutation({
    mutationFn: (k: KopplungAnzeige) => widerrufeKopplung(einsatzId, k.id),
    onSuccess: (k) => {
      uebernimm(k);
      setWiderrufFuer(null);
      message.success(`${k.anzeigename} widerrufen`);
    },
  });

  if (daten.laedt || (leitung && geraeteQ.isLoading)) return <SeitenSkeleton />;
  if (!leitung) {
    return <SeitenHinweise rechteFehlt rechteText={RECHTE_TEXT} />;
  }
  if (geraeteQ.isError || !geraeteQ.data) {
    return (
      <SeitenFehler
        text="Geräte nicht ladbar"
        ursache={geraeteQ.error}
        onWiederholen={() => void geraeteQ.refetch()}
      />
    );
  }

  const { kopplungen, sperren } = geraeteQ.data;
  const laeuft = neuerCode.isPending || verlaengern.isPending || widerrufen.isPending;
  // Wie der Server: eine stornierte oder aufgelöste UHS nimmt keine Kopplung (422).
  const uhsAuswahl = (uhsQ.data ?? []).filter((u) => u.status !== 'aufgeloest' && !u.storniert_at);
  const sperre = sperrSatz(sperren, gewaehlteAnsicht, modulName);

  return (
    <>
      <SeitenHinweise fehler={neuerCode.error ?? verlaengern.error} />
      <Formularpaneel
        titel="Gekoppelte Geräte"
        beschreibung="Ein gekoppeltes Gerät arbeitet ohne Personenkonto, nur in diesem Einsatz und nur in seiner Ansicht. Ein Widerruf wirkt sofort."
        dataUpdatedAt={geraeteQ.dataUpdatedAt}
        aktion={
          darf && (
            <Button type="primary" icon={<IconPlus />} onClick={() => setAnlegenOffen(true)}>
              Gerät koppeln
            </Button>
          )
        }
      >
        <Liste<KopplungAnzeige>
          // Ohne `unterEbene`: eine Einstellungsliste, keine eigenständigen Gegenstände (LFH-826).
          bordered
          dataSource={kopplungen}
          rowKey={(k) => k.id}
          emptyText="Noch kein Gerät gekoppelt."
          renderItem={(k) => (
            <ListenEintrag
              actions={
                darf && !istBeendet(k)
                  ? [
                      <MenueAusloeser
                        key="aktionen"
                        gesperrt={laeuft}
                        laeuft={laeuft}
                        zugaenglicherName={`Aktionen zu Gerät ${k.anzeigename}`}
                        eintraege={[
                          {
                            key: 'code',
                            icon: <IconSchluessel />,
                            label: 'Neuen Code ausstellen',
                          },
                          { key: 'verlaengern', icon: <IconUhr />, label: 'Verlängern …' },
                          {
                            key: 'widerrufen',
                            icon: <IconKreuz />,
                            label: 'Widerrufen …',
                            gefahr: true,
                          },
                        ]}
                        onWahl={(key) => {
                          if (key === 'code') neuerCode.mutate(k);
                          else if (key === 'verlaengern') {
                            verlaengern.reset();
                            setVerlaengernFuer(k);
                          } else if (key === 'widerrufen') {
                            widerrufen.reset();
                            setWiderrufFuer(k);
                          }
                        }}
                      />,
                    ]
                  : undefined
              }
            >
              <ListenEintragMeta
                title={<span data-lfh="geraet-titel">{k.anzeigename}</span>}
                description={
                  <span style={{ color: rollen.gedaempft }} data-lfh="geraet-zustand">
                    {[
                      ANSICHT_LABEL[k.ansicht],
                      STATUS_WORT[k.status],
                      k.status === 'widerrufen'
                        ? `von ${k.widerrufen_von_name ?? '—'} um ${formatUhrzeitMitTag(k.widerrufen_at, konv)}`
                        : `bis ${formatUhrzeitMitTag(k.laeuft_ab_at, konv)}`,
                      k.letzter_zugriff_at
                        ? `zuletzt ${formatUhrzeitMitTag(k.letzter_zugriff_at, konv)}`
                        : null,
                      `angelegt von ${k.erstellt_von_name}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                }
              />
            </ListenEintrag>
          )}
        />
      </Formularpaneel>

      <ErfassungsModal<AnlegenWerte>
        offen={anlegenOffen}
        titel="Gerät koppeln"
        form={anlegenForm}
        erfassenText="Koppeln"
        laeuft={anlegen.isPending}
        onErfassen={(w) =>
          anlegen.mutateAsync({
            ansicht: w.ansicht as Funktionsansicht,
            uhs_id: w.ansicht && istStellengebunden(w.ansicht) ? (w.uhs_id ?? null) : null,
            bezeichnung: (w.bezeichnung ?? '').trim(),
          })
        }
        onFertig={() => setAnlegenOffen(false)}
        onAbbrechen={() => {
          anlegen.reset();
          setAnlegenOffen(false);
        }}
      >
        <Form.Item
          label="Ansicht"
          name="ansicht"
          rules={[{ required: true, message: 'Ansicht wählen' }]}
          extra={gewaehlteAnsicht ? ANSICHT_ZWECK[gewaehlteAnsicht] : undefined}
        >
          <Select<Funktionsansicht>
            placeholder="Ansicht wählen"
            options={(Object.keys(ANSICHT_LABEL) as Funktionsansicht[]).map((a) => ({
              value: a,
              label: ANSICHT_LABEL[a],
            }))}
          />
        </Form.Item>
        {gewaehlteAnsicht && istStellengebunden(gewaehlteAnsicht) && (
          <Form.Item
            label="Unfallhilfsstelle"
            name="uhs_id"
            rules={[{ required: true, message: 'UHS wählen' }]}
          >
            <Select<number>
              placeholder="UHS wählen"
              loading={uhsQ.isLoading}
              options={uhsAuswahl.map((u) => ({ value: u.id, label: u.bezeichnung }))}
              notFoundContent="Keine UHS in diesem Einsatz"
            />
          </Form.Item>
        )}
        <Form.Item
          label="Gerätebezeichnung"
          name="bezeichnung"
          rules={[
            { required: true, whitespace: true, message: 'Bezeichnung angeben' },
            { max: 60, message: 'Höchstens 60 Zeichen' },
          ]}
          extra="Steht an jedem Eintrag des Geräts, etwa „Tablet 1“."
        >
          <Input placeholder="Tablet 1" maxLength={60} />
        </Form.Item>
        {sperre && (
          <Alert
            type="warning"
            showIcon
            data-lfh="geraet-sperre"
            title={sperre}
            style={{ marginBlockEnd: token.margin }}
          />
        )}
        <Typography.Paragraph style={{ color: rollen.gedaempft }}>
          Die Kopplung gilt 24 Stunden und lässt sich danach verlängern. Mit dem Abschluss des
          Einsatzes endet sie.
        </Typography.Paragraph>
        <SpeicherFehler fehler={anlegen.error} titel="Nicht gekoppelt" />
      </ErfassungsModal>

      <ErfassungsModal<VerlaengernWerte>
        offen={verlaengernFuer != null}
        titel={verlaengernFuer ? `Verlängern — ${verlaengernFuer.anzeigename}` : 'Verlängern'}
        form={verlaengernForm}
        initialValues={{ ende: verlaengernVorbelegung() }}
        erfassenText="Verlängern"
        laeuft={verlaengern.isPending}
        onErfassen={(w) => {
          const k = verlaengernFuer;
          if (!k || !w.ende) return Promise.reject(new Error('Ende angeben'));
          return verlaengern.mutateAsync({ k, ende: w.ende });
        }}
        onFertig={() => setVerlaengernFuer(null)}
        onAbbrechen={() => setVerlaengernFuer(null)}
      >
        <Form.Item
          label="Neues Ende"
          name="ende"
          rules={[
            {
              validator: (_, wert: Dayjs | null) => {
                const fehler = endeFehler(wert);
                return fehler ? Promise.reject(new Error(fehler)) : Promise.resolve();
              },
            },
          ]}
          extra="Höchstens 72 Stunden ab jetzt."
        >
          <ZeitpunktEingabe format={ZEITFORMAT} style={{ width: '100%' }} />
        </Form.Item>
        <SpeicherFehler fehler={verlaengern.error} titel="Nicht verlängert" />
      </ErfassungsModal>

      <Modal
        open={widerrufFuer != null}
        title={widerrufFuer ? `${widerrufFuer.anzeigename} widerrufen?` : 'Widerrufen?'}
        okText="Widerrufen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: widerrufen.isPending }}
        onOk={() => widerrufFuer && widerrufen.mutate(widerrufFuer)}
        onCancel={() => setWiderrufFuer(null)}
        destroyOnHidden
      >
        <p>
          Das Gerät verliert sofort jeden Zugriff und zeigt „Kopplung beendet“. Was es geschrieben
          hat, bleibt stehen. Für eine neue Kopplung legst du das Gerät neu an.
        </p>
        <SpeicherFehler fehler={widerrufen.error} titel="Nicht widerrufen" />
      </Modal>

      <Modal
        open={anzeigeCode != null}
        title={anzeigeCode ? `Code für ${anzeigeCode.kopplung.anzeigename}` : 'Code'}
        footer={
          <Button type="primary" onClick={() => setAnzeigeCode(null)}>
            Fertig
          </Button>
        }
        onCancel={() => setAnzeigeCode(null)}
        destroyOnHidden
      >
        {anzeigeCode && (
          <div data-lfh="kopplungscode">
            <p>
              Am Gerät die Adresse unten öffnen oder den QR-Code scannen. Der Code gilt bis{' '}
              {formatUhrzeitMitTag(anzeigeCode.code.laeuft_ab_at, konv)} und genau einmal. Er lässt
              sich hier nicht noch einmal anzeigen.
            </p>
            <div
              style={{
                // Wie im Profil: Grund und Ruhezone trägt das SVG selbst, die Hülle nur die Rolle.
                background: rollen.flaeche,
                width: 'fit-content',
                marginBlockEnd: token.marginSM,
              }}
            >
              <QRCodeSVG
                value={koppelnAdresse(window.location.origin, anzeigeCode.code.code)}
                size={200}
                marginSize={4}
              />
            </div>
            <div style={{ marginBlockEnd: token.marginSM }}>
              <KopierbarerText text={anzeigeCode.code.code} bezeichnung="Kopplungscode">
                <span
                  data-lfh="kopplungscode-text"
                  style={{ ...monoStil(24, 500), letterSpacing: '0.1em' }}
                >
                  {codeGruppiert(anzeigeCode.code.code)}
                </span>
              </KopierbarerText>
            </div>
            <Typography.Text style={{ color: rollen.gedaempft }}>
              {koppelnAdresse(window.location.origin, '').replace(/#$/, '')}
            </Typography.Text>
          </div>
        )}
      </Modal>
    </>
  );
}
