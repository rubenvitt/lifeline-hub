import { App, Drawer, Form, type FormProps } from 'antd';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  ErfassungsFormular,
  type ErfassungsFormularSteuerung,
  type Speicherung,
} from './Erfassung';
import { einsatzKeys } from '../api/queryKeys';

export interface AnlegenDrawerSlot<T> {
  einsatzId: number;
  open: boolean;
  onClose: () => void;
  /** Wird nach erfolgreichem Anlegen mit dem neuen Datensatz aufgerufen. */
  onAngelegt?: (angelegt: T) => void;
}

interface Props<T, E> extends AnlegenDrawerSlot<T> {
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
 * Schnellerfassungs-Drawer für einen einsatzgebundenen Datensatz (UHS, Bereitstellungsraum):
 * Liste, Leerzustand und Switcher legen über denselben Drawer an.
 */
export default function AnlegenDrawer<T, E extends object>({
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
  const formularSteuerung = useRef<ErfassungsFormularSteuerung>(null);
  const abbruchGeneration = useRef(0);
  const formularEinsatzId = useRef(einsatzId);

  useEffect(() => {
    if (formularEinsatzId.current === einsatzId) return;
    formularEinsatzId.current = einsatzId;
    form.resetFields();
  }, [einsatzId, form]);

  // Kein `onError`: den Grund zeigt die Hülle im Drawer (`speicherung`, LFH-1077).
  const anlegenMut = useMutation({
    mutationFn: (v: { einsatzId: number; daten: E }) => legeAn(v.einsatzId, v.daten),
    onSuccess: (_neu, v) => {
      message.success(erfolgText);
      qc.invalidateQueries({ queryKey: listenKey(v.einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(v.einsatzId) });
    },
  });
  /*
   * Nur das Anlegen DIESES Einsatzes gehört in den Drawer: ein laufendes aus dem vorigen sperrt
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

  const drawerSchliessen = () => {
    if (formularSteuerung.current) formularSteuerung.current.abbrechen();
    else abbrechen();
  };

  return (
    <Drawer
      title={titel}
      open={open}
      keyboard={false}
      onClose={drawerSchliessen}
      // Während des Anlegens sichtbar gesperrt; die Hülle hält auch Maske und Escape zurück.
      closable={speicherung.isPending ? { disabled: true } : true}
      size={420}
      destroyOnHidden
    >
      <ErfassungsFormular<E>
        form={form}
        steuerungRef={formularSteuerung}
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
      </ErfassungsFormular>
    </Drawer>
  );
}
