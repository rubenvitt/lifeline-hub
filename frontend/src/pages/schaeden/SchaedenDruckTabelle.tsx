import type { Schaden } from '../../api/types';
import { schadenRegistrierAnzeige } from '../../api/einsatzSchaden';
import type { AnzeigeKonventionen } from '../../anzeige/format';
import DruckTabelle, { druckZeit, type DruckSpalte } from '../../druck/DruckTabelle';
import { AUSMASS_META, STATUS_META, TYP_LABEL, geschaedigtText } from './schadenHelfer';

interface Props {
  /** Die gedruckte Auswahl, in beliebiger Ordnung. */
  schaeden: readonly Schaden[];
  konventionen: AnzeigeKonventionen;
}

/**
 * Papierform der Schadensliste (LFH-727, design.md D6): die Spalten der Liste als Text, der
 * Geschädigte ohne Deeplink, aufsteigend nach Registriernummer. Die Spalte „Verortet" entfällt —
 * sie beantwortet eine Frage vor der Karte, nicht auf Papier.
 */
export default function SchaedenDruckTabelle({ schaeden, konventionen }: Props) {
  const spalten: DruckSpalte<Schaden>[] = [
    { titel: 'Nr.', mono: true, wert: (s) => schadenRegistrierAnzeige(s.registrier_nr) },
    { titel: 'Typ', wert: (s) => TYP_LABEL[s.typ] },
    { titel: 'Ausmaß', wert: (s) => AUSMASS_META[s.ausmass].label },
    { titel: 'Ort', wert: (s) => s.ort },
    {
      titel: 'Status',
      wert: (s) =>
        s.status === 'uebergeben' && s.uebergeben_an
          ? `übergeben an ${s.uebergeben_an}`
          : STATUS_META[s.status].label,
    },
    { titel: 'Geschädigt', wert: geschaedigtText },
    { titel: 'erfasst', mono: true, wert: (s) => druckZeit(s.erfasst_at, konventionen) },
  ];
  return (
    <DruckTabelle
      kennung="schaeden-druck-tabelle"
      spalten={spalten}
      zeilen={[...schaeden].sort((a, b) => a.registrier_nr - b.registrier_nr)}
      schluessel={(s) => s.id}
    />
  );
}
