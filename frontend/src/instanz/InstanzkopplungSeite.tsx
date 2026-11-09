import { useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Space, Spin, Tooltip, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconKreuz, IconPlus } from '../icons';
import AdminPage from '../components/AdminPage';
import { Datenfeld, Datenraster, Paneel, monoStil, useRollen } from '../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import KopierbarerText from '../components/KopierbarerText';
import { ErfassungsModal } from '../components/Erfassung';
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import { NUR_ADMIN } from '../components/nurAnsicht';
import { useAuth } from '../auth/AuthContext';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import {
  gegenzeichne,
  loadInstanzUebersicht,
  redeemKopplungscode,
  registriereUnterschriftsschluessel,
  issueKopplungscode,
  gleicheStammdatenNeuAb,
  meldeElwVerloren,
  widerrufeKopplung,
  widerrufeUnterschriftsschluessel,
} from '../api/instanz';
import { globalKeys } from '../api/queryKeys';
import type {
  InstanzKopplungAnzeige,
  KopplungscodeAntwort,
  UnterschriftSchluesselAnzeige,
} from '../api/types';
import {
  codeAusstellenSperre,
  kopplungHinweise,
  kopplungZustandZeile,
  richtungText,
  schluesselZeile,
  stammdatenZeile,
} from './instanzText';

/** Längste Bezeichnung eines Unterschriftsschlüssels (`routes::instanz::BEZEICHNUNG_MAX`). */
const BEZEICHNUNG_MAX = 80;

interface EinloesenWerte {
  adresse?: string;
  code?: string;
}

interface RegistrierenWerte {
  bezeichnung?: string;
}

/**
 * Admin-Sektion `/admin/einstellungen/instanzkopplung` (LLH-1490, Specs `instanz-kopplung` und
 * `org-admin-unterschrift`): diese Instanz mit einer anderen koppeln (etwa ELW und Hub), die
 * Kopplungen der eigenen Org sehen und widerrufen, Unterschriftsschlüssel der Org-Admins
 * registrieren, gegenzeichnen und widerrufen. Lesen darf, wer die Verwaltung sieht; handeln nur
 * der System-Admin.
 *
 * Der Kopplungscode steht genau einmal im Dialog nach dem Ausstellen; der Server speichert nur
 * Ableitungen. „Zuletzt gesehen“ frischt ein Abruf alle 30 s auf.
 */
export default function InstanzkopplungSeite() {
  const { benutzer } = useAuth();
  const isAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const [einloesenOffen, setEinloesenOffen] = useState(false);
  const [registrierenOffen, setRegistrierenOffen] = useState(false);
  const [neuerCode, setNeuerCode] = useState<KopplungscodeAntwort | null>(null);
  const [widerrufKopplung, setWiderrufKopplung] = useState<InstanzKopplungAnzeige | null>(null);
  // „ELW verloren“ (LLH-1493): die Kopplung, für die die Rückfrage offen ist.
  const [verlorenKopplung, setVerlorenKopplung] = useState<InstanzKopplungAnzeige | null>(null);
  const [widerrufSchluessel, setWiderrufSchluessel] =
    useState<UnterschriftSchluesselAnzeige | null>(null);
  const [einloesenForm] = Form.useForm<EinloesenWerte>();
  const [registrierenForm] = Form.useForm<RegistrierenWerte>();

  const uebersichtQ = useQuery({
    queryKey: globalKeys.instanzkopplung(),
    queryFn: loadInstanzUebersicht,
    refetchInterval: 30_000,
  });
  const reload = () => qc.invalidateQueries({ queryKey: globalKeys.instanzkopplung() });

  const codeAusstellen = useMutation({
    mutationFn: issueKopplungscode,
    onSuccess: (c) => setNeuerCode(c),
  });
  const einloesen = useMutation({
    mutationFn: (w: { adresse: string; code: string }) => redeemKopplungscode(w.adresse, w.code),
    onSuccess: (k) => {
      void reload();
      message.success(`Gekoppelt mit ${k.gegenueber_name}`);
    },
  });
  const kopplungWiderrufen = useMutation({
    mutationFn: (k: InstanzKopplungAnzeige) => widerrufeKopplung(k.id),
    onSuccess: (k) => {
      void reload();
      setWiderrufKopplung(null);
      message.success(`Kopplung mit ${k.gegenueber_name} widerrufen`);
    },
  });
  const elwVerloren = useMutation({
    mutationFn: (k: InstanzKopplungAnzeige) => meldeElwVerloren(k.id),
    onSuccess: (a) => {
      void reload();
      setVerlorenKopplung(null);
      message.success(
        `${a.kopplung.gegenueber_name} als verloren gemeldet, ${a.konten} ${a.konten === 1 ? 'Konto' : 'Konten'} gesperrt`,
      );
    },
  });
  const stammdatenNeu = useMutation({
    mutationFn: (k: InstanzKopplungAnzeige) => gleicheStammdatenNeuAb(k.id),
    onSuccess: (k) => {
      void reload();
      void qc.invalidateQueries({ queryKey: globalKeys.stammdatenHerkunft() });
      message.success(`Stammdaten von ${k.gegenueber_name} neu abgeglichen`);
    },
  });
  const registrieren = useMutation({
    mutationFn: (bezeichnung: string) => registriereUnterschriftsschluessel(bezeichnung),
    onSuccess: () => void reload(),
  });
  const gegenzeichnen = useMutation({
    mutationFn: (s: UnterschriftSchluesselAnzeige) => gegenzeichne(s.id),
    onSuccess: (s) => {
      void reload();
      message.success(`Schlüssel von ${s.benutzer_name} gegengezeichnet`);
    },
  });
  const schluesselWiderrufen = useMutation({
    mutationFn: (s: UnterschriftSchluesselAnzeige) => widerrufeUnterschriftsschluessel(s.id),
    onSuccess: () => {
      void reload();
      setWiderrufSchluessel(null);
    },
  });

  const zeit = (wert: string) => zeitKurz(wert, konv);
  const u = uebersichtQ.data;
  const sperre = u ? codeAusstellenSperre(u) : undefined;

  return (
    <AdminPage
      titel="Instanzkopplung"
      breite="schmal"
      aktionen={
        isAdmin && (
          <Space wrap size={token.marginSM}>
            <Tooltip title={sperre}>
              <Button
                type="primary"
                icon={<IconPlus />}
                disabled={!u || sperre != null}
                loading={codeAusstellen.isPending}
                onClick={() => codeAusstellen.mutate()}
                data-lfh="instanz-code-ausstellen"
              >
                Code ausstellen
              </Button>
            </Tooltip>
            <Button onClick={() => setEinloesenOffen(true)} data-lfh="instanz-code-einloesen">
              Code einlösen
            </Button>
          </Space>
        )
      }
      hinweis={<SeitenHinweise rechteFehlt={!isAdmin} rechteText={NUR_ADMIN} />}
    >
      {uebersichtQ.isLoading ? (
        <Spin />
      ) : !u ? (
        <Alert type="error" title="Instanzkopplung nicht ladbar" showIcon />
      ) : (
        <>
          {isAdmin && sperre && (
            <Alert
              type="info"
              showIcon
              style={{ marginBlockEnd: token.marginMD }}
              title={sperre}
              data-lfh="instanz-sperre"
            />
          )}
          <SpeicherFehler fehler={codeAusstellen.error} titel="Kein Code ausgestellt" />
          <SpeicherFehler fehler={stammdatenNeu.error} titel="Nicht abgeglichen" />

          <Paneel titel="Diese Instanz" koerperPolster>
            <Datenraster spalten={2}>
              <Datenfeld label="Name">{u.name}</Datenfeld>
              <Datenfeld label="Stand" mono>
                {u.softwarestand} · Protokoll {u.protokoll}
              </Datenfeld>
              <Datenfeld label="Fingerabdruck" mono breit>
                <KopierbarerText text={u.fingerabdruck} bezeichnung="Fingerabdruck">
                  <span data-lfh="instanz-fingerabdruck">{u.fingerabdruck}</span>
                </KopierbarerText>
              </Datenfeld>
            </Datenraster>
          </Paneel>

          <Paneel
            titel="Gekoppelte Instanzen"
            meta={u.kopplungen.length}
            koerperPolster
            style={{ marginBlockStart: token.marginMD }}
          >
            <Liste<InstanzKopplungAnzeige>
              bordered
              dataSource={u.kopplungen}
              rowKey={(k) => k.id}
              emptyText="Noch keine Kopplung"
              renderItem={(k) => {
                const hinweise = kopplungHinweise(k, u.datentraeger_bestaetigt);
                const stammdaten = stammdatenZeile(k);
                const aktiv = k.org.widerrufen_at == null;
                // Stammdaten (LLH-1493): an der meldenden Seite neu abgleichen, solange die
                // Zuordnung gilt. An der erreichten „ELW verloren“ auch nach dem Widerruf, solange
                // dort gelieferte Passwörter gelten; danach räumt die Meldung sie.
                const verlorenMoeglich =
                  k.richtung === 'wird_gemeldet' &&
                  (aktiv || k.org.stammdaten.konten_mit_geheimnis > 0);
                const eintraege: MenueEintrag[] = [
                  ...(aktiv && k.richtung === 'meldet_sich'
                    ? [{ key: 'abgleichen', label: 'Stammdaten erneut abgleichen' }]
                    : []),
                  ...(verlorenMoeglich
                    ? [{ key: 'verloren', label: 'ELW verloren …', gefahr: true as const }]
                    : []),
                  ...(aktiv
                    ? [
                        {
                          key: 'widerrufen',
                          icon: <IconKreuz />,
                          label: 'Widerrufen …',
                          gefahr: true as const,
                        },
                      ]
                    : []),
                ];
                const laeuft =
                  kopplungWiderrufen.isPending || stammdatenNeu.isPending || elwVerloren.isPending;
                return (
                  <ListenEintrag
                    actions={
                      isAdmin && eintraege.length > 0
                        ? [
                            <MenueAusloeser
                              key="aktionen"
                              gesperrt={laeuft}
                              laeuft={laeuft}
                              zugaenglicherName={`Aktionen zur Kopplung mit ${k.gegenueber_name}`}
                              eintraege={eintraege}
                              onWahl={(wahl) => {
                                if (wahl === 'abgleichen') {
                                  stammdatenNeu.mutate(k);
                                } else if (wahl === 'verloren') {
                                  elwVerloren.reset();
                                  setVerlorenKopplung(k);
                                } else {
                                  kopplungWiderrufen.reset();
                                  setWiderrufKopplung(k);
                                }
                              }}
                            />,
                          ]
                        : undefined
                    }
                  >
                    <ListenEintragMeta
                      title={
                        <span data-lfh="instanz-kopplung-titel">
                          {k.gegenueber_name} · {richtungText(k)}
                        </span>
                      }
                      description={
                        <div>
                          <div
                            style={{ color: rollen.gedaempft }}
                            data-lfh="instanz-kopplung-zustand"
                          >
                            {kopplungZustandZeile(k, zeit)}
                          </div>
                          <div style={{ ...monoStil(12), color: rollen.gedaempft }}>
                            {k.gegenueber_fingerabdruck}
                            {k.gegenueber_adresse ? ` · ${k.gegenueber_adresse}` : ''}
                          </div>
                          {stammdaten && (
                            <div
                              style={{ color: rollen.gedaempft }}
                              data-lfh="instanz-kopplung-stammdaten"
                            >
                              {stammdaten}
                            </div>
                          )}
                          {hinweise.map((h) => (
                            <div
                              key={h}
                              style={{ color: rollen.achtungText }}
                              data-lfh="instanz-kopplung-hinweis"
                            >
                              {h}
                            </div>
                          ))}
                        </div>
                      }
                    />
                  </ListenEintrag>
                );
              }}
            />
          </Paneel>

          <Paneel
            titel="Unterschriftsschlüssel"
            meta={u.schluessel.length}
            koerperPolster
            style={{ marginBlockStart: token.marginMD }}
            aktion={
              isAdmin && u.passkeys_eingerichtet ? (
                <Button
                  icon={<IconPlus />}
                  onClick={() => setRegistrierenOffen(true)}
                  data-lfh="instanz-schluessel-registrieren"
                >
                  Eigenen registrieren
                </Button>
              ) : undefined
            }
          >
            <Typography.Paragraph style={{ color: rollen.gedaempft }}>
              Ein Passkey nur zum Unterschreiben, nicht zur Anmeldung. Gekoppelte Instanzen prüfen
              damit Erklärungen eines Admins, etwa eine Notübernahme. Zwei Schlüssel je
              Organisation, damit einer verloren gehen darf.
            </Typography.Paragraph>
            <Liste<UnterschriftSchluesselAnzeige>
              bordered
              dataSource={u.schluessel}
              rowKey={(s) => s.id}
              emptyText="Noch kein Unterschriftsschlüssel"
              renderItem={(s) => {
                const eintraege: MenueEintrag[] = [];
                if (s.zustand === 'wartet_auf_gegenzeichnung' && u.eigener_schluessel) {
                  eintraege.push({ key: 'gegenzeichnen', label: 'Gegenzeichnen' });
                }
                if (s.herkunft === 'lokal' && s.zustand !== 'widerrufen') {
                  eintraege.push({
                    key: 'widerrufen',
                    icon: <IconKreuz />,
                    label: 'Widerrufen …',
                    gefahr: true,
                  });
                }
                return (
                  <ListenEintrag
                    actions={
                      isAdmin && eintraege.length > 0
                        ? [
                            <MenueAusloeser
                              key="aktionen"
                              gesperrt={gegenzeichnen.isPending || schluesselWiderrufen.isPending}
                              laeuft={gegenzeichnen.isPending}
                              zugaenglicherName={`Aktionen zum Schlüssel ${s.bezeichnung} von ${s.benutzer_name}`}
                              eintraege={eintraege}
                              onWahl={(key) => {
                                if (key === 'gegenzeichnen') {
                                  gegenzeichnen.mutate(s);
                                } else {
                                  schluesselWiderrufen.reset();
                                  setWiderrufSchluessel(s);
                                }
                              }}
                            />,
                          ]
                        : undefined
                    }
                  >
                    <ListenEintragMeta
                      title={
                        <span data-lfh="instanz-schluessel-titel">
                          {s.benutzer_name} · {s.bezeichnung}
                        </span>
                      }
                      description={
                        <div>
                          <div style={{ color: rollen.gedaempft }}>{schluesselZeile(s, zeit)}</div>
                          <div style={{ ...monoStil(12), color: rollen.gedaempft }}>
                            {s.fingerabdruck}
                          </div>
                        </div>
                      }
                    />
                  </ListenEintrag>
                );
              }}
            />
            <SpeicherFehler fehler={gegenzeichnen.error} titel="Nicht gegengezeichnet" />
          </Paneel>
        </>
      )}

      <ErfassungsModal<EinloesenWerte>
        offen={einloesenOffen}
        titel="Code einlösen"
        form={einloesenForm}
        erfassenText="Koppeln"
        laeuft={einloesen.isPending}
        onErfassen={(w) =>
          einloesen.mutateAsync({
            adresse: (w.adresse ?? '').trim(),
            code: (w.code ?? '').trim(),
          })
        }
        onFertig={() => setEinloesenOffen(false)}
        onAbbrechen={() => {
          einloesen.reset();
          setEinloesenOffen(false);
        }}
      >
        <Form.Item
          label="Adresse der anderen Instanz"
          name="adresse"
          rules={[{ required: true, whitespace: true, message: 'Adresse angeben' }]}
        >
          <Input placeholder="https://hub.example.org" inputMode="url" />
        </Form.Item>
        <Form.Item
          label="Kopplungscode"
          name="code"
          rules={[{ required: true, whitespace: true, message: 'Code angeben' }]}
        >
          <Input placeholder="ABCD-EFGH-JKMN-PQRS" style={monoStil(14)} autoComplete="off" />
        </Form.Item>
        <SpeicherFehler fehler={einloesen.error} titel="Nicht gekoppelt" />
      </ErfassungsModal>

      <ErfassungsModal<RegistrierenWerte>
        offen={registrierenOffen}
        titel="Unterschriftsschlüssel registrieren"
        form={registrierenForm}
        erfassenText="Registrieren"
        laeuft={registrieren.isPending}
        onErfassen={(w) => registrieren.mutateAsync((w.bezeichnung ?? '').trim())}
        onFertig={() => setRegistrierenOffen(false)}
        onAbbrechen={() => {
          registrieren.reset();
          setRegistrierenOffen(false);
        }}
      >
        <Form.Item
          label="Bezeichnung"
          name="bezeichnung"
          rules={[
            { required: true, whitespace: true, message: 'Bezeichnung angeben' },
            { max: BEZEICHNUNG_MAX, message: `Höchstens ${BEZEICHNUNG_MAX} Zeichen` },
          ]}
        >
          <Input placeholder="Sicherheitsschlüssel blau" maxLength={BEZEICHNUNG_MAX} />
        </Form.Item>
        <SpeicherFehler fehler={registrieren.error} titel="Nicht registriert" />
      </ErfassungsModal>

      <Modal
        open={neuerCode != null}
        title="Kopplungscode"
        // Der Code kommt nie wieder vom Server: kein Schließen per Klick daneben oder Escape.
        mask={{ closable: false }}
        keyboard={false}
        footer={
          <Button type="primary" onClick={() => setNeuerCode(null)}>
            Fertig
          </Button>
        }
        onCancel={() => setNeuerCode(null)}
        destroyOnHidden
      >
        {neuerCode && (
          <div data-lfh="instanz-code">
            <p>
              Nur jetzt sichtbar, gültig bis {zeit(neuerCode.laeuft_ab_at)}, einmal einlösbar. An
              der anderen Instanz unter „Code einlösen“ mit dieser Adresse eingeben:
            </p>
            <div style={{ marginBlockEnd: token.marginSM }}>
              <KopierbarerText text={neuerCode.code} bezeichnung="Code">
                <span style={{ ...monoStil(20, 500) }} data-lfh="instanz-code-text">
                  {neuerCode.code}
                </span>
              </KopierbarerText>
            </div>
            <KopierbarerText text={window.location.origin} bezeichnung="Adresse">
              <Typography.Text style={{ color: rollen.gedaempft, wordBreak: 'break-all' }}>
                {window.location.origin}
              </Typography.Text>
            </KopierbarerText>
            <p style={{ marginBlockStart: token.marginSM }}>
              Nach dem Koppeln zeigt die andere Instanz diesen Fingerabdruck. Er muss gleich sein:
            </p>
            <span style={monoStil(13)}>{neuerCode.fingerabdruck}</span>
          </div>
        )}
      </Modal>

      <Modal
        open={widerrufKopplung != null}
        title={
          widerrufKopplung ? `Kopplung mit ${widerrufKopplung.gegenueber_name} widerrufen?` : ''
        }
        okText="Widerrufen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: kopplungWiderrufen.isPending }}
        onOk={() => widerrufKopplung && kopplungWiderrufen.mutate(widerrufKopplung)}
        // Solange der Widerruf läuft, führt kein Weg hinaus: ein Fehlschlag ginge sonst still verloren.
        onCancel={() => {
          if (!kopplungWiderrufen.isPending) setWiderrufKopplung(null);
        }}
        cancelButtonProps={{ disabled: kopplungWiderrufen.isPending }}
        closable={kopplungWiderrufen.isPending ? { disabled: true } : true}
        mask={{ closable: !kopplungWiderrufen.isPending }}
        keyboard={!kopplungWiderrufen.isPending}
        destroyOnHidden
      >
        <p>
          Die eigene Organisation wird aus der Kopplung genommen. Die andere Instanz erfährt es,
          sobald eine Meldung durchgeht; ein neuer Code koppelt wieder.
        </p>
        <SpeicherFehler fehler={kopplungWiderrufen.error} titel="Nicht widerrufen" />
      </Modal>

      <Modal
        open={verlorenKopplung != null}
        title={verlorenKopplung ? `${verlorenKopplung.gegenueber_name} als verloren melden?` : ''}
        okText="Als verloren melden"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: elwVerloren.isPending }}
        onOk={() => verlorenKopplung && elwVerloren.mutate(verlorenKopplung)}
        // Solange die Meldung läuft, führt kein Weg hinaus: ein Fehlschlag ginge sonst still verloren.
        onCancel={() => {
          if (!elwVerloren.isPending) setVerlorenKopplung(null);
        }}
        cancelButtonProps={{ disabled: elwVerloren.isPending }}
        closable={elwVerloren.isPending ? { disabled: true } : true}
        mask={{ closable: !elwVerloren.isPending }}
        keyboard={!elwVerloren.isPending}
        destroyOnHidden
      >
        <p>
          Die Kopplung wird für die eigene Organisation widerrufen.
          {verlorenKopplung && verlorenKopplung.org.stammdaten.konten_mit_geheimnis > 0
            ? ` Die ${verlorenKopplung.org.stammdaten.konten_mit_geheimnis} Konten, deren Passwort dort lag, verlieren Passwort und zweiten Faktor, ihre Sitzungen enden.`
            : ' Dort lagen keine Passwörter der eigenen Organisation.'}
        </p>
        <p>
          Wieder hinein kommt man per Passkey oder mit einem Einmalpasswort aus der
          Benutzerverwaltung.
        </p>
        <SpeicherFehler fehler={elwVerloren.error} titel="Nicht gemeldet" />
      </Modal>

      <Modal
        open={widerrufSchluessel != null}
        title={
          widerrufSchluessel
            ? `Schlüssel ${widerrufSchluessel.bezeichnung} von ${widerrufSchluessel.benutzer_name} widerrufen?`
            : ''
        }
        okText="Widerrufen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: schluesselWiderrufen.isPending }}
        onOk={() => widerrufSchluessel && schluesselWiderrufen.mutate(widerrufSchluessel)}
        // Solange der Widerruf läuft, führt kein Weg hinaus: ein Fehlschlag ginge sonst still verloren.
        onCancel={() => {
          if (!schluesselWiderrufen.isPending) setWiderrufSchluessel(null);
        }}
        cancelButtonProps={{ disabled: schluesselWiderrufen.isPending }}
        closable={schluesselWiderrufen.isPending ? { disabled: true } : true}
        mask={{ closable: !schluesselWiderrufen.isPending }}
        keyboard={!schluesselWiderrufen.isPending}
        destroyOnHidden
      >
        <p>Gekoppelte Instanzen nehmen keine Unterschrift mit diesem Schlüssel mehr an.</p>
        <SpeicherFehler fehler={schluesselWiderrufen.error} titel="Nicht widerrufen" />
      </Modal>
    </AdminPage>
  );
}
