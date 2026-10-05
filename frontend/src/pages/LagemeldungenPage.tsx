import { Alert, Breadcrumb, Button, Input, Spin } from 'antd';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { listeLageMeldungen } from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type { LageMeldung } from '../api/types';
import KoordinatenAnzeige from '../anzeige/KoordinatenAnzeige';
import { formatUhrzeit } from '../anzeige/format';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { SeitenLeer, SeitenSkeleton } from '../components/SeitenZustand';
import EinsatzSeite from '../components/EinsatzSeite';
import {
  Augenbraue,
  Segmentleiste,
  useRollen,
  Zeitachseneintrag,
  type SegmentOption,
} from '../components/instrument';
import { meldungenPfad } from '../routing/deeplinks';
import { etbTyp } from '../theme/statusFarben';
import {
  LEERER_FILTER,
  ZEITFENSTER,
  filterAktiv,
  filtereLagemeldungen,
  gruppiereNachTag,
  type LageFilter,
  type Ortsfilter,
  type Zeitfenster,
} from '../lagemeldungen/zeitachse';
import { KennungsLink } from '../components/kennungsLink';

const FENSTER_OPTIONEN: SegmentOption<Zeitfenster | 'alle'>[] = [
  { wert: 'alle', label: 'Alle' },
  ...ZEITFENSTER.map((z) => ({ wert: z.value, label: z.text })),
];

const ORT_OPTIONEN: SegmentOption<Ortsfilter>[] = [
  { wert: 'alle', label: 'Alle Orte' },
  { wert: 'mit', label: 'Mit Koordinaten' },
  { wert: 'ohne', label: 'Ohne Koordinaten' },
];

/**
 * Lagerelevante Meldungen als Zeitachse — wie das ETB: eine chronologische Folge wird gelesen („was
 * ist passiert?"), nicht verglichen.
 *
 * Deshalb keine `Datensicht`: keine Spalte wird verglichen, die Ordnung ist die Zeit, und die Zeile
 * braucht Zeit · Typkante · Text · Herkunft · Ort — das trägt der Baustein `Zeitachseneintrag`,
 * nicht der Kartenplan (Titel + drei Sekundärfelder).
 *
 * - Tagesgruppen jüngster Tag zuerst, Tagesgrenze in der Anzeigezone (`lagemeldungen/zeitachse.ts`,
 *   `gruppiereNachTag` über `tagesSchluessel`/`tagesEtikett`). In der Gruppe genügt `HH:mm` — der
 *   Tag steht im Kopf.
 * - Rückweg zur Quellmeldung über `meldungenPfad`, im Meta der Zeile.
 * - Filterachsen (Zeitfenster, Koordinaten, Freitext) als Filterleiste über der Achse, Prädikate in
 *   `filtereLagemeldungen`.
 *
 * Typkante und Typwort sind die des ETB-Typs „Lage" (`etbTyp.lage`): eine übergebene Lagemeldung
 * ist ein Lageeintrag, eine zweite Farbe wäre erfunden.
 */
export default function LagemeldungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { konventionen } = useAnzeigeKonventionen();
  const { token, rollen } = useRollen();
  const [filter, setFilter] = useState<LageFilter>(LEERER_FILTER);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const lageQuery = useQuery({
    queryKey: einsatzKeys.lagemeldungen(einsatzId),
    queryFn: () => listeLageMeldungen(einsatzId),
  });

  const eintraege = useMemo(() => lageQuery.data ?? [], [lageQuery.data]);
  const gruppen = useMemo(
    () => gruppiereNachTag(filtereLagemeldungen(eintraege, filter, konventionen), konventionen),
    [eintraege, filter, konventionen],
  );

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const gefiltert = gruppen.reduce((n, g) => n + g.zeilen.length, 0);

  const zeile = (l: LageMeldung) => (
    <Zeitachseneintrag
      key={l.id}
      als="li"
      zeit={formatUhrzeit(l.erstellt_at, konventionen)}
      typ="lage"
      typwort={etbTyp.lage.label}
      meta={
        // Deeplink zur Quellmeldung — der einzige Weg zurück zum Vorgang.
        <>
          {'aus '}
          <KennungsLink to={meldungenPfad(l.einsatz_id, { meldung: l.meldung_id })}>
            Meldung #{l.meldung_lfd_nr}
          </KennungsLink>
        </>
      }
      hinweis={
        l.lat != null && l.lon != null ? (
          <KoordinatenAnzeige
            lat={l.lat}
            lon={l.lon}
            einsatzId={l.einsatz_id}
            exclude={`lagemeldung:${l.id}`}
          />
        ) : undefined
      }
      verfasser={l.meldung_absender}
    >
      {l.text}
    </Zeitachseneintrag>
  );

  let inhalt;
  if (lageQuery.isLoading) {
    inhalt = <SeitenSkeleton />;
  } else if (lageQuery.isError) {
    // Fehler ist nicht leer: kein Leerzustand hinter der Fehlermeldung.
    inhalt = (
      <Alert
        type="error"
        showIcon
        title="Lageobjekte konnten nicht geladen werden"
        action={<Button onClick={() => void lageQuery.refetch()}>Erneut laden</Button>}
      />
    );
  } else if (eintraege.length === 0) {
    // Keine Primäraktion: eine Lagemeldung entsteht, indem jemand anderswo eine Meldung als
    // lagerelevant übergibt. Der Hinweis nennt den Weg.
    inhalt = (
      <SeitenLeer
        titel="Noch keine lagerelevanten Meldungen übergeben"
        hinweis="Eine Meldung wird in der Meldungsliste als lagerelevant übergeben."
      />
    );
  } else if (gefiltert === 0) {
    inhalt = (
      <SeitenLeer
        titel="Keine Lagemeldung passt zum Filter"
        aktion={{ label: 'Filter zurücksetzen', onClick: () => setFilter(LEERER_FILTER) }}
      />
    );
  } else {
    inhalt = gruppen.map((g) => (
      <div key={g.schluessel} role="group" aria-label={g.etikett}>
        <div
          style={{
            paddingBlock: token.paddingXS,
            paddingInline: token.padding,
            borderBlockEnd: `1px solid ${rollen.linie}`,
            background: rollen.grund,
          }}
        >
          <Augenbraue>{g.etikett}</Augenbraue>
        </div>
        <ol style={{ margin: 0, padding: 0 }}>{g.zeilen.map(zeile)}</ol>
      </div>
    ));
  }

  return (
    <EinsatzSeite
      titel="Lagerelevante Meldungen"
      meta={
        lageQuery.isSuccess
          ? filterAktiv(filter)
            ? `${gefiltert} von ${eintraege.length} übergeben`
            : `${eintraege.length} übergeben`
          : undefined
      }
      dataUpdatedAt={lageQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Lagemeldungen' },
          ]}
        />
      }
    >
      {eintraege.length > 0 && (
        <div
          role="search"
          aria-label="Lagemeldungen filtern"
          data-lfh="lagemeldungen-filter"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: token.marginSM,
            marginBlockEnd: token.margin,
          }}
        >
          <Input.Search
            allowClear
            aria-label="Suche in Lagemeldungen"
            placeholder="Meldungstext, Absender oder Nr."
            value={filter.suche}
            onChange={(e) => setFilter((f) => ({ ...f, suche: e.target.value }))}
            style={{ flex: '1 1 220px', maxWidth: 360 }}
          />
          <Segmentleiste
            beschriftung="Zeitfenster"
            optionen={FENSTER_OPTIONEN}
            wert={filter.fenster}
            onWechsel={(fenster) => setFilter((f) => ({ ...f, fenster }))}
          />
          <Segmentleiste
            beschriftung="Ort"
            optionen={ORT_OPTIONEN}
            wert={filter.ort}
            onWechsel={(ort) => setFilter((f) => ({ ...f, ort }))}
          />
        </div>
      )}
      <div
        role="region"
        aria-label="Lagemeldungen"
        data-lfh="lagemeldungen-zeitachse"
        style={{ border: `1px solid ${rollen.linie}`, background: rollen.paneel }}
      >
        {inhalt}
      </div>
    </EinsatzSeite>
  );
}
