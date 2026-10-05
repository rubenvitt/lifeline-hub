import type { PersonZugriff } from '../api/types';
import type { KatalogSpalte } from '../components/KatalogTabelle';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { zugriffArtText } from './zugriffArt';

/**
 * Spalten des Zugriffsprotokolls der Personen (Wann · Wer · Art), geteilt vom Zugriffs-Audit der
 * Detailseite und den Listenzugriffen der Personenliste (LFH-916) — beide zeigen dieselben Zeilen.
 */
export const ZUGRIFF_SPALTEN: KatalogSpalte<PersonZugriff>[] = [
  {
    title: 'Wann',
    dataIndex: 'zugriff_at',
    key: 'zugriff_at',
    render: (v: string) => <ZeitAnzeige wert={v} format="dtgVoll" />,
  },
  { title: 'Wer', dataIndex: 'benutzer_name', key: 'benutzer_name' },
  {
    title: 'Art',
    dataIndex: 'art',
    key: 'art',
    render: (art: PersonZugriff['art']) => zugriffArtText(art),
  },
];
