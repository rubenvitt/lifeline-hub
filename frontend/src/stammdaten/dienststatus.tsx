import { Button, Popconfirm, Space, type TableColumnsType } from 'antd';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { StatusChip } from '../components/instrument';
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import type { Dienststatus } from '../api/types';

interface DienststatusVariablen {
  id: number;
  inDienst: boolean;
}

/** In/außer Dienst setzen und danach den Stammdaten-Katalog (`queryKey`) invalidieren. */
export function useDienststatusMutation(
  setze: (id: number, inDienst: boolean) => Promise<unknown>,
  queryKey: QueryKey,
) {
  const qc = useQueryClient();
  const fehler = useFehlerMeldung();
  return useMutation({
    mutationFn: (v: DienststatusVariablen) => setze(v.id, v.inDienst),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: fehler,
  });
}

type DienststatusMutation = ReturnType<typeof useDienststatusMutation>;

/**
 * Status- und (nur für Admins) Aktionsspalte der Stammdaten-Tabellen Fahrzeuge, Personal
 * und Material.
 */
export function dienststatusSpalten<T extends { id: number; dienststatus: Dienststatus }>({
  mutation,
  istAdmin,
  onBearbeiten,
}: {
  mutation: DienststatusMutation;
  istAdmin: boolean;
  onBearbeiten: (eintrag: T) => void;
}): TableColumnsType<T> {
  const status: TableColumnsType<T>[number] = {
    title: 'Status',
    key: 'dienststatus',
    // Bewusst OHNE `dataIndex`: `onFilter` liest den Datensatz selbst, ein Bezug zöge den
    // Drahtwert `in_dienst` in die Freitextsuche, die Rohwerte liest. `String(wert)`, weil
    // antd das Filterargument als `React.Key | boolean` typisiert.
    filters: [
      { text: 'in Dienst', value: 'in_dienst' },
      { text: 'außer Dienst', value: 'ausser_dienst' },
    ],
    onFilter: (wert, t) => t.dienststatus === String(wert),
    render: (_, t) =>
      t.dienststatus === 'in_dienst' ? (
        <StatusChip ton="normal" wort="in Dienst" />
      ) : (
        <StatusChip ton="neutral" wort="außer Dienst" />
      ),
  };
  if (!istAdmin) return [status];
  return [
    status,
    {
      title: 'Aktionen',
      key: 'aktionen',
      render: (_, t) => {
        /**
         * Eine laufende Mutation sperrt GENAU EINE Zeile, nicht die ganze Tabelle. Der
         * Observer kennt nur den jüngsten Aufruf, die Marke wandert also beim Klick auf
         * eine andere Zeile — unschädlich, weil der Endpunkt einen Status SETZT
         * (idempotent), nicht umschaltet.
         */
        const laeuft = mutation.isPending && mutation.variables?.id === t.id;
        return (
          <Space size="middle">
            <Button disabled={laeuft} onClick={() => onBearbeiten(t)}>
              Bearbeiten
            </Button>
            {t.dienststatus === 'in_dienst' ? (
              <Popconfirm
                title="Außer Dienst stellen?"
                disabled={laeuft}
                okButtonProps={{ danger: true }}
                onConfirm={() => {
                  if (!laeuft) mutation.mutate({ id: t.id, inDienst: false });
                }}
              >
                <Button danger loading={laeuft} disabled={laeuft}>
                  Außer Dienst
                </Button>
              </Popconfirm>
            ) : (
              <Button
                loading={laeuft}
                disabled={laeuft}
                onClick={() => {
                  if (!laeuft) mutation.mutate({ id: t.id, inDienst: true });
                }}
              >
                Wieder in Dienst
              </Button>
            )}
          </Space>
        );
      },
    },
  ];
}
