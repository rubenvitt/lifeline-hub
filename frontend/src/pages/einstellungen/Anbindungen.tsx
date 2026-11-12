import { useState } from 'react';
import { App, Button, Checkbox, Form, Input, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { Link, useNavigate } from 'react-router';
import { IconKreuz, IconPlus } from '../../icons';
import AdminPage from '../../components/AdminPage';
import { Paneel, StatusChip, monoStil, useRollen } from '../../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../../components/Liste';
import type { WeitereAktionen } from '../../components/Datensicht';
import { ZeilenMenueAusloeser } from '../../components/ZeilenMenueAusloeser';
import { useZeilenMenueKontext } from '../../components/useDatensatzKontextMenue';
import { ErfassungsModal } from '../../components/Erfassung';
import { SeitenFehler } from '../../components/SeitenZustand';
import { RechteHinweis, SeitenHinweise } from '../../components/SpeicherHinweis';
import { NUR_ADMIN } from '../../components/nurAnsicht';
import { useAuth } from '../../auth/AuthContext';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import { ZeitpunktEingabe } from '../../anzeige/ZeitpunktEingabe';
import { alsBackendZeit } from '../../anzeige/zeitEingabe';
import {
  SCOPES,
  SCOPE_TEXT,
  ablehnungText,
  ladeAnbindungen,
  legeAnbindungAn,
  stelleAnbindungsCodeAus,
  widerrufeAnbindung,
  type AnbindungEingabe,
} from '../../api/anbindungen';
import { ANBINDUNG_NAME_MAX } from '../../api/eingabegrenzen';
import { globalKeys } from '../../api/queryKeys';
import type { AnbindungAnzeige, AnbindungCode, Scope } from '../../api/types';
import { CodeDialog, RechteText, WiderrufDialog } from './AnbindungDialoge';
import {
  ANBINDUNGEN_ABRUF_MS,
  anbindungPath,
  einsatzAnzeige,
  uebernimmAnbindung,
  zustandAnzeige,
} from './anbindungAnzeige';

interface FormWerte {
  name?: string;
  scopes?: Scope[];
  gueltig_bis?: Dayjs | null;
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
 * Spec `maschinenzugang`, Entwurf `docs/design/2026-11-12-anbindungen/`). Anlegen, neuer Code und
 * Widerruf nur der System-Admin; Name, Rechte und Frist ändert er in der Ansicht des Zugangs
 * (`AnbindungAnsicht`, Item-Route), wohin die Seite nach dem Anlegen springt. Der Einmal-Code
 * steht genau einmal im Dialog; danach zeigt die Seite nur Fingerabdrücke. Lesen darf, wer in
 * die Verwaltung darf (design.md D11), samt Ablehnungsgrund: das Fremdsystem fragt nicht
 * mit dem Grund zurück, der Betreiber erfährt ihn hier.
 */
export default function Anbindungen() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [code, setCode] = useState<AnbindungCode | null>(null);
  /** Nach dem Anlegen: „Fertig“ am Code führt in die neue Ansicht. */
  const [nachCodeZu, setNachCodeZu] = useState<string | null>(null);
  const [widerrufFuer, setWiderrufFuer] = useState<AnbindungAnzeige | null>(null);
  const [form] = Form.useForm<FormWerte>();

  const listeQ = useQuery({
    queryKey: globalKeys.anbindungen(),
    queryFn: ladeAnbindungen,
    refetchInterval: ANBINDUNGEN_ABRUF_MS,
  });

  const anlegen = useMutation({
    mutationFn: legeAnbindungAn,
    onSuccess: (antwort) => {
      uebernimmAnbindung(qc, antwort.zugang);
      setNachCodeZu(antwort.zugang.id);
      setCode(antwort);
    },
  });
  const neuerCode = useMutation({
    mutationFn: (z: AnbindungAnzeige) => stelleAnbindungsCodeAus(z.id),
    onSuccess: (antwort) => {
      uebernimmAnbindung(qc, antwort.zugang);
      setNachCodeZu(null);
      setCode(antwort);
    },
  });
  const widerrufen = useMutation({
    mutationFn: (z: AnbindungAnzeige) => widerrufeAnbindung(z.id),
    onSuccess: (z) => {
      uebernimmAnbindung(qc, z);
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
                ...(gesperrt ? [] : [{ key: 'code', label: 'Neuer Code (Schlüssel wechseln)' }]),
                { key: 'widerrufen', icon: <IconKreuz />, label: 'Widerrufen …', gefahr: true },
              ],
        zugaenglicherName: (z) => `Aktionen zu Anbindung ${z.name}`,
        laeuft: () => neuerCode.isPending || widerrufen.isPending,
        onWahl: (key, z) => {
          if (key === 'code') {
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

  return (
    <AdminPage
      titel="Anbindungen"
      aktionen={
        istAdmin && (
          <Button
            type="primary"
            icon={<IconPlus />}
            disabled={liste == null || gesperrt != null}
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
        {liste == null ? (
          listeQ.isError ? (
            <SeitenFehler
              text="Anbindungen nicht ladbar"
              ursache={listeQ.error}
              onWiederholen={() => void listeQ.refetch()}
              laedt={listeQ.isFetching}
            />
          ) : (
            <Spin />
          )
        ) : (
          <>
            {listeQ.isError && (
              <div style={{ marginBlockEnd: token.marginSM }}>
                <SeitenFehler
                  text="Stand nicht aktuell: neu laden gescheitert"
                  ursache={listeQ.error}
                  onWiederholen={() => void listeQ.refetch()}
                  laedt={listeQ.isFetching}
                />
              </div>
            )}
            <Liste<AnbindungAnzeige>
              bordered
              dataSource={zugaenge}
              rowKey={(z) => z.id}
              emptyText="Noch keine Anbindung"
              renderItem={(z) => {
                const zustand = zustandAnzeige(z);
                const widerrufenAm = z.zustand === 'widerrufen';
                const einsatz = einsatzAnzeige(z);
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
                            <Link data-lfh="anbindung-name" to={anbindungPath(z.id)}>
                              {z.name}
                            </Link>
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
                            <RechteText scopes={z.scopes} />
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
                              {z.widerrufen_at &&
                                ` · widerrufen ${zeit(z.widerrufen_at)}${z.widerrufen_von_name ? ` von ${z.widerrufen_von_name}` : ''}`}
                            </span>
                            {einsatz && <span data-lfh="anbindung-einsatz">{einsatz}</span>}
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
          </>
        )}
        {kontext.menue}
      </Paneel>

      <ErfassungsModal<FormWerte>
        offen={anlegenOffen}
        titel="Anbindung anlegen"
        form={form}
        erfassenText="Anlegen und Code zeigen"
        laeuft={anlegen.isPending}
        speicherung={anlegen}
        speicherFehlerTitel="Nicht angelegt"
        onErfassen={(w) => anlegen.mutateAsync(eingabe(w))}
        onFertig={() => setAnlegenOffen(false)}
        onAbbrechen={() => setAnlegenOffen(false)}
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
        <Form.Item label="Gültig bis" name="gueltig_bis">
          <ZeitpunktEingabe art="frist" placeholder="bis zum Widerruf" style={{ width: '100%' }} />
        </Form.Item>
      </ErfassungsModal>

      <WiderrufDialog
        zugang={widerrufFuer}
        laeuft={widerrufen.isPending}
        fehler={widerrufen.error}
        onWiderrufen={(z) => widerrufen.mutate(z)}
        onAbbrechen={() => setWiderrufFuer(null)}
      />
      <CodeDialog
        code={code}
        onFertig={() => {
          setCode(null);
          if (nachCodeZu) navigate(anbindungPath(nachCodeZu));
        }}
      />
    </AdminPage>
  );
}
