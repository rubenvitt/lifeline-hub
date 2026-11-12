import { useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconHaken, IconKreuz, IconPlus } from '../../icons';
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
  entferneArchivSchluessel,
  ladeArchivSchluessel,
  pruefeArchivSchluessel,
  trageArchivSchluesselEin,
} from '../../api/archivSchluessel';
import { ARCHIV_SCHLUESSEL_BEZEICHNUNG_MAX, ARCHIV_SCHLUESSEL_MAX } from '../../api/eingabegrenzen';
import { globalKeys } from '../../api/queryKeys';
import type { ArchivEmpfaengerAnzeige } from '../../api/types';

interface EintragenWerte {
  bezeichnung?: string;
  schluessel?: string;
}

interface ProbeWerte {
  code?: string;
}

/** Was gerade geprüft wird: der Schlüssel und, direkt nach dem Eintragen, seine Probe. */
interface Probe {
  empfaenger: ArchivEmpfaengerAnzeige;
  probe?: string;
}

/** Zustandszeile eines Schlüssels, rein und exportiert für den Test. */
export function schluesselZustand(
  s: ArchivEmpfaengerAnzeige,
  zeit: (wert: string) => string,
): string {
  const zustand = s.geprueft_at
    ? `geprüft ${zeit(s.geprueft_at)}`
    : s.gesperrt
      ? 'Probe gesperrt'
      : 'Probe offen';
  return `${s.fingerabdruck} · ${zustand}`;
}

/**
 * Admin-Sektion `/admin/einstellungen/archiv-schluessel` — öffentliche age-Schlüssel, an die
 * der Hub einen Einsatz am Ende der Nachbereitung verschlüsselt (LLH-1494). Nur der System-Admin.
 *
 * Ein Schlüssel gilt erst nach der Probe: der Server verschlüsselt einen Code an ihn, und wer
 * den Code eingibt, hat den privaten Schlüssel. Die Probe steht nur im Dialog nach dem Eintragen;
 * wer ihn schließt, gibt den Code später über das Zeilenmenü ein. Nach fünf Fehlversuchen ist die
 * Probe gesperrt, dann bleibt nur Entfernen und neu eintragen.
 */
export default function ArchivSchluessel() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const [eintragenOffen, setEintragenOffen] = useState(false);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [entfernenFuer, setEntfernenFuer] = useState<ArchivEmpfaengerAnzeige | null>(null);
  const [eintragenForm] = Form.useForm<EintragenWerte>();
  const [probeForm] = Form.useForm<ProbeWerte>();

  const liste = useQuery({
    queryKey: globalKeys.orgArchivSchluessel(),
    queryFn: ladeArchivSchluessel,
    enabled: istAdmin,
  });

  const setzeListe = (neu: (alt: ArchivEmpfaengerAnzeige[]) => ArchivEmpfaengerAnzeige[]) =>
    qc.setQueryData<ArchivEmpfaengerAnzeige[]>(globalKeys.orgArchivSchluessel(), (alt) =>
      neu(alt ?? []),
    );
  const uebernimm = (s: ArchivEmpfaengerAnzeige) =>
    setzeListe((alt) =>
      alt.some((x) => x.id === s.id) ? alt.map((x) => (x.id === s.id ? s : x)) : [...alt, s],
    );

  const eintragen = useMutation({
    mutationFn: (w: { schluessel: string; bezeichnung: string }) =>
      trageArchivSchluesselEin(w.schluessel, w.bezeichnung),
    onSuccess: (antwort) => {
      uebernimm(antwort.empfaenger);
      setProbe({ empfaenger: antwort.empfaenger, probe: antwort.probe });
    },
  });
  const pruefen = useMutation({
    mutationFn: (w: { id: number; code: string }) => pruefeArchivSchluessel(w.id, w.code),
    onSuccess: uebernimm,
    // Ein Fehlversuch zählt am Server; nach dem letzten ist die Probe gesperrt.
    onError: () => void qc.invalidateQueries({ queryKey: globalKeys.orgArchivSchluessel() }),
  });
  const entfernen = useMutation({
    mutationFn: (s: ArchivEmpfaengerAnzeige) => entferneArchivSchluessel(s.id),
    onSuccess: (_, s) => {
      setzeListe((alt) => alt.filter((x) => x.id !== s.id));
      setEntfernenFuer(null);
      message.success(`${s.bezeichnung} entfernt`);
    },
  });

  const schluessel = liste.data ?? [];
  const geprueft = schluessel.filter((s) => s.geprueft_at != null).length;
  const zeit = (wert: string) => zeitKurz(wert, konv);

  /** Aktionen eines Schlüssels, EINE Quelle für ⋮ und Kontextmenü (LLH-1599, design.md D3). */
  const menue: WeitereAktionen<ArchivEmpfaengerAnzeige> | undefined = istAdmin
    ? {
        eintraege: (s) => [
          ...(s.geprueft_at || s.gesperrt
            ? []
            : [{ key: 'pruefen', icon: <IconHaken />, label: 'Code eingeben …' }]),
          { key: 'entfernen', icon: <IconKreuz />, label: 'Entfernen …', gefahr: true },
        ],
        zugaenglicherName: (s) => `Aktionen zu Archiv-Schlüssel ${s.bezeichnung}`,
        laeuft: () => entfernen.isPending,
        onWahl: (key, s) => {
          if (key === 'pruefen') {
            pruefen.reset();
            setProbe({ empfaenger: s });
          } else {
            entfernen.reset();
            setEntfernenFuer(s);
          }
        },
      }
    : undefined;
  const kontext = useZeilenMenueKontext(menue, {
    finde: (id) => schluessel.find((s) => s.id === id),
    schluessel: (s) => s.id,
  });

  const letzterGeprueft = entfernenFuer?.geprueft_at != null && geprueft === 1;

  return (
    <AdminPage
      titel="Archiv-Schlüssel"
      breite="schmal"
      aktionen={
        istAdmin && (
          <Button
            type="primary"
            icon={<IconPlus />}
            disabled={schluessel.length >= ARCHIV_SCHLUESSEL_MAX}
            onClick={() => setEintragenOffen(true)}
          >
            Schlüssel eintragen
          </Button>
        )
      }
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={NUR_ADMIN} />}
    >
      {istAdmin && liste.isSuccess && geprueft < 2 && (
        <Alert
          type="warning"
          showIcon
          data-lfh="archiv-schluessel-warnung"
          style={{ marginBlockEnd: token.marginSM }}
          title={
            geprueft === 0 ? 'Ohne geprüften Schlüssel kein Archiv' : 'Nur ein geprüfter Schlüssel'
          }
        />
      )}
      <Paneel
        titel="Schlüssel"
        meta={liste.isSuccess ? schluessel.length : undefined}
        koerperPolster
      >
        {!istAdmin ? null : liste.isLoading ? (
          <Spin />
        ) : liste.isError ? (
          <Alert type="error" title="Archiv-Schlüssel nicht ladbar" showIcon />
        ) : (
          <Liste<ArchivEmpfaengerAnzeige>
            bordered
            dataSource={schluessel}
            rowKey={(s) => s.id}
            emptyText="Noch kein Archiv-Schlüssel"
            renderItem={(s) => (
              <div data-lfh="archiv-schluessel-eintrag" {...(menue ? kontext.ausloeser(s) : {})}>
                <ListenEintrag
                  actions={
                    menue
                      ? [<ZeilenMenueAusloeser key="aktionen" menue={menue} zeile={s} />]
                      : undefined
                  }
                >
                  <ListenEintragMeta
                    title={<span data-lfh="archiv-schluessel-titel">{s.bezeichnung}</span>}
                    description={
                      <span
                        style={{ ...monoStil(13), color: rollen.gedaempft }}
                        data-lfh="archiv-schluessel-zustand"
                      >
                        {schluesselZustand(s, zeit)}
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

      <ErfassungsModal<EintragenWerte>
        offen={eintragenOffen}
        titel="Archiv-Schlüssel eintragen"
        form={eintragenForm}
        erfassenText="Eintragen"
        speicherung={eintragen}
        speicherFehlerTitel="Nicht eingetragen"
        onErfassen={(w) =>
          eintragen.mutateAsync({
            schluessel: (w.schluessel ?? '').trim(),
            bezeichnung: (w.bezeichnung ?? '').trim(),
          })
        }
        onFertig={() => setEintragenOffen(false)}
        onAbbrechen={() => setEintragenOffen(false)}
      >
        <Form.Item
          label="Bezeichnung"
          name="bezeichnung"
          rules={[
            { required: true, whitespace: true, message: 'Bezeichnung angeben' },
            {
              max: ARCHIV_SCHLUESSEL_BEZEICHNUNG_MAX,
              message: `Höchstens ${ARCHIV_SCHLUESSEL_BEZEICHNUNG_MAX} Zeichen`,
            },
          ]}
        >
          <Input placeholder="Tresor Kreisverband" maxLength={ARCHIV_SCHLUESSEL_BEZEICHNUNG_MAX} />
        </Form.Item>
        <Form.Item
          label="Öffentlicher Schlüssel"
          name="schluessel"
          rules={[{ required: true, whitespace: true, message: 'Schlüssel angeben' }]}
        >
          <Input placeholder="age1…" spellCheck={false} autoComplete="off" style={monoStil(14)} />
        </Form.Item>
      </ErfassungsModal>

      <ErfassungsModal<ProbeWerte>
        offen={probe != null}
        titel={probe ? `Probe für ${probe.empfaenger.bezeichnung}` : 'Probe'}
        form={probeForm}
        erfassenText="Prüfen"
        speicherung={pruefen}
        speicherFehlerTitel="Nicht geprüft"
        onErfassen={(w) =>
          probe
            ? pruefen.mutateAsync({ id: probe.empfaenger.id, code: (w.code ?? '').trim() })
            : Promise.resolve()
        }
        onFertig={() => {
          if (probe) message.success(`${probe.empfaenger.bezeichnung} geprüft`);
          setProbe(null);
        }}
        onAbbrechen={() => setProbe(null)}
      >
        {probe?.probe && (
          <div data-lfh="archiv-schluessel-probe" style={{ marginBlockEnd: token.marginSM }}>
            <KopierbarerText text={probe.probe} bezeichnung="Probe">
              <pre style={{ ...monoStil(12), margin: 0, overflowX: 'auto' }}>{probe.probe}</pre>
            </KopierbarerText>
          </div>
        )}
        <Form.Item
          label="Code"
          name="code"
          rules={[{ required: true, whitespace: true, message: 'Code angeben' }]}
        >
          <Input
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            placeholder="8 Ziffern"
            style={{ ...monoStil(14), maxWidth: 200 }}
          />
        </Form.Item>
      </ErfassungsModal>

      <Modal
        open={entfernenFuer != null}
        title={entfernenFuer ? `${entfernenFuer.bezeichnung} entfernen?` : 'Entfernen?'}
        okText="Entfernen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: entfernen.isPending }}
        // Läuft das Entfernen, bleibt der Dialog stehen, bis die Antwort da ist.
        cancelButtonProps={{ disabled: entfernen.isPending }}
        closable={!entfernen.isPending}
        maskClosable={!entfernen.isPending}
        keyboard={!entfernen.isPending}
        onOk={() => entfernenFuer && entfernen.mutate(entfernenFuer)}
        onCancel={() => !entfernen.isPending && setEntfernenFuer(null)}
        destroyOnHidden
      >
        {entfernenFuer && (
          <p style={{ ...monoStil(14), color: rollen.gedaempft }}>{entfernenFuer.fingerabdruck}</p>
        )}
        {letzterGeprueft && <p>Danach archiviert der Hub keine Einsätze mehr.</p>}
        <SpeicherFehler fehler={entfernen.error} titel="Nicht entfernt" />
      </Modal>
    </AdminPage>
  );
}
