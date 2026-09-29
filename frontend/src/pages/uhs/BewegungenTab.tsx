import { useMemo } from 'react';
import ZeitAnzeige from '../../anzeige/ZeitAnzeige';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listePersonen, registrierAnzeige } from '../../api/einsatzPerson';
import { einsatzKeys } from '../../api/queryKeys';
import { personDetailPfad } from '../../routing/deeplinks';
import type { Person, UhsBelegung, UhsDetail, BelegungsArt } from '../../api/types';
import Datensicht, { spaltenFuer } from '../../components/Datensicht';
import StatusTag from '../../components/StatusTag';
import { monoStil } from '../../components/instrument';
import { belegungsArt } from '../../theme/statusFarben';
import Datenstand, { gemeinsamerDatenstand } from '../../components/Datenstand';

interface Props {
  uhs: UhsDetail;
  dataUpdatedAt?: number;
}

/** Stabile Leermenge: `?? []` je Render gäbe `personenById` jedes Mal eine neue Identität. */
const KEINE_PERSONEN: readonly Person[] = [];

/**
 * Genau der Text, den die Personenzelle anzeigt — und damit der Suchtext. `render` und `suchText`
 * dürfen nicht auseinanderlaufen.
 */
function personEtikett(personId: number, personenById: ReadonlyMap<number, Person>): string {
  const person = personenById.get(personId);
  if (!person) return `#${personId}`;
  return person.name
    ? `${registrierAnzeige(person.registrier_nr)} · ${person.name}`
    : registrierAnzeige(person.registrier_nr);
}

/**
 * Die Bewegungsarten als Filterwerte, aus `belegungsArt` abgeleitet — eine vierte Art erscheint von
 * selbst.
 */
const ART_WERTE = (Object.keys(belegungsArt) as BelegungsArt[]).map((art) => ({
  text: belegungsArt[art].label,
  value: art,
}));

export default function BewegungenTab({ uhs, dataUpdatedAt }: Props) {
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(uhs.einsatz_id),
    queryFn: () => listePersonen(uhs.einsatz_id),
  });

  const personen = personenQuery.data ?? KEINE_PERSONEN;
  const personenById = useMemo(() => new Map(personen.map((p) => [p.id, p])), [personen]);
  const plaetzeById = useMemo(() => new Map(uhs.plaetze.map((pl) => [pl.id, pl])), [uhs.plaetze]);

  /**
   * Die Spaltenliste läuft durch `spaltenFuer<T>()` und wird nicht annotiert: eine Annotation
   * weitete die Schlüssel auf `string`, und der Kartenplan nähme jeden Tippfehler an.
   *
   * `immerSichtbar` an allen fünf Spalten: keine lässt sich sinnvoll abwählen, ein Spaltenschalter
   * wäre Rauschen.
   */
  const spalten = useMemo(
    () =>
      spaltenFuer<UhsBelegung>()([
        {
          key: 'zeitpunkt_at',
          immerSichtbar: true,
          title: 'Zeit',
          dataIndex: 'zeitpunkt_at',
          // Lexikographisch ordnungstreu für `'2026-06-23 10:00:00'` — kein Datumsparser nötig.
          sortWert: (b) => b.zeitpunkt_at,
          // Mono an der Aufrufstelle: `ZeitAnzeige` rendert ein Fragment.
          render: (v: string) => (
            <span style={monoStil(12)}>
              <ZeitAnzeige wert={v} format="dtgVoll" />
            </span>
          ),
        },
        {
          key: 'person_id',
          immerSichtbar: true,
          title: 'Person',
          dataIndex: 'person_id',
          // Der Suchraum ist festgelegt: gesucht wird, was angezeigt wird; nur diese Spalte trägt
          // `suchText`.
          suchText: (b) => personEtikett(b.person_id, personenById),
          render: (personId: number) => {
            const etikett = personEtikett(personId, personenById);
            // Aufgelöste Person → Deeplink auf die Detailseite; unbekannte Person bleibt unverlinkt
            // (#id).
            //
            // Der Link bleibt hier und nicht in `karte.titel.ziel`: `ziel` verlinkte jede Zeile,
            // auch unbekannte Personen. Ohne `ziel` trägt `zelle()` diesen Knoten unverändert in
            // die Kartentitelzeile.
            if (!personenById.has(personId)) return etikett;
            return <Link to={personDetailPfad(uhs.einsatz_id, personId)}>{etikett}</Link>;
          },
        },
        {
          key: 'art',
          immerSichtbar: true,
          title: 'Art',
          dataIndex: 'art',
          filter: { werte: ART_WERTE, trifft: (b, w) => b.art === w },
          render: (art: BelegungsArt) => <StatusTag darstellung={belegungsArt[art]} />,
        },
        {
          key: 'platz_id',
          immerSichtbar: true,
          title: 'Platz',
          dataIndex: 'platz_id',
          render: (platzId: number | null) => {
            // Bekannt: „kein Platz" und „Platz nicht in `uhs.plaetze`" liefern beide 'Inbox'.
            if (platzId == null) return 'Inbox';
            const platz = plaetzeById.get(platzId);
            return platz ? platz.bezeichnung : 'Inbox';
          },
        },
        {
          key: 'notiz',
          immerSichtbar: true,
          title: 'Notiz',
          dataIndex: 'notiz',
          render: (v: string | null) => v ?? '—',
        },
      ]),
    [personenById, plaetzeById, uhs.einsatz_id],
  );

  return (
    /**
     * `form` bleibt `'auto'`: das Protokoll wird gelesen, nicht verglichen — damit greift die
     * Karten-Ausnahme des Primitivs (Begründung im Dateikopf von `Datensicht.tsx`). Ohne
     * `karte.aktion`: die Sicht ist read-only, Belegungen entstehen im Grundriss.
     */
    <>
      <Datenstand
        dataUpdatedAt={gemeinsamerDatenstand(dataUpdatedAt, personenQuery.dataUpdatedAt)}
      />
      <Datensicht
        bezeichnung="Bewegungen"
        spalten={spalten}
        daten={uhs.belegungen}
        zeilenSchluessel="id"
        ladend={personenQuery.isLoading}
        leerText="Keine Bewegungen erfasst"
        // Spiegelt die Backend-Ordnung, übersteht aber auch eine unsortiert gelieferte Menge.
        standardSortierung={{ spalte: 'zeitpunkt_at', richtung: 'ab' }}
        suche={{ platzhalter: 'Person oder R-Nr.' }}
        karte={{
          art: 'plan',
          // Kartentitel ist die Person (wer hat sich bewegt), Tabellenspalte 0 die Zeit
          // (chronologisch verglichen). Die Rollen sind unabhängig von der Spaltenreihenfolge.
          titel: { spalte: 'person_id' },
          status: (b) => belegungsArt[b.art],
          sekundaer: ['zeitpunkt_at', 'platz_id', 'notiz'],
        }}
      />
    </>
  );
}
