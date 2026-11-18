import type { Auftrag } from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import DruckTabelle, { type DruckSpalte } from '../DruckTabelle';
import { auftragsZeilen, type AuftragsZeile } from './auftragsListe';

/** Papierform der Auftragsliste der Einsatzakte (LLH-1835, design.md D5). */
export default function AuftragsListe({ auftraege }: { auftraege: readonly Auftrag[] }) {
  const { zeitpunkt } = useAnzeigeKonventionen();
  const spalten: DruckSpalte<AuftragsZeile>[] = [
    { titel: 'Nr.', wert: (z) => z.nummer, mono: true },
    { titel: 'Auftrag', wert: (z) => z.auftrag },
    { titel: 'Empfänger', wert: (z) => z.empfaenger },
    { titel: 'Status', wert: (z) => z.status },
    { titel: 'Erteilt', wert: (z) => zeitpunkt(z.erteiltAt), mono: true },
    {
      titel: 'Abschluss',
      wert: (z) => (z.abschlussAt ? zeitpunkt(z.abschlussAt) : ''),
      mono: true,
    },
  ];
  return (
    <DruckTabelle
      kennung="akte-auftraege"
      spalten={spalten}
      zeilen={auftragsZeilen(auftraege)}
      schluessel={(z) => z.id}
    />
  );
}
