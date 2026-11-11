import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { IconPlus } from '../../icons';
import { Formularpaneel, monoStil, useRollen } from '../../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../../components/Liste';
import { Select } from '../../components/Select';
import KopierbarerText from '../../components/KopierbarerText';
import { ErfassungsModal } from '../../components/Erfassung';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import { LAGEBILD_EMPFAENGER_MAX } from '../../api/eingabegrenzen';
import {
  ladeLagebildFreigaben,
  legeLagebildFreigabeAn,
  widerrufeLagebildFreigabe,
} from '../../api/lagebildExtern';
import { einsatzKeys } from '../../api/queryKeys';
import type {
  LagebildDauer,
  LagebildFreigabeAnzeige,
  LagebildFreigabeMitSchluessel,
  LagebildStufe,
} from '../../api/types';
import { lagebildExternAdresse } from '../../routing/deeplinks';

export const STUFE_LABEL: Record<LagebildStufe, string> = {
  lagebild: 'Lagebild',
  oeffentlich: 'Öffentlich',
};

/** Inhalt je Stufe (design.md D4), als Zusatz am Feld. */
const STUFE_INHALT: Record<LagebildStufe, string> = {
  lagebild: 'Zahlen, Unfallhilfsstellen, Karte, Lagemeldung',
  oeffentlich: 'Gesamtzahlen, Einsatzort, Absperrungen',
};

export const DAUER_LABEL: Record<LagebildDauer, string> = {
  '2h': '2 Stunden',
  '12h': '12 Stunden',
  '24h': '24 Stunden',
  einsatzende: 'Bis Einsatzende',
};

/** Höchstens so viele Öffnungen stehen am Eintrag; die jüngsten zuerst. */
const PROTOKOLL_SICHTBAR = 3;

interface AnlegenWerte {
  empfaenger: string;
  stufe: LagebildStufe;
  dauer: LagebildDauer;
}

/** Zustandszeile eines Links, rein und exportiert für den Test. */
export function freigabeZeile(f: LagebildFreigabeAnzeige, zeit: (wert: string) => string): string {
  const gueltigkeit = f.widerrufen_at
    ? `widerrufen von ${f.widerrufen_von_name ?? '—'} um ${zeit(f.widerrufen_at)}`
    : !f.gueltig
      ? 'abgelaufen'
      : f.gueltig_bis
        ? `gültig bis ${zeit(f.gueltig_bis)}`
        : 'bis Einsatzende';
  return [
    STUFE_LABEL[f.stufe],
    gueltigkeit,
    f.oeffnungen === 1 ? '1 Öffnung' : `${f.oeffnungen} Öffnungen`,
    f.zuletzt_abgerufen_at ? `zuletzt ${zeit(f.zuletzt_abgerufen_at)}` : null,
    f.angelegt_von_name ? `von ${f.angelegt_von_name}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Lagebild für Externe auf der Seite „Geräte“ (LLH-1496, Spec `lagebild-extern`): die
 * Einsatzleitung gibt je Empfänger einen Link aus, ohne Konto. Der Schlüssel steht einmal als
 * Link und QR im Dialog und ist danach nicht mehr abrufbar (der Server speichert nur seinen Hash).
 *
 * `darf` ist die Einsatzleitung am aktiven Einsatz, hier oder am Spiegel: der Link gilt an dieser
 * Instanz, der ETB-Eintrag geht am Spiegel als Antrag an die führende Stelle.
 */
export default function EinsatzLagebildExtern({
  einsatzId,
  darf,
}: {
  einsatzId: number;
  darf: boolean;
}) {
  const qc = useQueryClient();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [neu, setNeu] = useState<LagebildFreigabeMitSchluessel | null>(null);
  const [widerrufFuer, setWiderrufFuer] = useState<LagebildFreigabeAnzeige | null>(null);
  const [form] = Form.useForm<AnlegenWerte>();
  const gewaehlteStufe = Form.useWatch('stufe', form);

  const freigabenQ = useQuery({
    queryKey: einsatzKeys.lagebildFreigaben(einsatzId),
    queryFn: () => ladeLagebildFreigaben(einsatzId),
  });
  const anlegen = useMutation({
    mutationFn: (w: AnlegenWerte) =>
      legeLagebildFreigabeAn(einsatzId, { ...w, empfaenger: w.empfaenger.trim() }),
    onSuccess: (antwort) => {
      qc.setQueryData<LagebildFreigabeAnzeige[]>(
        einsatzKeys.lagebildFreigaben(einsatzId),
        (alt) => [antwort.freigabe, ...(alt ?? [])],
      );
      setNeu(antwort);
    },
  });
  const widerrufen = useMutation({
    mutationFn: (f: LagebildFreigabeAnzeige) => widerrufeLagebildFreigabe(einsatzId, f.id),
    onSuccess: (liste) => {
      qc.setQueryData(einsatzKeys.lagebildFreigaben(einsatzId), liste);
      setWiderrufFuer(null);
    },
  });

  if (freigabenQ.isError) {
    return <Alert type="error" title="Lagebild für Externe nicht ladbar" showIcon />;
  }
  const freigaben = freigabenQ.data ?? [];
  const zeit = (wert: string) => zeitKurz(wert, konv);
  const link = neu ? lagebildExternAdresse(window.location.origin, neu.schluessel) : '';

  return (
    <>
      <Formularpaneel
        titel="Lagebild für Externe"
        dataUpdatedAt={freigabenQ.dataUpdatedAt}
        aktion={
          darf && (
            <Button icon={<IconPlus />} onClick={() => setAnlegenOffen(true)}>
              Link ausgeben
            </Button>
          )
        }
      >
        <Liste<LagebildFreigabeAnzeige>
          bordered
          loading={freigabenQ.isLoading}
          dataSource={freigaben}
          rowKey={(f) => f.id}
          emptyText="Noch kein Link ausgegeben"
          renderItem={(f) => (
            <ListenEintrag
              actions={
                darf && f.gueltig
                  ? [
                      <Button
                        key="widerrufen"
                        danger
                        aria-label={`Link für ${f.empfaenger} widerrufen`}
                        onClick={() => setWiderrufFuer(f)}
                      >
                        Widerrufen …
                      </Button>,
                    ]
                  : undefined
              }
            >
              <ListenEintragMeta
                title={<span data-lfh="lagebild-freigabe-titel">{f.empfaenger}</span>}
                description={
                  <span style={{ display: 'grid', gap: 2, color: rollen.gedaempft }}>
                    <span data-lfh="lagebild-freigabe-zustand">{freigabeZeile(f, zeit)}</span>
                    {f.protokoll.slice(0, PROTOKOLL_SICHTBAR).map((o) => (
                      <span
                        key={o.begonnen_at + o.zuletzt_at}
                        data-lfh="lagebild-freigabe-oeffnung"
                        style={{ fontSize: token.fontSizeSM }}
                      >
                        {`${zeit(o.begonnen_at)} – ${zeit(o.zuletzt_at)} · ${o.abrufe} ${o.abrufe === 1 ? 'Abruf' : 'Abrufe'}`}
                      </span>
                    ))}
                  </span>
                }
              />
            </ListenEintrag>
          )}
        />
      </Formularpaneel>

      <ErfassungsModal<AnlegenWerte>
        offen={anlegenOffen}
        titel="Link ausgeben"
        form={form}
        erfassenText="Ausgeben"
        laeuft={anlegen.isPending}
        speicherung={anlegen}
        speicherFehlerTitel="Kein Link ausgegeben"
        initialValues={{ stufe: 'lagebild', dauer: '24h' }}
        onErfassen={(w) => anlegen.mutateAsync(w)}
        onFertig={() => setAnlegenOffen(false)}
        onAbbrechen={() => setAnlegenOffen(false)}
      >
        <Form.Item
          label="Empfänger"
          name="empfaenger"
          rules={[
            { required: true, whitespace: true, message: 'Empfänger angeben' },
            {
              max: LAGEBILD_EMPFAENGER_MAX,
              message: `Höchstens ${LAGEBILD_EMPFAENGER_MAX} Zeichen`,
            },
          ]}
        >
          <Input placeholder="Krisenstab Kreis" maxLength={LAGEBILD_EMPFAENGER_MAX} />
        </Form.Item>
        <Form.Item
          label="Stufe"
          name="stufe"
          extra={gewaehlteStufe ? STUFE_INHALT[gewaehlteStufe] : undefined}
        >
          <Select<LagebildStufe>
            options={(['lagebild', 'oeffentlich'] as const).map((s) => ({
              value: s,
              label: STUFE_LABEL[s],
            }))}
          />
        </Form.Item>
        <Form.Item label="Gültig" name="dauer">
          <Select<LagebildDauer>
            options={(['2h', '12h', '24h', 'einsatzende'] as const).map((d) => ({
              value: d,
              label: DAUER_LABEL[d],
            }))}
          />
        </Form.Item>
      </ErfassungsModal>

      <Modal
        open={widerrufFuer != null}
        title={widerrufFuer ? `Link für ${widerrufFuer.empfaenger} widerrufen?` : 'Widerrufen?'}
        okText="Widerrufen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: widerrufen.isPending }}
        onOk={() => widerrufFuer && widerrufen.mutate(widerrufFuer)}
        onCancel={() => {
          widerrufen.reset();
          setWiderrufFuer(null);
        }}
        destroyOnHidden
      >
        <p>Der Link zeigt sofort nichts mehr.</p>
        <SpeicherFehler fehler={widerrufen.error} titel="Nicht widerrufen" />
      </Modal>

      <Modal
        open={neu != null}
        title={neu ? `Link für ${neu.freigabe.empfaenger}` : 'Link'}
        footer={
          <Button type="primary" onClick={() => setNeu(null)}>
            Fertig
          </Button>
        }
        onCancel={() => setNeu(null)}
        destroyOnHidden
      >
        {neu && (
          <div data-lfh="lagebild-link">
            <p>
              {`${STUFE_LABEL[neu.freigabe.stufe]}, ${
                neu.freigabe.gueltig_bis
                  ? `gültig bis ${zeit(neu.freigabe.gueltig_bis)}`
                  : 'bis Einsatzende'
              }, nur jetzt sichtbar.`}
            </p>
            <div
              style={{
                background: rollen.flaeche,
                width: 'fit-content',
                marginBlockEnd: token.marginSM,
              }}
            >
              <QRCodeSVG value={link} size={200} marginSize={4} />
            </div>
            <KopierbarerText text={link} bezeichnung="Link">
              <Typography.Text
                data-lfh="lagebild-link-text"
                style={{ ...monoStil(13, 400), overflowWrap: 'anywhere' }}
              >
                {link}
              </Typography.Text>
            </KopierbarerText>
          </div>
        )}
      </Modal>
    </>
  );
}
