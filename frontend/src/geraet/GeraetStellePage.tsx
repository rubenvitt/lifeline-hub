import { useId, useState } from 'react';
import { Alert, App, Button, Form, Input, Space, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { IconKachelraster } from '../icons';
import { useAuth } from '../auth/AuthContext';
import { ladeEinsatz } from '../api/einsaetze';
import { ladeUhs } from '../api/einsatzUhs';
import { listePersonen } from '../api/einsatzPerson';
import { listeMeldungen } from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type { Meldung, MeldungPrioritaet, NeueMeldung, Person, UhsDetail } from '../api/types';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { ErfassungsFormular } from '../components/Erfassung';
import { Kennzahl, Kennzahlenband, Paneel, Segmentleiste } from '../components/instrument';
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import MeldungKarte from '../meldungen/MeldungKarte';
import { erfasseMeldungOfflineFaehig } from '../offline/schreiben';
import { serverJetzt } from '../offline/serveruhr';
import MaterialTab from '../pages/uhs/MaterialTab';
import UhsAnhaenge from '../pages/uhs/UhsAnhaenge';
import { geraetUhsPfad } from '../routing/deeplinks';

const BEREICH_NAME = {
  plaetze: 'Plätze',
  material: 'Material',
  meldungen: 'Meldungen',
  dateien: 'Dateien',
} as const;
type Bereich = keyof typeof BEREICH_NAME;
const BEREICHE = Object.keys(BEREICH_NAME) as Bereich[];

const PRIORITAETEN: readonly { wert: MeldungPrioritaet; label: string }[] = [
  { wert: 'normal', label: 'normal' },
  { wert: 'dringend', label: 'dringend' },
  { wert: 'sofort', label: 'sofort' },
];

/** Belegung der Plätze in Zahlen: belegt zählt die Personen auf einem Platz, nicht die Karten. */
export function platzZahlen(uhs: UhsDetail, belegtePlatzIds: ReadonlySet<number>) {
  const plaetze = uhs.plaetze.filter((p) => !p.storniert_at && p.typ !== 'wartebereich');
  const belegt = plaetze.filter((p) => belegtePlatzIds.has(p.id)).length;
  const nichtVerfuegbar = plaetze.filter(
    (p) => !belegtePlatzIds.has(p.id) && p.verfuegbarkeit !== 'frei',
  ).length;
  return {
    gesamt: plaetze.length,
    belegt,
    frei: plaetze.length - belegt - nichtVerfuegbar,
    nichtVerfuegbar,
  };
}

/** Belegte Plätze wie im Grundriss: der aktuelle Platz jeder Person in dieser UHS. */
function belegtePlaetze(uhs: UhsDetail, personen: readonly Person[]): Set<number> {
  const ids = new Set<number>();
  for (const p of personen) {
    if (!p.storniert_at && p.aktuelle_uhs_id === uhs.id && p.aktueller_platz_id != null) {
      ids.add(p.aktueller_platz_id);
    }
  }
  return ids;
}

function PlaetzeBereich({ einsatzId, uhs }: { einsatzId: number; uhs: UhsDetail }) {
  const navigate = useNavigate();
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
  });
  const zustand = personenQuery.isError ? 'fehler' : personenQuery.isLoading ? 'laden' : 'daten';
  const z = platzZahlen(uhs, belegtePlaetze(uhs, personenQuery.data ?? []));
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Kennzahlenband beschriftung="Plätze in Zahlen">
        <Kennzahl titel="Plätze" wert={z.gesamt} />
        <Kennzahl
          titel="Belegt"
          wert={z.belegt}
          zustand={zustand}
          ton={z.belegt > 0 ? 'bedien' : 'neutral'}
        />
        <Kennzahl titel="Frei" wert={z.frei} zustand={zustand} ton="normal" />
        <Kennzahl
          titel="Nicht verfügbar"
          wert={z.nichtVerfuegbar}
          zustand={zustand}
          ton={z.nichtVerfuegbar > 0 ? 'achtung' : 'neutral'}
        />
      </Kennzahlenband>
      <Button
        icon={<IconKachelraster />}
        onClick={() => navigate(geraetUhsPfad(einsatzId, uhs.id))}
      >
        Grundriss bearbeiten
      </Button>
    </Space>
  );
}

interface MeldungWerte {
  inhalt: string;
  prioritaet: MeldungPrioritaet;
}

const MELDUNG_START: MeldungWerte = { inhalt: '', prioritaet: 'normal' };

/** Segmentleiste als Formularfeld (`value`/`onChange` von `Form.Item`). */
function PrioritaetFeld({
  value = 'normal',
  onChange,
}: {
  value?: MeldungPrioritaet;
  onChange?: (wert: MeldungPrioritaet) => void;
}) {
  return (
    <Segmentleiste
      beschriftung="Priorität"
      wert={value}
      onWechsel={(w) => onChange?.(w)}
      optionen={PRIORITAETEN}
    />
  );
}

/**
 * Meldung an die Einsatzleitung und die eigenen Meldungen (Scope-Matrix: anlegen, eigene lesen).
 * Absender ist die Stelle; Meldeweg, Art und Ereigniszeit setzt das Gerät, denn am Laptop der UHS
 * gibt es keinen Funkspruch abzuschreiben. Ohne Netz merkt die Warteschlange die Meldung vor.
 */
function MeldungenBereich({
  einsatzId,
  uhs,
  schreibgeschuetzt,
}: {
  einsatzId: number;
  uhs: UhsDetail;
  schreibgeschuetzt: boolean;
}) {
  const { benutzer, geraet } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const fehler = useFehlerMeldung();
  const [form] = Form.useForm<MeldungWerte>();

  const meldungenQuery = useQuery({
    queryKey: einsatzKeys.meldungen(einsatzId),
    queryFn: () => listeMeldungen(einsatzId),
  });

  const senden = useMutation({
    // Wie `MeldungenPage`: die Funktion merkt ohne Netz selbst vor (LFH-705).
    networkMode: 'always',
    mutationFn: (d: NeueMeldung) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfasseMeldungOfflineFaehig(benutzer.id, einsatzId, d);
    },
    // Leeren übernimmt `ErfassungsFormular`, und nur nach Erfolg; abgelehnt bleibt der Wortlaut.
    onSuccess: (ergebnis) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        message.warning('Offline vorgemerkt — Meldung wird bei Verbindung gesendet');
        return;
      }
      qc.invalidateQueries({ queryKey: einsatzKeys.meldungen(einsatzId) });
      message.success(`Meldung #${ergebnis.daten.lfd_nr} gesendet`);
    },
    onError: fehler,
  });

  const absender = [uhs.bezeichnung, geraet?.bezeichnung].filter(Boolean).join(' · ');
  const absenden = (w: MeldungWerte) =>
    senden.mutateAsync({
      absender,
      empfaenger: 'Einsatzleitung',
      meldeweg: 'sonstige',
      meldungsart: w.prioritaet === 'sofort' ? 'sofortmeldung' : 'sonstige',
      prioritaet: w.prioritaet,
      inhalt: w.inhalt.trim(),
      ereigniszeit: alsBackendZeit(serverJetzt()),
    });

  const meldungen: Meldung[] = [...(meldungenQuery.data ?? [])].sort((a, b) =>
    (b.ereigniszeit ?? '').localeCompare(a.ereigniszeit ?? ''),
  );

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {!schreibgeschuetzt && (
        <Paneel titel="Meldung an die Einsatzleitung">
          <ErfassungsFormular<MeldungWerte>
            form={form}
            initialValues={MELDUNG_START}
            onErfassen={absenden}
            // Inline: nach dem Senden bleibt das Formular stehen, leer, für die nächste Meldung.
            onFertig={() => {}}
            laeuft={senden.isPending}
            erfassenText="Meldung senden"
          >
            <Form.Item<MeldungWerte>
              name="inhalt"
              label="Inhalt"
              rules={[{ required: true, whitespace: true, message: 'Bitte den Inhalt eingeben' }]}
            >
              <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
            </Form.Item>
            <Form.Item<MeldungWerte> name="prioritaet" label="Priorität">
              <PrioritaetFeld />
            </Form.Item>
          </ErfassungsFormular>
        </Paneel>
      )}
      <Paneel titel="Eigene Meldungen">
        {meldungenQuery.isError ? (
          <Alert type="error" showIcon title="Meldungen konnten nicht geladen werden" />
        ) : meldungenQuery.isLoading ? (
          <Spin />
        ) : meldungen.length === 0 ? (
          <span>Noch keine Meldungen von dieser Stelle</span>
        ) : (
          <Space orientation="vertical" style={{ width: '100%' }}>
            {meldungen.map((m) => (
              <MeldungKarte key={m.id} meldung={m} einsatzId={einsatzId} />
            ))}
          </Space>
        )}
      </Paneel>
    </Space>
  );
}

/**
 * Bereich „UHS“ des UHS-Laptops (LFH-892, Subtask LFH-1025; Spec `feldgeraet-bedienung`): Plätze
 * in Zahlen mit dem Weg in den Grundriss, Material der eigenen UHS zum Lesen, Meldungen an die
 * Einsatzleitung und die Dateien der UHS. Der Grundriss selbst bleibt der eigene Bereich.
 */
export default function GeraetStellePage() {
  const { geraet, benutzer } = useAuth();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const uhsId = geraet?.uhs_id ?? null;
  const [bereich, setBereich] = useState<Bereich>('plaetze');
  const feld = useId();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: geraet != null,
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhsDetail(einsatzId, uhsId ?? 0),
    queryFn: () => ladeUhs(einsatzId, uhsId!),
    enabled: geraet != null && uhsId != null,
  });
  const uhs = uhsQuery.data;
  const schreibgeschuetzt = !darfImEinsatzSchreiben(einsatzQuery.data, benutzer);

  return (
    <EinsatzSeite
      titel="UHS"
      meta={uhs?.bezeichnung}
      dataUpdatedAt={gemeinsamerDatenstand(einsatzQuery.dataUpdatedAt, uhsQuery.dataUpdatedAt)}
    >
      {uhsQuery.isError ? (
        <Alert type="error" showIcon title="UHS konnte nicht geladen werden" />
      ) : !uhs ? (
        <Spin />
      ) : (
        <>
          <Segmentleiste
            rolle="tablist"
            beschriftung="Plätze, Material, Meldungen und Dateien"
            wert={bereich}
            onWechsel={setBereich}
            optionen={BEREICHE.map((b) => ({ wert: b, label: BEREICH_NAME[b], steuert: feld }))}
            style={{ marginBottom: 12 }}
          />
          <div role="tabpanel" id={feld} aria-label={BEREICH_NAME[bereich]}>
            {bereich === 'plaetze' ? (
              <PlaetzeBereich einsatzId={einsatzId} uhs={uhs} />
            ) : bereich === 'material' ? (
              <MaterialTab einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt />
            ) : bereich === 'meldungen' ? (
              <MeldungenBereich
                einsatzId={einsatzId}
                uhs={uhs}
                schreibgeschuetzt={schreibgeschuetzt}
              />
            ) : (
              <UhsAnhaenge
                einsatzId={einsatzId}
                uhs={uhs}
                darfSchreiben={!schreibgeschuetzt}
                zeigeZugriffe={false}
              />
            )}
          </div>
        </>
      )}
    </EinsatzSeite>
  );
}
