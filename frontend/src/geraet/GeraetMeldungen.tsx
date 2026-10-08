import { Alert, App, Form, Input, Space, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ETB_INHALT_MAX } from '../api/eingabegrenzen';
import { useAuth } from '../auth/AuthContext';
import { listeMeldungen } from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type { Meldung, MeldungPrioritaet, NeueMeldung } from '../api/types';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { ErfassungsFormular } from '../components/Erfassung';
import { Paneel, Segmentleiste } from '../components/instrument';
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import MeldungKarte from '../meldungen/MeldungKarte';
import { erfasseMeldungOfflineFaehig } from '../offline/schreiben';
import { serverJetzt } from '../offline/serveruhr';

const PRIORITAETEN: readonly { wert: MeldungPrioritaet; label: string }[] = [
  { wert: 'normal', label: 'normal' },
  { wert: 'dringend', label: 'dringend' },
  { wert: 'sofort', label: 'sofort' },
];

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
 * Meldung an die Einsatzleitung und die eigenen Meldungen eines stellengebundenen Geräts
 * (Scope-Matrix: anlegen, eigene lesen; UHS-Laptop und Bereitstellungsraum). Absender ist die
 * Stelle; Meldeweg, Art und Ereigniszeit setzt das Gerät, denn an der Stelle gibt es keinen
 * Funkspruch abzuschreiben. Ohne Netz merkt die Warteschlange die Meldung vor.
 */
export default function GeraetMeldungen({
  einsatzId,
  stelle,
  schreibgeschuetzt,
}: {
  einsatzId: number;
  /** Bezeichnung der Stelle, erster Teil des Absenders. */
  stelle: string;
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
        message.warning('Offline vorgemerkt');
        return;
      }
      qc.invalidateQueries({ queryKey: einsatzKeys.meldungen(einsatzId) });
      message.success(`Meldung #${ergebnis.daten.lfd_nr} gesendet`);
    },
    onError: fehler,
  });

  const absender = [stelle, geraet?.bezeichnung].filter(Boolean).join(' · ');
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
        <Paneel titel="Meldung an die Einsatzleitung" koerperPolster>
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
              <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} maxLength={ETB_INHALT_MAX} />
            </Form.Item>
            <Form.Item<MeldungWerte> name="prioritaet" label="Priorität">
              <PrioritaetFeld />
            </Form.Item>
          </ErfassungsFormular>
        </Paneel>
      )}
      <Paneel titel="Eigene Meldungen" koerperPolster>
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
