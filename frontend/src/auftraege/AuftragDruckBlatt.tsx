import { theme } from 'antd';
import type { Auftrag } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { ZeilenListe, type Titel, type Zeile } from '../druck/ZeilenListe';
import { mitBesetzung } from '../fuehrung/funktionsOptionenKern';
import { AUFTRAG_STATUS } from '../kommunikation';
import { druckFelder } from './auftragsschemaKern';

/** Nur gesetzte Angaben; ein Wert aus Leerzeichen fällt weg wie ein leerer. */
function gesetzt(zeilen: { etikett: string; wert: string | null | undefined }[]): Zeile[] {
  return zeilen.flatMap(({ etikett, wert }) =>
    typeof wert === 'string' && wert.trim() !== '' ? [{ etikett, wert }] : [],
  );
}

/**
 * Das Blatt eines Einzelauftrags (LLH-1171, Spec `druck-dokumente`, Change
 * `ianaw5k1-auftrag-drucken` D5): „Auftrag“ in der Feldfolge des Kerns ({@link druckFelder}),
 * „Quittung“ je Empfänger und „Bearbeitung“ mit den Zeitpunkten. Nur Lesestoff, kein Bedienort;
 * die Druckansicht (`pages/AuftragDruckPage.tsx`) setzt es unter den Druckkopf.
 *
 * Die Listen kommen aus `druck/ZeilenListe.tsx`: jeder Titel steht mit seiner ersten Zeile im
 * Titelblock (`druck/AGENTS.md`, Firefox). Die Wörter der Bearbeitung sind dieselben wie an Karte
 * und Detail (`AuftragVollzug`, `AuftragAufhebung`), dort als Satz mit Doppelpunkt.
 */
export default function AuftragDruckBlatt({ auftrag: a }: { auftrag: Auftrag }) {
  const { token } = theme.useToken();
  const { formatZeit } = useAnzeigeKonventionen();
  const zeit = (wire?: string | null) => (wire ? formatZeit(wire) : null);

  const titel = (text: string): Titel => ({
    ebene: 3,
    text,
    stil: { fontSize: token.fontSizeHeading5, borderBlockEnd: `1px solid ${token.colorBorder}` },
    oben: token.marginLG,
    unten: token.marginXS,
  });

  const quittung: Zeile[] = a.empfaenger.map((e) => ({
    etikett: mitBesetzung(e.snap_anzeige, e.aktuelle_besetzung),
    wert: e.quittiert_at ? formatZeit(e.quittiert_at) : 'nicht quittiert',
  }));

  const bearbeitung = gesetzt([
    {
      etikett: 'Phase',
      wert: (AUFTRAG_STATUS[a.bearbeitungsstatus] ?? AUFTRAG_STATUS.offen).label,
    },
    { etikett: 'In Bearbeitung seit', wert: zeit(a.in_arbeit_at) },
    { etikett: 'Vollzogen am', wert: zeit(a.vollzogen_at) },
    { etikett: 'Vollzugsvermerk', wert: a.vollzugsmeldung },
    { etikett: 'Abgenommen am', wert: zeit(a.abgenommen_at) },
    { etikett: 'Aufgehoben am', wert: zeit(a.aufgehoben_at) },
    { etikett: 'Aufgehoben von', wert: a.aufgehoben_von_name },
    { etikett: 'Grund', wert: a.aufhebungsgrund },
  ]);

  // `auftrag-druck-blatt`: Anker des Druck-Gates (`e2e/druck-fluss.spec.ts`) für die Titel.
  return (
    <div data-lfh="auftrag-druck-blatt">
      <ZeilenListe titel={[titel('Auftrag')]} zeilen={druckFelder(a, formatZeit)} />
      <ZeilenListe titel={[titel('Quittung')]} zeilen={quittung} />
      <ZeilenListe titel={[titel('Bearbeitung')]} zeilen={bearbeitung} />
    </div>
  );
}
