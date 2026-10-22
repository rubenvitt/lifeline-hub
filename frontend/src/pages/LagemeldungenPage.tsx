import { IconChevronHoch, IconKreuz, IconPlus } from '../icons';
import { Alert, App, Breadcrumb, Button, Flex, Input, Space, Spin } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import {
  LAGE_GESEHEN_MAX,
  listeLageMeldungen,
  markLageMeldungenGesehen,
  markLageMeldungGesehen,
} from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type { LageMeldung, NeueMeldung } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import KoordinatenAnzeige from '../anzeige/KoordinatenAnzeige';
import { formatUhrzeit } from '../anzeige/format';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { SeitenLeer, SeitenSkeleton } from '../components/SeitenZustand';
import { SeitenHinweise, ZeilenFehler } from '../components/SpeicherHinweis';
import type { Speicherung } from '../components/Erfassung';
import { MODUL_MELDUNGEN_GESPERRT, einsatzRechteGrund } from '../components/nurAnsicht';
import { useZeilenFehler } from '../components/useZeilenFehler';
import EinsatzSeite from '../components/EinsatzSeite';
import {
  Augenbraue,
  Paneel,
  Segmentleiste,
  StatusChip,
  useRollen,
  Zeitachseneintrag,
  type SegmentOption,
} from '../components/instrument';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { useFunktionsVorschlaege } from '../fuehrung/useFunktionsVorschlaege';
import { MELDUNG_STATUS } from '../kommunikation';
import PrioBadge from '../kommunikation/PrioBadge';
import BerichtigtMarke from '../meldungen/BerichtigtMarke';
import MeldungFormular from '../meldungen/MeldungFormular';
import LageAngabenBearbeiten from '../meldungen/LageAngabenBearbeiten';
import { MELDUNGSART_LABEL } from '../meldungen/meldungKennzahlen';
import { erfasseMeldungOfflineFaehig } from '../offline/schreiben';
import { useOhneVerbindung } from '../offline/verbindung';
import { meldungenPfad } from '../routing/deeplinks';
import { etbTyp } from '../theme/statusFarben';
import {
  LEERER_FILTER,
  ZEITFENSTER,
  filterAktiv,
  filtereLagemeldungen,
  gruppiereNachTag,
  type Herkunftsfilter,
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

const HERKUNFT_OPTIONEN: SegmentOption<Herkunftsfilter>[] = [
  { wert: 'alle', label: 'Alle' },
  { wert: 'geraet', label: 'Gerät' },
  { wert: 'uebernommen', label: 'Übernommen' },
];

/**
 * Die Lage-Sicht auf den Meldungseingang als Zeitachse (LLH-1031: jede Lagemeldung ist eine
 * Meldung; hier stehen die Art Lagemeldung ab der Anlage und übernommene Meldungen) — wie das ETB: eine chronologische Folge wird gelesen („was
 * ist passiert?"), nicht verglichen.
 *
 * Deshalb keine `Datensicht`: keine Spalte wird verglichen, die Ordnung ist die Zeit, und die Zeile
 * braucht Zeit · Typkante · Text · Herkunft · Ort — das trägt der Baustein `Zeitachseneintrag`,
 * nicht der Kartenplan (Titel + drei Sekundärfelder).
 *
 * - Zeit, Tag, Zeitfenster und Ordnung sind die Ereigniszeit der Quellmeldung (`ereigniszeit`),
 *   nicht die Übergabe (LLH-1039); die Übernahme steht als „übernommen …“ im Meta
 *   (`uebergabeZeit`).
 * - Tagesgruppen jüngster Tag zuerst, Tagesgrenze in der Anzeigezone (`lagemeldungen/zeitachse.ts`,
 *   `gruppiereNachTag` über `tagesSchluessel`/`tagesEtikett`). In der Gruppe genügt `HH:mm` — der
 *   Tag steht im Kopf.
 * - Rückweg zur Quellmeldung über `meldungenPfad`, im Meta der Zeile.
 * - Filterachsen (Zeitfenster, Koordinaten, Herkunft, Freitext) als Filterleiste über der Achse,
 *   Prädikate in `filtereLagemeldungen`.
 * - „Lagemeldung erfassen“ öffnet über der Achse das Meldungsformular mit der Art Lagemeldung
 *   (`artVorgabe`) und schließt nach dem Erfassen; gesendet wie im Meldungseingang
 *   (`erfasseMeldungOfflineFaehig`). Ohne Schreibrecht im Einsatz oder ohne Modul Meldungen steht
 *   stattdessen „Nur Ansicht · Grund“ im Kopf. Später auf den Baustein „Bearbeiten in der
 *   Ansicht“ umstellen (LLH-1022).
 *
 * Typkante ist die des ETB-Typs „Lage" (`etbTyp.lage`): jede Zeile ist ein Lageeintrag, eine zweite
 * Farbe wäre erfunden. Das Typwort ist „Lage“, bei einer übernommenen Meldung anderer Art deren Wort.
 *
 * Neu und gesehen (LLH-1206, Spec `lagemeldung-kenntnisnahme`): eine neue Zeile trägt die Marke
 * „Neu“, mit Schreibrecht den Knopf „Als gesehen markieren“; der Kopf markiert die angezeigten
 * neuen (nach Filter, über ihre Kennungen). Der Stand gilt für alle; dieselbe Zahl zeigt der Modulzähler. Eine Ablehnung
 * steht an der Zeile bzw. im Seitenhinweis, nie im Toast (`frontend/AGENTS.md`, „Rückwege und
 * Fehler“).
 *
 * Lage-Text und Verortung (LLH-1066): „Bearbeiten“ an der Zeile öffnet sie an Ort und Stelle
 * (`LageAngabenBearbeiten`), mit denselben Rechten wie das Erfassen. Später auf den Baustein
 * „Bearbeiten in der Ansicht“ umstellen.
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
  const [formOffen, setFormOffen] = useState(false);
  // Die Zeile, deren Lage-Angaben gerade bearbeitet werden (Kennung der Meldung).
  const [bearbeitetId, setBearbeitetId] = useState<number | null>(null);
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const meldungenGesperrt = useSprungSperre(einsatzId)('meldungen');

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const lageQuery = useQuery({
    queryKey: einsatzKeys.lagemeldungen(einsatzId),
    queryFn: () => listeLageMeldungen(einsatzId),
  });

  // Absender-Auswahl und Empfängerfunktion des Formulars: erst geladen, wenn es offen ist.
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: formOffen,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: formOffen,
  });
  const funktionsVorschlaege = useFunktionsVorschlaege(formOffen ? einsatzId : undefined);

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
    mutationFn: (meldungIds: number[]) => markLageMeldungenGesehen(einsatzId, meldungIds),
    onSuccess: neuAbgleichen,
  });
  // Wie im Meldungseingang (LFH-705): ohne Netz merkt die Funktion selbst vor, TanStacks Vorgabe
  // hielte die Mutation an. Den Grund einer Ablehnung zeigt das Formular (`speicherung`).
  const erfassenMutation = useMutation({
    networkMode: 'always',
    mutationFn: ({ einsatzId: eid, daten }: { einsatzId: number; daten: NeueMeldung }) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfasseMeldungOfflineFaehig(benutzer.id, eid, daten);
    },
    onSuccess: (ergebnis, { einsatzId: eid, daten }) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        message.warning(`Offline vorgemerkt: Lagemeldung von ${daten.absender}`);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: einsatzKeys.lagemeldungen(eid) });
      void queryClient.invalidateQueries({ queryKey: einsatzKeys.meldungen(eid) });
      void queryClient.invalidateQueries({ queryKey: einsatzKeys.modulZaehler(eid) });
      message.success(`Lagemeldung #${ergebnis.daten.lfd_nr} erfasst`);
    },
  });
  // Nur das Erfassen DIESES Einsatzes gehört ins Paneel.
  const diesesErfassen = erfassenMutation.variables?.einsatzId === einsatzId;
  const erfassenSpeicherung: Speicherung = {
    error: diesesErfassen ? erfassenMutation.error : null,
    isPending: diesesErfassen && erfassenMutation.isPending,
    reset: erfassenMutation.reset,
  };
  // Ein anderer Einsatz räumt die Gründe des vorigen.
  const { leere } = zeilenFehler;
  const { reset: alleGesehenReset } = alleGesehenMutation;
  useEffect(() => {
    leere();
    alleGesehenReset();
    setFormOffen(false);
    setBearbeitetId(null);
  }, [einsatzId, leere, alleGesehenReset]);

  const eintraege = useMemo(() => lageQuery.data ?? [], [lageQuery.data]);
  const angezeigt = useMemo(
    () => filtereLagemeldungen(eintraege, filter, konventionen),
    [eintraege, filter, konventionen],
  );
  const gruppen = useMemo(
    () => gruppiereNachTag(angezeigt, konventionen),
    [angezeigt, konventionen],
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
  const gefiltert = angezeigt.length;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);
  // Erfassen schreibt eine Meldung: Schreibrecht im Einsatz UND Modul Meldungen.
  const darfErfassen = darfSchreiben && !meldungenGesperrt;
  const rechteGrund = !darfSchreiben
    ? einsatzRechteGrund(einsatz.status)
    : meldungenGesperrt
      ? MODUL_MELDUNGEN_GESPERRT
      : undefined;
  // Die angezeigten neuen: was inzwischen eingeht oder weggefiltert ist, bleibt neu.
  const angezeigteNeue = angezeigt.filter((l) => l.is_neu).map((l) => l.id);
  const zahlWort = (n: number) => (n === 1 ? 'Lagemeldung' : 'Lagemeldungen');

  const zeilenHinweis = (l: LageMeldung) => {
    if (darfErfassen && bearbeitetId === l.meldung_id) {
      return (
        <LageAngabenBearbeiten
          einsatzId={einsatzId}
          lage={l}
          onFertig={() => setBearbeitetId(null)}
        />
      );
    }
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
      typwort={
        l.meldungsart === 'lagemeldung'
          ? etbTyp.lage.label
          : (MELDUNGSART_LABEL[l.meldungsart] ?? etbTyp.lage.label)
      }
      meta={
        // Deeplink zur Meldung — der Weg zum Vorgang; ihr Stand steht dabei, solange er nicht
        // „neu“ ist (die Marke „Neu“ ist die Kenntnisnahme der Lage, nicht der Meldungsstatus).
        <>
          {l.is_neu && <StatusChip ton="bedien" wort="Neu" style={{ marginInlineEnd: 8 }} />}
          {l.prioritaet !== 'normal' && (
            <span style={{ marginInlineEnd: 8 }}>
              <PrioBadge prio={l.prioritaet} />
            </span>
          )}
          {l.richtung === 'extern' && (
            <StatusChip ton="neutral" wort="Extern" style={{ marginInlineEnd: 8 }} />
          )}
          {/* Der Text bleibt Lage-Text oder Wortlaut, die Berichtigung steht im ETB (LLH-1382, D1). */}
          <BerichtigtMarke
            einsatzId={l.einsatz_id}
            berichtigungId={l.etb_berichtigung_id}
            berichtigungLfdNr={l.etb_berichtigung_lfd_nr}
            style={{ marginInlineEnd: 8 }}
          />
          <KennungsLink to={meldungenPfad(l.einsatz_id, { meldung: l.meldung_id })}>
            {`Meldung #${l.meldung_lfd_nr}`}
            {l.meldung_status !== 'neu' &&
              ` · ${MELDUNG_STATUS[l.meldung_status]?.label ?? l.meldung_status}`}
          </KennungsLink>
          {` · übernommen ${uebergabeZeit(l.ereigniszeit, l.erstellt_at, konventionen)}`}
          {!l.is_neu && l.gesehen_at && (
            <>
              {` · gesehen ${formatUhrzeit(l.gesehen_at, konventionen)}`}
              {l.gesehen_von_name && ` · ${l.gesehen_von_name}`}
            </>
          )}
        </>
      }
      aktionen={
        (l.is_neu && darfSchreiben) || (darfErfassen && bearbeitetId !== l.meldung_id) ? (
          <Space wrap>
            {l.is_neu && darfSchreiben && (
              <Button
                disabled={ohneVerbindung}
                loading={gesehenMutation.isPending && gesehenMutation.variables === l.id}
                onClick={() => gesehenMutation.mutate(l.id)}
              >
                Als gesehen markieren
              </Button>
            )}
            {darfErfassen && bearbeitetId !== l.meldung_id && (
              <Button
                disabled={ohneVerbindung}
                aria-label={`Lage-Angaben zu Meldung #${l.meldung_lfd_nr} bearbeiten`}
                onClick={() => setBearbeitetId(l.meldung_id)}
              >
                Bearbeiten
              </Button>
            )}
          </Space>
        ) : undefined
      }
      hinweis={zeilenHinweis(l)}
      verfasser={l.is_von_geraet ? `${l.meldung_absender} · Gerät` : l.meldung_absender}
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
        title="Lagemeldungen konnten nicht geladen werden"
        action={<Button onClick={() => void lageQuery.refetch()}>Erneut laden</Button>}
      />
    );
  } else if (eintraege.length === 0) {
    // Eine Lagemeldung entsteht hier: der Knopf öffnet das Erfassen, kein Satz erklärt den Weg
    // (LFH-965, Spec `modul-benennung`). Ohne Recht nur der Titel.
    inhalt = (
      <SeitenLeer
        titel="Noch keine Lagemeldungen"
        aktion={
          darfErfassen && !formOffen
            ? { label: 'Lagemeldung erfassen', onClick: () => setFormOffen(true) }
            : undefined
        }
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
            ? `${gefiltert} von ${eintraege.length} ${zahlWort(eintraege.length)}`
            : `${eintraege.length} ${zahlWort(eintraege.length)}`
          : undefined
      }
      dataUpdatedAt={lageQuery.dataUpdatedAt}
      hinweis={
        <SeitenHinweise
          fehler={alleGesehenMutation.error}
          fehlerFallback={GESEHEN_FEHLER}
          rechteFehlt={rechteGrund != null}
          rechteText={rechteGrund}
        />
      }
      aktionen={
        darfErfassen && (
          // Solange eine Lagemeldung unterwegs ist, bleibt das Paneel offen: die Antwort braucht
          // ihren Ort.
          <Button
            type="primary"
            icon={formOffen ? <IconChevronHoch /> : <IconPlus />}
            disabled={formOffen && erfassenSpeicherung.isPending}
            onClick={() => setFormOffen(!formOffen)}
          >
            {formOffen ? 'Formular schließen' : 'Lagemeldung erfassen'}
          </Button>
        )
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
      {darfErfassen && formOffen && (
        <Paneel
          titel="Lagemeldung erfassen"
          koerperPolster
          style={{ marginBlockEnd: token.margin }}
          aktion={
            <Button
              type="text"
              icon={<IconKreuz />}
              disabled={erfassenSpeicherung.isPending}
              onClick={() => setFormOffen(false)}
              aria-label="Formular schließen"
            />
          }
        >
          <MeldungFormular
            card={false}
            artVorgabe="lagemeldung"
            serie={false}
            onFertig={() => setFormOffen(false)}
            einsatzId={einsatzId}
            senden={erfassenSpeicherung.isPending}
            // mutateAsync: die Erfassungshülle leert nur, wenn die Meldung angekommen ist.
            onAnlegen={(daten) => erfassenMutation.mutateAsync({ einsatzId, daten })}
            speicherung={erfassenSpeicherung}
            einheiten={einheitenQuery.data}
            abschnitte={abschnitteQuery.data}
            funktionsVorschlaege={funktionsVorschlaege}
          />
        </Paneel>
      )}
      {angezeigteNeue.length > 0 && darfSchreiben && (
        <div
          style={{ display: 'flex', justifyContent: 'flex-end', marginBlockEnd: token.marginSM }}
        >
          <Button
            disabled={ohneVerbindung}
            loading={alleGesehenMutation.isPending}
            // Höchstens so viele je Aufruf, wie der Server annimmt; der Rest bleibt neu.
            onClick={() => alleGesehenMutation.mutate(angezeigteNeue.slice(0, LAGE_GESEHEN_MAX))}
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
          <Segmentleiste
            beschriftung="Herkunft"
            optionen={HERKUNFT_OPTIONEN}
            wert={filter.herkunft}
            onWechsel={(herkunft) => setFilter((f) => ({ ...f, herkunft }))}
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
