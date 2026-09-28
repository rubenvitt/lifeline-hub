import { App, Drawer, Form, type FormProps } from 'antd';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ErfassungsFormular, type ErfassungsFormularSteuerung } from './Erfassung';
import { einsatzKeys } from '../api/queryKeys';
import { useFehlerMeldung } from './useFehlerMeldung';

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
  const fehler = useFehlerMeldung();
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

  const anlegenMut = useMutation({
    mutationFn: (daten: E) => legeAn(einsatzId, daten),
    onSuccess: () => {
      message.success(erfolgText);
      qc.invalidateQueries({ queryKey: listenKey(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    },
    onError: fehler,
  });

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
      size={420}
      destroyOnHidden
    >
      <ErfassungsFormular<E>
        form={form}
        steuerungRef={formularSteuerung}
        onErfassen={async (daten) => {
          const generation = abbruchGeneration.current;
          const neu = await anlegenMut.mutateAsync(daten);
          if (abbruchGeneration.current === generation) angelegt.current = neu;
        }}
        // Bindet einen laufenden Auftrag an dessen Einsatz-ID: `onFertig` schließt hier über
        // das `einsatzId`-Prop des Renders, in dem der Auftrag gestartet wurde — das hält nur,
        // weil `abschicken` in `components/Erfassung.tsx` ein `useCallback` ist und den zu
        // diesem Zeitpunkt aktuellen `onFertig`-Wert beim Absenden einfriert.
        onFertig={() => {
          const neu = angelegt.current;
          angelegt.current = null;
          onClose();
          if (neu) onAngelegt?.(neu);
        }}
        onAbbrechen={abbrechen}
        laeuft={anlegenMut.isPending}
        erfassenText="Anlegen"
        initialValues={initialValues}
      >
        {children}
      </ErfassungsFormular>
    </Drawer>
  );
}
