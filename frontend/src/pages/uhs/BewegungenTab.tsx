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
import { belegungsArt } from '../../theme/statusFarben';
import Datenstand, { gemeinsamerDatenstand } from '../../components/Datenstand';

interface Props {
  uhs: UhsDetail;
  dataUpdatedAt?: number;
}

/** Stabile Leermenge: `?? []` je Render gäbe `personenById` jedes Mal eine neue Identität. */
const KEINE_PERSONEN: readonly Person[] = [];

/**
 * Genau der Text, den die Personenzelle ANZEIGT — und damit auch der Suchtext.
 *
 * Eine Quelle für beides: `render` und `suchText` dürfen nicht auseinanderlaufen, sonst
 * findet die Suche etwas, das nirgends steht, oder findet Sichtbares nicht.
 */
function personEtikett(personId: number, personenById: ReadonlyMap<number, Person>): string {
  const person = personenById.get(personId);
  if (!person) return `#${personId}`;
  return person.name
    ? `${registrierAnzeige(person.registrier_nr)} · ${person.name}`
    : registrierAnzeige(person.registrier_nr);
}

/**
 * Die Bewegungsarten als Filterwerte — aus `belegungsArt` ABGELEITET, nicht abgetippt.
 * Eine vierte Art erscheint damit von selbst, und `theme/statusFarben.ts` bleibt
 * unangetastet (die Karte dort ist von LFH-328/A2 gepinnt). Muster: `etb/EtbFilterleiste`.
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
   * Die Spaltenliste läuft durch `spaltenFuer<T>()` und wird NICHT annotiert: eine
   * Annotation weitet die Schlüsselliterale auf `string`, und der Kartenplan nähme danach
   * jeden Tippfehler in seinen Slots widerspruchslos an.
   *
   * `immerSichtbar` steht an ALLEN fünf Spalten, und das ist keine Aktionsspalten-Marke:
   * das Protokoll hat fünf Spalten und keine, die man sinnvoll abwählt. Ohne die Marken
   * erschiene ein Spaltenschalter samt Zähler — und weil hier auch kein `abBreite` steht,
   * wäre das ein Bedienelement für eine Entscheidung, die niemand treffen muss.
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
          render: (v: string) => <ZeitAnzeige wert={v} format="dtgVoll" />,
        },
        {
          key: 'person_id',
          immerSichtbar: true,
          title: 'Person',
          dataIndex: 'person_id',
          // Der Suchraum ist FESTGELEGT: gesucht wird, was angezeigt wird. Nur diese Spalte
          // trägt `suchText`, also findet 'Klinik' aus einer Notiz nichts.
          suchText: (b) => personEtikett(b.person_id, personenById),
          render: (personId: number) => {
            const etikett = personEtikett(personId, personenById);
            // Aufgelöste Person → Deeplink auf die Detailseite (LFH-25). Unbekannte/nicht
            // geladene Person bleibt unverlinkter Fallback (#id, kein garantiertes Ziel).
            //
            // Der Link bleibt HIER und wandert NICHT in `karte.titel.ziel`: `ziel` müsste
            // für jede Zeile eines liefern und verlinkte damit auch Personen, die es nicht
            // gibt. Weil `ziel` ungesetzt ist, trägt `zelle()` diesen Knoten unverändert in
            // die Kartentitelzeile — verschachtelte Links entstehen nicht.
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
            // Bewusst NICHT aufgeräumt: „kein Platz" und „Platz gesetzt, aber nicht in
            // `uhs.plaetze`" liefern beide 'Inbox'. Bekannter Ist-Zustand, eigenes Thema —
            // eine Verhaltensänderung mitten in einer Formmigration wäre nicht trennbar.
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
     * `form` bleibt ungesetzt (Default `'auto'`): das chronologische Protokoll wird
     * GELESEN, nicht verglichen (A1, Festlegung 2), damit greift die Karten-Ausnahme des
     * Primitivs. Ihre schriftliche Begründung steht im Dateikopf von `Datensicht.tsx`.
     *
     * Ebenfalls ungesetzt, jeweils mit Grund: `karte.aktion` (die Sicht ist read-only,
     * Belegungen entstehen im Grundriss), `abBreite` (siehe Spaltenliste), `zufluss`
     * (Default `'sammelbanner'` ist hier richtig), `gruppen`/`baum`/`aufklappzeile`/
     * `zeilenKlasse`/`werkzeuge`/`onZeileKlick`.
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
        // Spiegelt die Backend-Ordnung (`ORDER BY zeitpunkt_at DESC`), ist aber nicht deren
        // Wiederholung: die Reihenfolge entsteht jetzt im Primitiv und übersteht eine
        // unsortiert gelieferte Menge.
        standardSortierung={{ spalte: 'zeitpunkt_at', richtung: 'ab' }}
        suche={{ platzhalter: 'Person oder R-Nr.' }}
        karte={{
          art: 'plan',
          // Kartentitel ist die PERSON (die Karte wird gelesen: wer hat sich bewegt),
          // Tabellenspalte 0 bleibt die Zeit (die Tabelle wird chronologisch verglichen).
          // Die Rollen sind orthogonal zur Spaltenreihenfolge — wer das „harmonisiert",
          // verliert eine der beiden Aussagen.
          titel: { spalte: 'person_id' },
          status: (b) => belegungsArt[b.art],
          sekundaer: ['zeitpunkt_at', 'platz_id', 'notiz'],
        }}
      />
    </>
  );
}
