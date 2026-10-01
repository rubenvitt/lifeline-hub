import type { Person } from '../api/types';
import { registrierAnzeige } from '../api/einsatzPerson';
import type { AnzeigeKonventionen } from '../anzeige/format';
import DruckTabelle, { druckZeit, type DruckSpalte } from '../druck/DruckTabelle';
import { koordinatenText } from './koordinate';
import { SK_META, STATUS_META } from './personMeta';
import { geschlechtAlter, nameText, verbleibText } from './personenSpalten';

interface Props {
  /** Die gedruckte Auswahl, in beliebiger Ordnung. */
  personen: readonly Person[];
  uhsName: (id: number) => string | undefined;
  konventionen: AnzeigeKonventionen;
}

/**
 * Papierform der Betroffenenliste (LFH-727, design.md D6). Aufsteigend nach Registriernummer:
 * auf Papier zeigt die Nummernfolge, was fehlt. Die Sichtung steht als Wort ohne Farbfeld —
 * Farbe trägt auf Papier nichts.
 */
export default function PersonenDruckTabelle({ personen, uhsName, konventionen }: Props) {
  const spalten: DruckSpalte<Person>[] = [
    { titel: 'Nr.', mono: true, wert: (p) => registrierAnzeige(p.registrier_nr) },
    { titel: 'Name', wert: (p) => nameText(p) ?? 'unbekannt' },
    { titel: 'Geschl./Alter', wert: (p) => geschlechtAlter(p) ?? '—' },
    {
      titel: 'Sichtung',
      wert: (p) => (p.aktuelle_sichtung ? SK_META[p.aktuelle_sichtung].label : 'ohne Sichtung'),
    },
    { titel: 'Status', wert: (p) => STATUS_META[p.status].label },
    {
      titel: 'Fundort',
      wert: (p) => [p.antreff_ort, koordinatenText(p)].filter(Boolean).join(' · ') || '—',
    },
    { titel: 'Verbleib', wert: (p) => verbleibText(p, uhsName) ?? '—' },
    { titel: 'erfasst', mono: true, wert: (p) => druckZeit(p.erfasst_at, konventionen) },
  ];
  return (
    <DruckTabelle
      kennung="personen-druck-tabelle"
      spalten={spalten}
      zeilen={[...personen].sort((a, b) => a.registrier_nr - b.registrier_nr)}
      schluessel={(p) => p.id}
    />
  );
}
