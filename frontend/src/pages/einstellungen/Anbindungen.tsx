import { useState } from 'react';
import { Alert, App, Button, Checkbox, Form, Input, Modal, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { IconKreuz, IconPlus } from '../../icons';
import AdminPage from '../../components/AdminPage';
import { Paneel, StatusChip, monoStil, useRollen } from '../../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../../components/Liste';
import type { WeitereAktionen } from '../../components/Datensicht';
import { ZeilenMenueAusloeser } from '../../components/ZeilenMenueAusloeser';
import { useZeilenMenueKontext } from '../../components/useDatensatzKontextMenue';
import KopierbarerText from '../../components/KopierbarerText';
import { ErfassungsModal } from '../../components/Erfassung';
import { RechteHinweis, SeitenHinweise, SpeicherFehler } from '../../components/SpeicherHinweis';
import { NUR_ADMIN } from '../../components/nurAnsicht';
import { useAuth } from '../../auth/AuthContext';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import { ZeitpunktEingabe } from '../../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../../anzeige/zeitEingabe';
import {
  SCOPES,
  SCOPE_TEXT,
  ablehnungText,
  aendereAnbindung,
  ladeAnbindungen,
  legeAnbindungAn,
  scopeText,
  stelleAnbindungsCodeAus,
  widerrufeAnbindung,
  type AnbindungEingabe,
} from '../../api/anbindungen';
import { ANBINDUNG_NAME_MAX } from '../../api/eingabegrenzen';
import { globalKeys } from '../../api/queryKeys';
import type { AnbindungAnzeige, AnbindungCode, AnbindungenListe, Scope } from '../../api/types';

interface FormWerte {
  name?: string;
  scopes?: Scope[];
  gueltig_bis?: Dayjs | null;
}

/** Wort und Ton des Zustands, rein und exportiert für den Test. */
export function zustandAnzeige(z: Pick<AnbindungAnzeige, 'zustand' | 'is_abgelaufen'>): {
  wort: string;
  ton: 'normal' | 'bedien' | 'neutral' | 'achtung';
} {
  if (z.zustand === 'widerrufen') return { wort: 'widerrufen', ton: 'neutral' };
  if (z.is_abgelaufen) return { wort: 'abgelaufen', ton: 'achtung' };
  if (z.zustand === 'wartet') return { wort: 'wartet auf Schlüssel', ton: 'bedien' };
  return { wort: 'aktiv', ton: 'normal' };
}

function eingabe(w: FormWerte): AnbindungEingabe {
  return {
    name: (w.name ?? '').trim(),
    scopes: w.scopes ?? [],
    gueltig_bis: w.gueltig_bis ? alsBackendZeit(w.gueltig_bis) : null,
  };
}

/**
 * Admin-Sektion `/admin/einstellungen/anbindungen`: Maschinenzugänge für Fremdsysteme (LLH-1652,
 * Spec `maschinenzugang`, Entwurf `docs/design/2026-11-12-anbindungen/`). Anlegen, Ändern, neuer
 * Code und Widerruf nur der System-Admin. Der Einmal-Code steht genau einmal im Dialog; danach
 * zeigt die Seite nur Fingerabdrücke. Den Grund einer abgelehnten Anfrage sieht nur der Admin.
 */
export default function Anbindungen() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [bearbeiten, setBearbeiten] = useState<AnbindungAnzeige | null>(null);
  const [code, setCode] = useState<AnbindungCode | null>(null);
  const [widerrufFuer, setWiderrufFuer] = useState<AnbindungAnzeige | null>(null);
  const [form] = Form.useForm<FormWerte>();

  const listeQ = useQuery({ queryKey: globalKeys.anbindungen(), queryFn: ladeAnbindungen });

  const uebernimm = (z: AnbindungAnzeige) =>
    qc.setQueryData<AnbindungenListe>(globalKeys.anbindungen(), (alt) =>
      alt
        ? {
            ...alt,
            zugaenge: alt.zugaenge.some((x) => x.id === z.id)
              ? alt.zugaenge.map((x) => (x.id === z.id ? z : x))
              : [z, ...alt.zugaenge],
          }
        : alt,
    );

  const anlegen = useMutation({
    mutationFn: legeAnbindungAn,
    onSuccess: (antwort) => {
      uebernimm(antwort.zugang);
      setCode(antwort);
    },
  });
  const aendern = useMutation({
    mutationFn: ({ id, werte }: { id: string; werte: AnbindungEingabe }) =>
      aendereAnbindung(id, werte),
    onSuccess: (z) => {
      uebernimm(z);
      message.success(`${z.name} gespeichert`);
    },
  });
  const neuerCode = useMutation({
    mutationFn: (z: AnbindungAnzeige) => stelleAnbindungsCodeAus(z.id),
    onSuccess: (antwort) => {
      uebernimm(antwort.zugang);
      setCode(antwort);
    },
  });
  const widerrufen = useMutation({
    mutationFn: (z: AnbindungAnzeige) => widerrufeAnbindung(z.id),
    onSuccess: (z) => {
      uebernimm(z);
      setWiderrufFuer(null);
      message.success(`${z.name} widerrufen`);
    },
  });

  const liste = listeQ.data;
  const zugaenge = liste?.zugaenge ?? [];
  const gesperrt = liste?.gesperrt_grund ?? null;
  const zeit = (wert: string) => zeitKurz(wert, konv);

  /** Aktionen eines Zugangs, EINE Quelle für ⋮ und Kontextmenü (LLH-1599). */
  const menue: WeitereAktionen<AnbindungAnzeige> | undefined = istAdmin
    ? {
        eintraege: (z) =>
          z.zustand === 'widerrufen'
            ? []
            : [
                { key: 'bearbeiten', label: 'Bearbeiten …' },
                ...(gesperrt ? [] : [{ key: 'code', label: 'Neuer Code (Schlüssel wechseln)' }]),
                { key: 'widerrufen', icon: <IconKreuz />, label: 'Widerrufen …', gefahr: true },
              ],
        zugaenglicherName: (z) => `Aktionen zu Anbindung ${z.name}`,
        laeuft: () => neuerCode.isPending || widerrufen.isPending,
        onWahl: (key, z) => {
          if (key === 'bearbeiten') {
            aendern.reset();
            setBearbeiten(z);
          } else if (key === 'code') {
            neuerCode.mutate(z);
          } else {
            widerrufen.reset();
            setWiderrufFuer(z);
          }
        },
      }
    : undefined;
  const kontext = useZeilenMenueKontext(menue, {
    finde: (id) => zugaenge.find((z) => z.id === id),
    schluessel: (z) => z.id,
  });

  const formularOffen = anlegenOffen || bearbeiten != null;
  const schliessen = () => {
    setAnlegenOffen(false);
    setBearbeiten(null);
  };

  return (
    <AdminPage
      titel="Anbindungen"
      aktionen={
        istAdmin && (
          <Button
            type="primary"
            icon={<IconPlus />}
            disabled={gesperrt != null}
            onClick={() => {
              anlegen.reset();
              setAnlegenOffen(true);
            }}
          >
            Anbindung anlegen
          </Button>
        )
      }
      hinweis={
        <SeitenHinweise
          rechteFehlt={!istAdmin}
          rechteText={NUR_ADMIN}
          fehler={neuerCode.error}
          fehlerTitel="Kein neuer Code"
        />
      }
    >
      {gesperrt && (
        <div data-lfh="anbindungen-gesperrt" style={{ marginBlockEnd: token.margin }}>
          <RechteHinweis sichtbar marke="Am Hub anbinden" text={gesperrt} />
        </div>
      )}
      <Paneel titel="Zugänge" meta={listeQ.isSuccess ? zugaenge.length : undefined} koerperPolster>
        {listeQ.isLoading ? (
          <Spin />
        ) : listeQ.isError ? (
          <Alert type="error" title="Anbindungen nicht ladbar" showIcon />
        ) : (
          <Liste<AnbindungAnzeige>
            bordered
            dataSource={zugaenge}
            rowKey={(z) => z.id}
            emptyText="Noch keine Anbindung"
            renderItem={(z) => {
              const zustand = zustandAnzeige(z);
              const widerrufenAm = z.zustand === 'widerrufen';
              return (
                <div data-lfh="anbindung-eintrag" {...(menue ? kontext.ausloeser(z) : {})}>
                  <ListenEintrag
                    actions={
                      menue && !widerrufenAm
                        ? [<ZeilenMenueAusloeser key="aktionen" menue={menue} zeile={z} />]
                        : undefined
                    }
                  >
                    <ListenEintragMeta
                      title={
                        <span
                          style={{
                            display: 'inline-flex',
                            gap: token.marginXS,
                            alignItems: 'center',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span data-lfh="anbindung-name">{z.name}</span>
                          <StatusChip ton={zustand.ton} wort={zustand.wort} />
                        </span>
                      }
                      description={
                        <span
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            color: rollen.gedaempft,
                          }}
                        >
                          <span data-lfh="anbindung-rechte">
                            {z.scopes.map((s, i) => (
                              <span key={s}>
                                {i > 0 && ' · '}
                                {scopeText(s)}{' '}
                                <span style={{ ...monoStil(11, 500), color: rollen.schwach }}>
                                  {s}
                                </span>
                              </span>
                            ))}
                          </span>
                          <span>
                            {z.fingerabdruck ? (
                              <>
                                Schlüssel <span style={monoStil(12, 500)}>{z.fingerabdruck}</span>
                              </>
                            ) : widerrufenAm ? (
                              'ohne Schlüssel'
                            ) : (
                              'Code noch nicht eingelöst'
                            )}
                            {z.fingerabdruck_neu && (
                              <>
                                {' · neuer Schlüssel '}
                                <span style={monoStil(12, 500)}>{z.fingerabdruck_neu}</span>
                                {', gilt ab der ersten Anfrage damit'}
                              </>
                            )}
                          </span>
                          <span>
                            {z.zuletzt_genutzt_at
                              ? `zuletzt genutzt ${zeit(z.zuletzt_genutzt_at)}`
                              : 'noch nie genutzt'}
                            {z.gueltig_bis && ` · gültig bis ${zeit(z.gueltig_bis)}`}
                            {z.widerrufen_at && ` · widerrufen ${zeit(z.widerrufen_at)}`}
                          </span>
                          {z.letzte_ablehnung && !widerrufenAm && (
                            <span
                              data-lfh="anbindung-ablehnung"
                              style={{ color: rollen.achtungText }}
                            >
                              {`Letzte Ablehnung: ${ablehnungText(z.letzte_ablehnung)} · ${zeit(z.letzte_ablehnung.at)}`}
                            </span>
                          )}
                        </span>
                      }
                    />
                  </ListenEintrag>
                </div>
              );
            }}
          />
        )}
        {kontext.menue}
      </Paneel>

      <ErfassungsModal<FormWerte>
        key={bearbeiten?.id ?? 'neu'}
        offen={formularOffen}
        initialValues={
          bearbeiten
            ? {
                name: bearbeiten.name,
                scopes: bearbeiten.scopes,
                gueltig_bis: alsZeitpunkt(bearbeiten.gueltig_bis) ?? null,
              }
            : undefined
        }
        titel={bearbeiten ? `${bearbeiten.name} bearbeiten` : 'Anbindung anlegen'}
        form={form}
        erfassenText={bearbeiten ? 'Speichern' : 'Anlegen und Code zeigen'}
        laeuft={anlegen.isPending || aendern.isPending}
        onErfassen={(w) =>
          bearbeiten
            ? aendern.mutateAsync({ id: bearbeiten.id, werte: eingabe(w) })
            : anlegen.mutateAsync(eingabe(w))
        }
        onFertig={schliessen}
        onAbbrechen={() => {
          anlegen.reset();
          aendern.reset();
          schliessen();
        }}
      >
        <Form.Item
          label="Name"
          name="name"
          rules={[
            { required: true, whitespace: true, message: 'Name angeben' },
            { max: ANBINDUNG_NAME_MAX, message: `Höchstens ${ANBINDUNG_NAME_MAX} Zeichen` },
          ]}
        >
          <Input placeholder="Alarm-Adapter Wache 1" maxLength={ANBINDUNG_NAME_MAX} />
        </Form.Item>
        <Form.Item
          label="Rechte"
          name="scopes"
          rules={[
            { required: true, type: 'array', min: 1, message: 'Mindestens ein Recht wählen' },
          ]}
        >
          <Checkbox.Group
            style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}
          >
            {SCOPES.map((s) => (
              <Checkbox key={s} value={s}>
                {SCOPE_TEXT[s]}{' '}
                <span style={{ ...monoStil(11, 500), color: rollen.schwach }}>{s}</span>
              </Checkbox>
            ))}
          </Checkbox.Group>
        </Form.Item>
        <Form.Item label="Gültig bis" name="gueltig_bis" extra="Leer: gilt, bis du sie widerrufst.">
          <ZeitpunktEingabe art="frist" style={{ width: '100%' }} />
        </Form.Item>
        <SpeicherFehler
          fehler={bearbeiten ? aendern.error : anlegen.error}
          titel={bearbeiten ? 'Nicht gespeichert' : 'Nicht angelegt'}
        />
      </ErfassungsModal>

      <Modal
        open={widerrufFuer != null}
        title={widerrufFuer ? `${widerrufFuer.name} widerrufen?` : 'Widerrufen?'}
        okText="Widerrufen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: widerrufen.isPending }}
        onOk={() => widerrufFuer && widerrufen.mutate(widerrufFuer)}
        onCancel={() => setWiderrufFuer(null)}
        destroyOnHidden
      >
        <p>
          Das Fremdsystem kommt ab sofort nicht mehr herein. Andere Anbindungen und gekoppelte
          Instanzen bleiben unberührt.
        </p>
        <SpeicherFehler fehler={widerrufen.error} titel="Nicht widerrufen" />
      </Modal>

      <Modal
        open={code != null}
        title={code ? `Code für ${code.zugang.name}` : 'Code'}
        footer={
          <Button type="primary" onClick={() => setCode(null)}>
            Fertig
          </Button>
        }
        onCancel={() => setCode(null)}
        destroyOnHidden
      >
        {code && (
          <div
            data-lfh="anbindung-code"
            style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}
          >
            <KopierbarerText text={code.code} bezeichnung="Code">
              <span data-lfh="anbindung-code-text" style={monoStil(22, 500)}>
                {code.code}
              </span>
            </KopierbarerText>
            <span style={{ color: rollen.gedaempft }}>
              gilt bis {zeit(code.laeuft_ab_at)}, einmal einlösbar · nur jetzt sichtbar
            </span>
            <KopierbarerText
              text={`lifeline-hub zugang redeem ${window.location.origin} ${code.code}`}
              bezeichnung="Kommando"
            >
              <span style={{ ...monoStil(12, 500), wordBreak: 'break-all' }}>
                lifeline-hub zugang redeem {window.location.origin} {code.code}
              </span>
            </KopierbarerText>
            <span style={{ color: rollen.gedaempft }}>
              Nach dem Einlösen steht der Fingerabdruck des Fremdsystems am Zugang. Das Kommando
              zeigt denselben.
            </span>
          </div>
        )}
      </Modal>
    </AdminPage>
  );
}
