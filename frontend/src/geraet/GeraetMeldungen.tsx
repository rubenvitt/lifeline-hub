import { Alert, App, Form, Input, Space, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ETB_INHALT_MAX } from '../api/eingabegrenzen';
import { useAuth } from '../auth/AuthContext';
import { listeMeldungen } from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type { Meldung, MeldungPrioritaet, NeueMeldung } from '../api/types';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { ErfassungsFormular } from '../components/Erfassung';
import { Paneel, Segmentleiste } from '../components/instrument';
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
 * Meldung an die Einsatzleitung und die eigenen Meldungen eines Geräts (Scope-Matrix: anlegen,
 * eigene lesen; UHS-Laptop und Abschnittsgerät). Absender ist die Stelle; Meldeweg, Art und
 * Ereigniszeit setzt das Gerät, denn dort gibt es keinen Funkspruch abzuschreiben. Den
 * strukturierten Absender setzt beim Abschnittsgerät der Server. Ohne Netz merkt die
 * Warteschlange die Meldung vor.
 *
 * `vorbelegung` füllt den Inhalt (etwa die Fehlmenge aus der Verpflegung, LFH-1044) — bewusst
 * per `setFieldsValue` statt `initialValues`: die Hülle setzt nach dem Senden darauf zurück, die
 * Meldung stünde sonst sofort wieder da (Muster `NachforderungFormular`).
 */
export default function GeraetMeldungen({
  einsatzId,
  absender,
  schreibgeschuetzt,
  vorbelegung,
}: {
  einsatzId: number;
  /** Absender als Freitext, z. B. „UHS Nord · Laptop 1“. */
  absender: string;
  schreibgeschuetzt: boolean;
  /** Vorbelegter Inhalt; die Seite hält ihn identitätsstabil. */
  vorbelegung?: string | null;
}) {
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<MeldungWerte>();

  // Erst mit eingehängtem Formular: ohne Schreibrecht (oder solange es unbekannt ist) fehlt es.
  useEffect(() => {
    if (!vorbelegung || schreibgeschuetzt) return;
    form.setFieldsValue({ inhalt: vorbelegung });
  }, [form, vorbelegung, schreibgeschuetzt]);

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
    // Leeren übernimmt `ErfassungsFormular`, und nur nach Erfolg; abgelehnt bleibt der Wortlaut,
    // und der Grund steht über „Meldung senden“ (`speicherung`, LFH-1077). Kein `onError`-Toast:
    // Netz- und Leitungsfehler merkt die Funktion vor, nur eine fachliche Ablehnung kommt an.
    onSuccess: (ergebnis) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        message.warning('Offline vorgemerkt');
        return;
      }
      qc.invalidateQueries({ queryKey: einsatzKeys.meldungen(einsatzId) });
      message.success(`Meldung #${ergebnis.daten.lfd_nr} gesendet`);
    },
  });

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
            speicherung={senden}
            speicherFehlerTitel="Meldung nicht gesendet"
            speicherFehlerFallback="Senden fehlgeschlagen"
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
