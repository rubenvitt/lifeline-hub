import { IconPlus } from '../icons';
import { App, Button, Input, Space, theme } from 'antd';
import { Select } from './Select';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { legeEinsatzSprechgruppeAn, listeEinsatzSprechgruppen } from '../api/sprechgruppen';
import type { Betriebsart, Sprechgruppe } from '../api/types';
import { SpeicherFehler } from './SpeicherHinweis';

interface SprechgruppenPickerProps {
  einsatzId: number;
  /** Ausgewählte Sprechgruppen-IDs (antd-Form-Control-Vertrag). */
  value?: number[];
  onChange?: (ids: number[]) => void;
  /**
   * Für die Auswahl selbst: Kennung, zugänglicher Name, Erstfokus und Popup-Meldung. Die
   * Zeilenbearbeitung (`InlineAngabe`, LFH-849) spreizt hier `feld` und `popup` hinein.
   */
  auswahl?: {
    id?: string;
    'aria-label'?: string;
    autoFocus?: boolean;
    onOpenChange?: (offen: boolean) => void;
  };
}

/**
 * Mehrfachauswahl von Sprechgruppen (org-weiter Katalog + einsatz-lokale) als ein
 * `Select mode="multiple"`, gruppiert nach Betriebsart. Darunter ein kompaktes
 * Inline-Formular zum Anlegen einer einsatz-lokalen Sprechgruppe.
 *
 * Bewusst KEIN verschachteltes `<Form>`/Submit-Button: der Picker wird selbst in einem
 * antd-`<Form>` (Abschnitt/Einheit) gerendert — ein innerer Submit würde das äußere
 * Formular nativ abschicken (Seiten-Reload). Anlegen läuft daher rein über `onClick`.
 */
export default function SprechgruppenPicker({
  einsatzId,
  value = [],
  onChange,
  auswahl,
}: SprechgruppenPickerProps) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [neuBezeichnung, setNeuBezeichnung] = useState('');
  const [neuBetriebsart, setNeuBetriebsart] = useState<Betriebsart | undefined>(undefined);

  const { data: sprechgruppen = [] } = useQuery({
    queryKey: einsatzKeys.sprechgruppen(einsatzId),
    queryFn: () => listeEinsatzSprechgruppen(einsatzId),
  });

  const labelVon = (s: Sprechgruppe) =>
    s.einsatz_lokal ? `${s.bezeichnung} (lokal)` : s.bezeichnung;
  const optionenFuer = (ba: Betriebsart) =>
    sprechgruppen
      .filter((s) => s.betriebsart === ba)
      .map((s) => ({ value: s.id, label: labelVon(s) }));
  const gruppen = [
    { label: 'TMO', title: 'TMO', options: optionenFuer('TMO') },
    { label: 'DMO', title: 'DMO', options: optionenFuer('DMO') },
  ].filter((g) => g.options.length > 0);

  const kannAnlegen = neuBezeichnung.trim().length > 0 && !!neuBetriebsart;

  // Kein `onError`: der Grund steht unter der Zeile, bis zum nächsten Anlegen (LFH-1077).
  const mutation = useMutation({
    mutationFn: (v: { einsatzId: number; bezeichnung: string; betriebsart: Betriebsart }) =>
      legeEinsatzSprechgruppeAn(v.einsatzId, {
        bezeichnung: v.bezeichnung,
        betriebsart: v.betriebsart,
      }),
    onSuccess: (neu: Sprechgruppe, v) => {
      qc.invalidateQueries({ queryKey: einsatzKeys.sprechgruppen(v.einsatzId) });
      onChange?.([...value, neu.id]);
      setNeuBezeichnung('');
      setNeuBetriebsart(undefined);
      setAnlegenOffen(false);
      message.success(`Sprechgruppe „${neu.bezeichnung}" angelegt`);
    },
  });
  // Nur das Anlegen DIESES Einsatzes zählt hier: eine Antwort aus dem vorigen meldet sich nicht.
  const diesesAnlegen = mutation.variables?.einsatzId === einsatzId;
  const laeuft = diesesAnlegen && mutation.isPending;
  const fehler = diesesAnlegen ? mutation.error : null;

  const anlegen = () => {
    if (kannAnlegen && !laeuft)
      mutation.mutate({
        einsatzId,
        bezeichnung: neuBezeichnung.trim(),
        betriebsart: neuBetriebsart as Betriebsart,
      });
  };
  // Öffnen und Abbrechen räumen den Grund; eine laufende Anfrage bleibt unberührt.
  const schalteAnlegen = (offen: boolean) => {
    if (!mutation.isPending && mutation.error != null) mutation.reset();
    setAnlegenOffen(offen);
  };

  return (
    <div>
      <Select
        {...auswahl}
        mode="multiple"
        value={value}
        onChange={(ids: number[]) => onChange?.(ids)}
        options={gruppen}
        placeholder="Sprechgruppen auswählen"
        style={{ width: '100%' }}
        allowClear
      />

      {!anlegenOffen && (
        <Button
          type="link"
          icon={<IconPlus />}
          style={{ padding: 0, marginTop: token.marginSM }}
          onClick={() => schalteAnlegen(true)}
        >
          neue Sprechgruppe anlegen
        </Button>
      )}

      {anlegenOffen && (
        <Space size={token.marginSM} wrap style={{ marginTop: token.marginSM, width: '100%' }}>
          <Input
            aria-label="Neue Bezeichnung"
            placeholder="z. B. 412_F_DRK"
            value={neuBezeichnung}
            onChange={(e) => setNeuBezeichnung(e.target.value)}
            onKeyDown={(e) => {
              // Enter darf NICHT das umgebende Abschnitt-/Einheit-Formular abschicken.
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                anlegen();
              }
            }}
          />
          <Select<Betriebsart>
            aria-label="Neue Betriebsart"
            placeholder="Betriebsart"
            value={neuBetriebsart}
            onChange={(v) => setNeuBetriebsart(v)}
            style={{ width: 130 }}
            options={[
              { value: 'TMO', label: 'TMO' },
              { value: 'DMO', label: 'DMO' },
            ]}
          />
          <Button type="primary" onClick={anlegen} loading={laeuft} disabled={!kannAnlegen}>
            Anlegen
          </Button>
          {/* Gesperrt, solange die Antwort aussteht: eine Ablehnung braucht ihre Zeile. */}
          <Button
            disabled={laeuft}
            onClick={() => {
              setNeuBezeichnung('');
              setNeuBetriebsart(undefined);
              schalteAnlegen(false);
            }}
          >
            Abbrechen
          </Button>
        </Space>
      )}
      {anlegenOffen && fehler != null && (
        <div style={{ marginTop: token.marginSM }}>
          <SpeicherFehler
            fehler={fehler}
            titel="Sprechgruppe nicht angelegt"
            fallback="Anlegen fehlgeschlagen"
          />
        </div>
      )}
    </div>
  );
}
