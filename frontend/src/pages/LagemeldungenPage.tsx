import { Alert, Breadcrumb, Button, Flex, Input, Spin } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import {
  listeLageMeldungen,
  markLageMeldungenGesehen,
  markLageMeldungGesehen,
} from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type { LageMeldung } from '../api/types';
import KoordinatenAnzeige from '../anzeige/KoordinatenAnzeige';
import { formatUhrzeit } from '../anzeige/format';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { SeitenLeer, SeitenSkeleton } from '../components/SeitenZustand';
import { SeitenHinweise, ZeilenFehler } from '../components/SpeicherHinweis';
import { useZeilenFehler } from '../components/useZeilenFehler';
import EinsatzSeite from '../components/EinsatzSeite';
import {
  Augenbraue,
  Segmentleiste,
  StatusChip,
  useRollen,
  Zeitachseneintrag,
  type SegmentOption,
} from '../components/instrument';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useOhneVerbindung } from '../offline/verbindung';
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
  uebergabeZeit,
} from '../lagemeldungen/zeitachse';
import { KennungsLink } from '../components/kennungsLink';
import { modulName } from '../einsatz/modulRegistry';

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
 * - Zeit, Tag, Zeitfenster und Ordnung sind die Ereigniszeit der Quellmeldung (`ereigniszeit`),
 *   nicht die Übergabe (LLH-1039); die Übergabe steht als „übergeben …“ im Meta
 *   (`uebergabeZeit`).
 * - Tagesgruppen jüngster Tag zuerst, Tagesgrenze in der Anzeigezone (`lagemeldungen/zeitachse.ts`,
 *   `gruppiereNachTag` über `tagesSchluessel`/`tagesEtikett`). In der Gruppe genügt `HH:mm` — der
 *   Tag steht im Kopf.
 * - Rückweg zur Quellmeldung über `meldungenPfad`, im Meta der Zeile.
 * - Filterachsen (Zeitfenster, Koordinaten, Freitext) als Filterleiste über der Achse, Prädikate in
 *   `filtereLagemeldungen`.
 *
 * Typkante und Typwort sind die des ETB-Typs „Lage" (`etbTyp.lage`): eine übergebene Lagemeldung
 * ist ein Lageeintrag, eine zweite Farbe wäre erfunden.
 *
 * Neu und gesehen (LLH-1206, Spec `lagemeldung-kenntnisnahme`): eine neue Zeile trägt die Marke
 * „Neu“, mit Schreibrecht den Knopf „Als gesehen markieren“; der Kopf markiert alle bis zur
 * jüngsten geladenen. Der Stand gilt für alle; dieselbe Zahl zeigt der Modulzähler. Eine Ablehnung
 * steht an der Zeile bzw. im Seitenhinweis, nie im Toast (`frontend/AGENTS.md`, „Rückwege und
 * Fehler“).
 */
const GESEHEN_FEHLER = 'Konnte nicht als gesehen markiert werden';

export default function LagemeldungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { konventionen } = useAnzeigeKonventionen();
  const { token, rollen } = useRollen();
  const queryClient = useQueryClient();
  const ohneVerbindung = useOhneVerbindung();
  const [filter, setFilter] = useState<LageFilter>(LEERER_FILTER);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const lageQuery = useQuery({
    queryKey: einsatzKeys.lagemeldungen(einsatzId),
    queryFn: () => listeLageMeldungen(einsatzId),
  });

  const neuAbgleichen = () => {
    void queryClient.invalidateQueries({ queryKey: einsatzKeys.lagemeldungen(einsatzId) });
    void queryClient.invalidateQueries({ queryKey: einsatzKeys.modulZaehler(einsatzId) });
  };
  const zeilenFehler = useZeilenFehler<number>();
  const gesehenMutation = useMutation({
    mutationFn: (lageId: number) => markLageMeldungGesehen(einsatzId, lageId),
    onMutate: (lageId) => zeilenFehler.beginne(lageId),
    onSuccess: neuAbgleichen,
    onError: (fehler, lageId) => zeilenFehler.melde(lageId, fehler, GESEHEN_FEHLER),
  });
  const alleGesehenMutation = useMutation({
    mutationFn: (bisId: number) => markLageMeldungenGesehen(einsatzId, bisId),
    onSuccess: neuAbgleichen,
  });
  // Ein anderer Einsatz räumt die Gründe des vorigen.
  const { leere } = zeilenFehler;
  const { reset: alleGesehenReset } = alleGesehenMutation;
  useEffect(() => {
    leere();
    alleGesehenReset();
  }, [einsatzId, leere, alleGesehenReset]);

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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);
  // Die jüngste geladene Lagemeldung: was danach eingeht, bleibt neu.
  const juengsteId = eintraege.reduce((max, l) => Math.max(max, l.id), 0);
  const hatNeue = eintraege.some((l) => l.is_neu);

  const zeilenHinweis = (l: LageMeldung) => {
    const ort =
      l.lat != null && l.lon != null ? (
        <KoordinatenAnzeige
          lat={l.lat}
          lon={l.lon}
          einsatzId={l.einsatz_id}
          exclude={`lagemeldung:${l.id}`}
        />
      ) : null;
    const grund = zeilenFehler.grund(l.id);
    if (!grund) return ort ?? undefined;
    return (
      <Flex vertical gap={token.marginXXS}>
        {ort}
        <ZeilenFehler fehler={grund.fehler} fallback={grund.fallback} />
      </Flex>
    );
  };

  const zeile = (l: LageMeldung) => (
    <Zeitachseneintrag
      key={l.id}
      als="li"
      zeit={formatUhrzeit(l.ereigniszeit, konventionen)}
      typ="lage"
      typwort={etbTyp.lage.label}
      meta={
        // Deeplink zur Quellmeldung — der einzige Weg zurück zum Vorgang.
        <>
          {l.is_neu && <StatusChip ton="bedien" wort="Neu" style={{ marginInlineEnd: 8 }} />}
          {'aus '}
          <KennungsLink to={meldungenPfad(l.einsatz_id, { meldung: l.meldung_id })}>
            Meldung #{l.meldung_lfd_nr}
          </KennungsLink>
          {` · übergeben ${uebergabeZeit(l.ereigniszeit, l.erstellt_at, konventionen)}`}
          {!l.is_neu && l.gesehen_at && (
            <>
              {` · gesehen ${formatUhrzeit(l.gesehen_at, konventionen)}`}
              {l.gesehen_von_name && ` · ${l.gesehen_von_name}`}
            </>
          )}
        </>
      }
      aktionen={
        l.is_neu && darfSchreiben ? (
          <Button
            disabled={ohneVerbindung}
            loading={gesehenMutation.isPending && gesehenMutation.variables === l.id}
            onClick={() => gesehenMutation.mutate(l.id)}
          >
            Als gesehen markieren
          </Button>
        ) : undefined
      }
      hinweis={zeilenHinweis(l)}
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
    // Eine Lagemeldung entsteht in den Meldungen: der Knopf führt dorthin, kein Satz erklärt den
    // Weg (LFH-965, Spec `modul-benennung`).
    inhalt = (
      <SeitenLeer
        titel="Noch keine Lagemeldungen"
        aktion={{ label: 'Zu den Meldungen', pfad: meldungenPfad(einsatzId) }}
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
      titel={modulName('lagemeldungen')}
      meta={
        lageQuery.isSuccess
          ? filterAktiv(filter)
            ? `${gefiltert} von ${eintraege.length} übergeben`
            : `${eintraege.length} übergeben`
          : undefined
      }
      dataUpdatedAt={lageQuery.dataUpdatedAt}
      hinweis={
        <SeitenHinweise fehler={alleGesehenMutation.error} fehlerFallback={GESEHEN_FEHLER} />
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('lagemeldungen') },
          ]}
        />
      }
    >
      {hatNeue && darfSchreiben && (
        <div
          style={{ display: 'flex', justifyContent: 'flex-end', marginBlockEnd: token.marginSM }}
        >
          <Button
            disabled={ohneVerbindung}
            loading={alleGesehenMutation.isPending}
            onClick={() => alleGesehenMutation.mutate(juengsteId)}
          >
            Alle als gesehen markieren
          </Button>
        </div>
      )}
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
