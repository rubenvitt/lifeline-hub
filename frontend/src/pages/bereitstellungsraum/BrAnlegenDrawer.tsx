import { App, Drawer, Form, Input } from 'antd';
import { useCallback, useEffect, useRef } from 'react';
import {
  ErfassungsFormular,
  type ErfassungsFormularSteuerung,
} from '../../components/Erfassung';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { legeBrAn, type BrEingabe } from '../../api/einsatzBereitstellungsraum';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import type { Bereitstellungsraum } from '../../api/types';

interface Props {
  einsatzId: number;
  open: boolean;
  onClose: () => void;
  /** Wird nach erfolgreichem Anlegen mit dem neuen BR aufgerufen. */
  onAngelegt?: (br: Bereitstellungsraum) => void;
}

/** Wiederverwendbarer Drawer zum Anlegen eines Bereitstellungsraums (Liste, Leerzustand, Switcher). */
export default function BrAnlegenDrawer({ einsatzId, open, onClose, onAngelegt }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<BrEingabe>();
  const angelegterBr = useRef<Bereitstellungsraum | null>(null);
  const formularSteuerung = useRef<ErfassungsFormularSteuerung>(null);
  const abbruchGeneration = useRef(0);
  const formularEinsatzId = useRef(einsatzId);

  useEffect(() => {
    if (formularEinsatzId.current === einsatzId) return;
    formularEinsatzId.current = einsatzId;
    form.resetFields();
  }, [einsatzId, form]);

  const anlegenMut = useMutation({
    mutationFn: (daten: BrEingabe) => legeBrAn(einsatzId, daten),
    onSuccess: () => {
      message.success('Bereitstellungsraum angelegt');
      qc.invalidateQueries({ queryKey: einsatzKeys.br(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    },
    onError: (e: unknown) =>
      message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const abbrechen = useCallback(() => {
    abbruchGeneration.current += 1;
    angelegterBr.current = null;
    onClose();
  }, [onClose]);

  const drawerSchliessen = () => {
    if (formularSteuerung.current) formularSteuerung.current.abbrechen();
    else abbrechen();
  };

  return (
    <Drawer
      title="Bereitstellungsraum anlegen"
      open={open}
      keyboard={false}
      onClose={drawerSchliessen}
      size={420}
      destroyOnHidden
    >
      <ErfassungsFormular<BrEingabe>
        form={form}
        steuerungRef={formularSteuerung}
        onErfassen={async (daten) => {
          const generation = abbruchGeneration.current;
          const br = await anlegenMut.mutateAsync(daten);
          if (abbruchGeneration.current === generation) angelegterBr.current = br;
        }}
        // Bindet einen laufenden Auftrag an dessen Einsatz-ID: `onFertig` schließt hier über
        // das `einsatzId`-Prop des Renders, in dem der Auftrag gestartet wurde — das hält nur,
        // weil `abschicken` in `components/Erfassung.tsx` ein `useCallback` ist und den zu
        // diesem Zeitpunkt aktuellen `onFertig`-Wert beim Absenden einfriert. Ein Wechsel dort
        // von `useCallback` weg auf eine bei jedem Render neu gebundene Funktion (oder ein Ref
        // ohne Re-Erzeugung bei geänderten Deps) bricht diesen Test lautlos, ohne dass hier
        // etwas geändert wird.
        onFertig={() => {
          const br = angelegterBr.current;
          angelegterBr.current = null;
          onClose();
          if (br) onAngelegt?.(br);
        }}
        onAbbrechen={abbrechen}
        laeuft={anlegenMut.isPending}
        erfassenText="Anlegen"
      >
        <Form.Item
          label="Bezeichnung"
          name="bezeichnung"
          rules={[{ required: true, message: 'Bezeichnung erforderlich' }]}
        >
          <Input placeholder="z. B. BR Ost" />
        </Form.Item>
        <Form.Item label="Standort (optional)" name="standort">
          <Input placeholder="Adresse / Hinweis" />
        </Form.Item>
        <Form.Item label="Notiz (optional)" name="notiz">
          <Input.TextArea rows={3} />
        </Form.Item>
      </ErfassungsFormular>
    </Drawer>
  );
}
