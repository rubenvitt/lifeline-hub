import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Drawer, Spin } from 'antd';
import { ApiError } from '../../api/client';
import { ladeMatrix, setzeBewertung, type BewertungEingabe } from '../../api/gefahren';
import GefahrenMatrix from '../gefahren/GefahrenMatrix';

export interface GefahrengebietMatrixDrawerProps {
  einsatzId: number;
  gefahrengebietId: number | null;
  darfSchreiben: boolean;
  onClose: () => void;
}

/** Öffnet die 13×5-Matrix EINES Gefahrengebiets kontextuell von der Lagekarte. */
export default function GefahrengebietMatrixDrawer({ einsatzId, gefahrengebietId, darfSchreiben, onClose }: GefahrengebietMatrixDrawerProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const offen = gefahrengebietId != null;

  const matrixQuery = useQuery({
    queryKey: ['gefahrenmatrix', einsatzId, gefahrengebietId],
    queryFn: () => ladeMatrix(einsatzId, gefahrengebietId as number),
    enabled: offen,
  });

  const setzen = useMutation({
    mutationFn: (d: BewertungEingabe) => setzeBewertung(einsatzId, gefahrengebietId as number, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gefahrenmatrix', einsatzId, gefahrengebietId] });
      qc.invalidateQueries({ queryKey: ['gefahrengebiete', einsatzId] });
    },
    onError: (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  return (
    <Drawer title="Gefahrenmatrix" placement="right" width={560} open={offen} onClose={onClose} destroyOnClose>
      {matrixQuery.isLoading ? (
        <Spin />
      ) : (
        <GefahrenMatrix
          matrix={matrixQuery.data ?? []}
          darfSchreiben={darfSchreiben}
          pending={setzen.isPending}
          onSetzen={(d) => setzen.mutate(d)}
        />
      )}
    </Drawer>
  );
}
