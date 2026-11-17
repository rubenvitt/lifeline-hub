import { App, Form, type FormProps } from 'antd';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ErfassungsModal, type Speicherung } from './Erfassung';
import { einsatzKeys } from '../api/queryKeys';

export interface AnlegenModalSlot<T> {
  einsatzId: number;
  open: boolean;
  onClose: () => void;
  /** Wird nach erfolgreichem Anlegen mit dem neuen Datensatz aufgerufen. */
  onAngelegt?: (angelegt: T) => void;
}

interface Props<T, E> extends AnlegenModalSlot<T> {
  titel: string;
  erfolgText: string;
  legeAn: (einsatzId: number, daten: E) => Promise<T>;
  /** Liste, die nach dem Anlegen neu geladen wird (neben dem ETB). */
  listenKey: (einsatzId: number) => QueryKey;
  initialValues?: FormProps<E>['initialValues'];
  /** Die `Form.Item`s. */
  children: ReactNode;
}

/**
 * Erfassungsdialog für einen einsatzgebundenen Datensatz (UHS, Bereitstellungsraum): Liste,
 * Leerzustand und Switcher legen über denselben Dialog an. Anlegen geht über den Dialog, nie über
 * einen Drawer (Spec `bedien-muster`, „Einen Datensatz anlegen“; `frontend/AGENTS.md`, „Ort von
 * ‚Bearbeiten‘ und Form des Anlegens“). Kreuz, Maske und Escape führt `ErfassungsModal` selbst
 * über den Abbruch des Formulars.
 */
export default function AnlegenModal<T, E extends object>({
  einsatzId,
  open,
  onClose,
  onAngelegt,
  titel,
  erfolgText,
  legeAn,
  listenKey,
  initialValues,
  children,
}: Props<T, E>) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<E>();
  const angelegt = useRef<T | null>(null);
  const abbruchGeneration = useRef(0);
  const formularEinsatzId = useRef(einsatzId);

  useEffect(() => {
    if (formularEinsatzId.current === einsatzId) return;
    formularEinsatzId.current = einsatzId;
    form.resetFields();
  }, [einsatzId, form]);

  // Kein `onError`: den Grund zeigt die Hülle im Dialog (`speicherung`, LFH-1077).
  const anlegenMut = useMutation({
    mutationFn: (v: { einsatzId: number; daten: E }) => legeAn(v.einsatzId, v.daten),
    onSuccess: (_neu, v) => {
      message.success(erfolgText);
      qc.invalidateQueries({ queryKey: listenKey(v.einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(v.einsatzId) });
    },
  });
  /*
   * Nur das Anlegen DIESES Einsatzes gehört in den Dialog: ein laufendes aus dem vorigen sperrt
   * hier kein Abbrechen, seine Ablehnung steht hier nicht.
   */
  const diesesAnlegen = anlegenMut.variables?.einsatzId === einsatzId;
  const speicherung: Speicherung = {
    error: diesesAnlegen ? anlegenMut.error : null,
    isPending: diesesAnlegen && anlegenMut.isPending,
    reset: anlegenMut.reset,
  };

  const abbrechen = useCallback(() => {
    abbruchGeneration.current += 1;
    angelegt.current = null;
    onClose();
  }, [onClose]);

  return (
    <ErfassungsModal<E>
      offen={open}
      titel={titel}
      form={form}
      onErfassen={async (daten) => {
        const generation = abbruchGeneration.current;
        const neu = await anlegenMut.mutateAsync({ einsatzId, daten });
        if (abbruchGeneration.current === generation) angelegt.current = neu;
      }}
      // Bindet einen laufenden Auftrag an dessen Einsatz-ID. Das hält nur, weil `abschicken` in
      // `components/Erfassung.tsx` ein `useCallback` ist und den `onFertig` beim Absenden
      // einfriert.
      onFertig={() => {
        const neu = angelegt.current;
        angelegt.current = null;
        onClose();
        if (neu) onAngelegt?.(neu);
      }}
      onAbbrechen={abbrechen}
      laeuft={speicherung.isPending}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht angelegt"
      speicherFehlerFallback="Anlegen fehlgeschlagen"
      erfassenText="Anlegen"
      initialValues={initialValues}
    >
      {children}
    </ErfassungsModal>
  );
}
