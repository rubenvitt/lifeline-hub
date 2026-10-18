import { IconPersonPlus } from '../../icons';
import { useModulFreigaben, useSprungSperre } from '../../einsatz/useSprungSperre';
import { istKeyFreigegeben, KEINE_BERECHTIGUNG } from '../../einsatz/modulRegistry';
import { sprungGesperrtText } from '../../components/Sprung';
import { Alert, App, Breadcrumb, Button, Flex, Popconfirm, Space, Spin } from 'antd';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId } from 'react';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben, istEinsatzLeitung } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import {
  einsaetzePfad,
  einsatzPfad,
  parseRouteId,
  parseUhsBereich,
  uhsBereichSuche,
  unfallhilfsstellenListePfad,
  type UhsBereich,
} from '../../routing/deeplinks';
import { useEinsatzPfade } from '../../routing/EinsatzPfade';
import { useGeraetDarf } from '../../geraet/geraetSicht';
import { ladeUhs, setzeUhsStatus, storniereUhs } from '../../api/einsatzUhs';
import { listePersonen } from '../../api/einsatzPerson';
import { einsatzKeys } from '../../api/queryKeys';
import type { UhsStatus } from '../../api/types';
import EinsatzSeite from '../../components/EinsatzSeite';
import { useRollen } from '../../components/instrument/rollenwerte';
import { useViewport } from '../../components/useViewport';
import StatusTag from '../../components/StatusTag';
import { Segmentleiste } from '../../components/instrument';
import { uhsStatus, uhsTyp } from '../../theme/statusFarben';
import UhsSwitcher from './UhsSwitcher';
import { merkeLetzteUhs } from './uhsAuswahl';
import Grundriss from './Grundriss';
import MaterialTab from './MaterialTab';
import UhsLagezeile from './UhsLagezeile';
import BewegungenTab from './BewegungenTab';
import UhsAnhaenge from './UhsAnhaenge';
import UhsKraefte from './UhsKraefte';
import { staerkeText } from '../../anzeige/staerke';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { KennungsLink } from '../../components/kennungsLink';
import { materialKopfzahl } from '../../kraefte/materialVerdichtungKern';

/**
 * Die Bereiche der Seite (LLH-1133, Spec `uhs-grundriss`, „Die UHS-Seite gliedert sich in
 * Bereiche“): eine Leiste unter dem Kopf, der gewählte Bereich füllt die Arbeitsfläche bis zur
 * Fensterhöhe. Die Belegung (der Grundriss) ist die Vorgabe; die Wahl steht in der Adresse.
 */
const BEREICH_NAME: Record<UhsBereich, string> = {
  belegung: 'Belegung',
  material: 'Material',
  kraefte: 'Kräfte',
  bewegungen: 'Bewegungen',
  dateien: 'Dateien',
};

/** „Belegung, Material und Bewegungen“: der Name der Bereichsleiste nennt, was sie führt. */
function aufzaehlung(namen: string[]): string {
  return namen.length < 2
    ? (namen[0] ?? '')
    : `${namen.slice(0, -1).join(', ')} und ${namen[namen.length - 1]}`;
}

export default function UhsDetailPage() {
  const { id, uhsId: uhsIdParam } = useParams();
  const einsatzId = Number(id);
  // Aufnahme führt ins Modul Personen (LFH-888, design.md D4): gesperrt mit Grund statt ins 403.
  const personenGesperrt = useSprungSperre(einsatzId)('personen');
  const navigate = useNavigate();
  // Ein gekoppeltes Gerät sieht nur, was seine Ansicht bedient (LFH-892, Scope-Matrix); für eine
  // Person ist alles frei. Die Wege führen in die Oberfläche, aus der man kommt.
  const darf = useGeraetDarf();
  const pfade = useEinsatzPfade();
  // Am Gerät stehen Material, Kräfte und Dateien im Bereich „UHS“ des Laptops
  // (`geraet/GeraetStellePage`), die Wege führt die Gerätenavigation: dort ist diese Seite nur die
  // Belegung, und der Verlauf folgt darunter im Seitenfluss, ohne Bereichsleiste.
  const { geraet } = useAuth();
  const { token } = useRollen();
  const { abBreite } = useViewport();
  const bereichListe: UhsBereich[] = geraet
    ? ['belegung']
    : [
        'belegung',
        ...(darf('uhs-material') ? (['material'] as const) : []),
        // LFH-1045: die Kräfte der UHS.
        'kraefte',
        'bewegungen',
        // LFH-758: Fotos, Unterlagen und der Plan (Grundriss als Datei) der UHS.
        ...(darf('uhs-anhaenge') ? (['dateien'] as const) : []),
      ];
  // Der Bereich steht in der Adresse (`?bereich=`); einer, den diese Sicht nicht führt (Gerät),
  // fällt wie ein unbekannter auf die Belegung zurück. Nur der gewählte Bereich ist gebaut.
  const [searchParams, setSearchParams] = useSearchParams();
  const gewuenscht = parseUhsBereich(searchParams);
  const bereich: UhsBereich = bereichListe.includes(gewuenscht) ? gewuenscht : 'belegung';
  // Ersetzen statt Anhängen: das Zurück des Browsers verlässt die Seite, statt durch die Bereiche
  // zu blättern. Andere Parameter bleiben stehen.
  const waehleBereich = (neu: UhsBereich) =>
    setSearchParams(
      (alt) => {
        const naechste = new URLSearchParams(alt);
        naechste.delete('bereich');
        for (const [k, v] of new URLSearchParams(uhsBereichSuche(neu))) naechste.set(k, v);
        return naechste;
      },
      { replace: true },
    );
  const bereichFeld = useId();
  // Die Materialzahl im Kopf nur mit Freigabe Material (LLH-1133 D2). Anders als bei einem Sprung
  // heißt unbekannt hier zu: eine Zahl, die beim Eintreffen der Freigaben verschwände, stünde
  // kurz falsch da.
  const materialFrei = istKeyFreigegeben('material', useModulFreigaben(einsatzId));
  const uhsId = Number(uhsIdParam);
  const idGueltig = parseRouteId(uhsIdParam) != null;
  const listenPfad = unfallhilfsstellenListePfad(einsatzId);

  const qc = useQueryClient();
  const { message } = App.useApp();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const detailQuery = useQuery({
    queryKey: einsatzKeys.uhsDetail(einsatzId, uhsId),
    queryFn: () => ladeUhs(einsatzId, uhsId),
    enabled: idGueltig,
  });

  // Wer noch in dieser UHS steht, sperrt „Auflösen“ (der Server prüft dasselbe, 409). Derselbe
  // Schlüssel und Abruf wie im Grundriss — ein Cache-Fach, kein zweiter Abruf.
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
    enabled: idGueltig,
  });
  const nochBelegt = (personenQuery.data ?? []).filter(
    (p) => p.aktuelle_uhs_id === uhsId && !p.storniert_at,
  ).length;

  // Diese UHS als „zuletzt ausgewählt" merken — der Default-Einstieg landet wieder hier.
  // Ein Gerät kennt nur seine eine UHS und merkt sich nichts.
  const merkeUhs = darf('uhs-verwalten');
  useEffect(() => {
    if (merkeUhs && detailQuery.isSuccess) merkeLetzteUhs(einsatzId, uhsId);
  }, [einsatzId, uhsId, detailQuery.isSuccess, merkeUhs]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhsId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  // Status und Storno sind Kopfaktionen: ihre Ablehnung steht im Seitenhinweis, kein Toast
  // (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“).
  const statusMut = useMutation({
    mutationFn: (status: UhsStatus) => setzeUhsStatus(einsatzId, uhsId, status),
    onSuccess: () => {
      message.success('Status gewechselt');
      invalidate();
    },
  });
  const stornoMut = useMutation({
    mutationFn: () => storniereUhs(einsatzId, uhsId),
    onSuccess: () => {
      message.success('UHS storniert');
      invalidate();
    },
  });
  // Ein Slot für beide: die zuletzt begonnene Handlung zählt, ihr Start räumt den Grund der
  // anderen. Eine laufende bleibt unberührt.
  const kopfFehler = statusMut.error ?? stornoMut.error;
  const raeume = (andere: typeof statusMut | typeof stornoMut) => {
    if (!andere.isPending && andere.error != null) andere.reset();
  };
  const setzeStatus = (status: UhsStatus) => {
    raeume(stornoMut);
    statusMut.mutate(status);
  };
  const storniere = () => {
    raeume(statusMut);
    stornoMut.mutate();
  };

  // Die Route hat keinen `key`: der Umschalter behält diese Seite. Der Grund der vorigen UHS
  // gehört nicht an die nächste. `reset` ist stabil, der Effekt läuft nur mit `uhsId`.
  const { reset: statusReset } = statusMut;
  const { reset: stornoReset } = stornoMut;
  useEffect(() => {
    statusReset();
    stornoReset();
  }, [uhsId, statusReset, stornoReset]);

  // Ungültige UHS-ID → zurück zur Liste (nach allen Hooks).
  if (!idGueltig) {
    return <Navigate to={listenPfad} replace />;
  }
  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.error || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  if (detailQuery.error || !detailQuery.data) {
    return <Alert type="error" title="UHS konnte nicht geladen werden" showIcon />;
  }

  const einsatz = einsatzQuery.data;
  const uhs = detailQuery.data;
  const schreibgeschuetzt = !darfImEinsatzSchreiben(einsatz);
  const verwalten = !schreibgeschuetzt && darf('uhs-verwalten');

  // Typ und Standort sind Kopf-Meta; der Typ ist eine Kategorie (im Vertrag `neutral`), es zählt
  // nur seine Beschriftung aus `uhsTyp`. Die Notiz ist Freitext und bleibt Beschreibungszeile.
  // Die Stärke steht im Kopf jeder Ansicht (LFH-1045), die Kräfte dazu im Reiter.
  const metaText = [
    uhsTyp[uhs.typ].label,
    uhs.standort ?? 'ohne Standort',
    `Stärke ${staerkeText(uhs.staerke)}`,
  ].join(' · ');
  // Die Materialzahl im Wortlaut des Bausteins („3 Posten · 1 Ausfall“, eine Heimat je Zahl,
  // LLH-1133 D2) als Sprung in den Bereich Material. Ohne diesen Bereich (Gerät) oder ohne
  // Freigabe Material steht keine Zahl.
  const showMaterialzahl = bereichListe.includes('material') && materialFrei;
  // Die Meta bricht im Kopf nicht um (`seitenMetaStil`); vor der Zahl darf sie es, sonst liefe
  // der Kopf bei 390 px über den Rand. Die Teile selbst bleiben ganz.
  const meta = showMaterialzahl ? (
    <span style={{ whiteSpace: 'normal' }}>
      <span style={{ whiteSpace: 'nowrap' }}>{metaText} ·</span> // Ersetzen wie die Bereichsleiste:
      „Zurück“ verlässt die Seite, statt den Bereich zurückzunehmen.
      <KennungsLink to={{ search: uhsBereichSuche('material') }} replace>
        {materialKopfzahl(uhs.material)}
      </KennungsLink>
    </span>
  ) : (
    metaText
  );
  const hasMehrereBereiche = bereichListe.length > 1;
  const showLagezeile = !geraet && abBreite('md');

  return (
    <EinsatzSeite
      /* Der Titel trägt den Umschalter: hier wird zwischen Hilfsstellen gewechselt. */
      titel={
        // `wrap`: bei langem Namen rutscht der Status unter den Namen, statt auf 390 px
        // über den Rand zu ragen (gemessen 11 px, LFH-435).
        <Space wrap>
          {darf('uhs-verwalten') ? (
            <UhsSwitcher einsatzId={einsatzId} aktuelleUhs={uhs} />
          ) : (
            uhs.bezeichnung
          )}
          <StatusTag darstellung={uhsStatus[uhs.status]} />
        </Space>
      }
      meta={meta}
      beschreibung={uhs.notiz ? `Notiz: ${uhs.notiz}` : undefined}
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        kopfFehler != null && (
          <SeitenHinweise
            fehler={kopfFehler}
            fehlerTitel={statusMut.error != null ? 'Status nicht geändert' : 'Nicht storniert'}
            fehlerFallback={
              statusMut.error != null ? 'Statuswechsel fehlgeschlagen' : 'Stornieren fehlgeschlagen'
            }
          />
        )
      }
      /* Datenstand im Kopf über das Primitiv — der Grundriss läuft live mit. */
      dataUpdatedAt={detailQuery.dataUpdatedAt}
      breadcrumb={
        darf('fremde-module') && (
          <Breadcrumb
            items={[
              { title: <Link to={einsaetzePfad()}>Einsätze</Link> },
              { title: <Link to={einsatzPfad(einsatzId)}>{einsatz.bezeichnung}</Link> },
              { title: <Link to={listenPfad}>Unfallhilfsstellen</Link> },
              { title: uhs.bezeichnung },
            ]}
          />
        )
      }
      aktionen={
        <Space wrap size="middle">
          {/* Die Zustände schließen sich aus; die Dev-Warnung des Primitivs zählt die
              Primäraktionen, der Test prüft beide Zustände. */}
          {!schreibgeschuetzt && uhs.status === 'aktiv' && (
            /* Aufnahme ohne Modulwechsel, nur im Betrieb: eine geplante UHS nimmt niemanden auf,
               dort steht „In Betrieb nehmen" als Primäraktion. */
            <Button
              type="primary"
              icon={<IconPersonPlus />}
              disabled={personenGesperrt}
              title={personenGesperrt ? KEINE_BERECHTIGUNG : undefined}
              onClick={() => navigate(pfade.aufnahme(einsatzId, { uhs: uhs.id }))}
            >
              {/* Gesperrt nennt der Knopf den Grund sichtbar (`components/Sprung.tsx`); der
                  `title` erscheint auf Touch nie. Er bleibt Primäraktion, kein Sprung mit „↗“. */}
              {personenGesperrt ? sprungGesperrtText('Patient aufnehmen') : 'Patient aufnehmen'}
            </Button>
          )}
          {verwalten && uhs.status === 'geplant' && (
            <>
              <Button
                type="primary"
                onClick={() => setzeStatus('aktiv')}
                loading={statusMut.isPending}
              >
                In Betrieb nehmen
              </Button>
              <Popconfirm
                title="Unfallhilfsstelle stornieren?"
                okText="Unfallhilfsstelle stornieren"
                onConfirm={storniere}
                okButtonProps={{ danger: true }}
              >
                <Button danger>Stornieren</Button>
              </Popconfirm>
            </>
          )}
          {verwalten && uhs.status === 'aktiv' && (
            <Popconfirm
              title="Unfallhilfsstelle auflösen?"
              okText="Unfallhilfsstelle auflösen"
              onConfirm={() => setzeStatus('aufgeloest')}
              okButtonProps={{ danger: true }}
            >
              {/* Gesperrt mit Grund im Wort (LFH-1078), solange jemand in der UHS steht. */}
              <Button danger disabled={nochBelegt > 0}>
                {nochBelegt > 0
                  ? `Auflösen (noch ${nochBelegt} ${nochBelegt === 1 ? 'Person' : 'Personen'})`
                  : 'Auflösen'}
              </Button>
            </Popconfirm>
          )}
        </Space>
      }
      // Die Leiste gehört zum Kopf, den der Fensterrahmen misst: so steht sie bei 1440 × 900 ohne
      // Bildlauf über dem Grundriss, und jeder Bereich behält die Mindesthöhe. Ein einzelner
      // Bereich ist keine Wahl: dann steht nur die Belegung.
      bereiche={
        hasMehrereBereiche && (
          <Segmentleiste
            rolle="tablist"
            beschriftung={aufzaehlung(bereichListe.map((b) => BEREICH_NAME[b]))}
            wert={bereich}
            onWechsel={waehleBereich}
            optionen={bereichListe.map((b) => ({
              wert: b,
              label: BEREICH_NAME[b],
              steuert: bereichFeld,
            }))}
          />
        )
      }
      fensterInhalt={{
        // Mindest-Arbeitsfläche: unter einem langen Kopf scrollt die Seite, statt den Bereich zu
        // überlagern. 380 px beschreiben die Fläche des Bereichs, keine Kopfhöhe. Die Zahlzeile
        // der Belegung (eine Schriftzeile, LLH-1136) steht IN dieser Fläche: eine Reserve, die mit
        // der Dichte wüchse, kippte den Rahmen beim Dichtewechsel in die ResizeObserver-Schleife.
        mindestHoehe: 380,
        // `key` an der UHS, auch an den Bereichen: die Route hat keinen `key`, der Umschalter
        // behält die Seite. Gründe abgelehnter Aktionen der vorigen UHS gehören nicht an die
        // nächste. Der Grundriss teilt seine Fläche selbst (Unterreiter unter `xl`); die übrigen
        // Bereiche rollen in ihrer Fläche.
        inhalt: (
          <div
            {...(hasMehrereBereiche
              ? { role: 'tabpanel', id: bereichFeld, 'aria-label': BEREICH_NAME[bereich] }
              : {})}
            style={{
              height: '100%',
              minHeight: 0,
              ...(bereich === 'belegung' ? {} : { overflowY: 'auto' }),
            }}
          >
            {bereich === 'belegung' ? (
              // Die Lage der Stelle in Zahlen (LLH-1136) steht IN der Belegung über dem Grundriss,
              // nicht im gemessenen Kopf des Fensterrahmens: dort kippte ihre breitenabhängige Höhe
              // mit der Bildlaufleiste in eine ResizeObserver-Schleife (`e2e/uhs-hoehe.spec.ts`).
              // Am Gerät und unter `md` gehört die Fläche dem Grundriss; der UHS-Laptop trägt die
              // Zahlen im Bereich „UHS“ (`geraet/GeraetStellePage`).
              <Flex vertical gap={token.marginSM} style={{ height: '100%', minHeight: 0 }}>
                {showLagezeile && <UhsLagezeile einsatzId={einsatzId} uhs={uhs} />}
                <div style={{ flex: '1 1 0', minHeight: 0 }}>
                  <Grundriss
                    key={uhs.id}
                    einsatzId={einsatzId}
                    uhs={uhs}
                    schreibgeschuetzt={schreibgeschuetzt}
                    platzBearbeitbar={darf('grundriss-bearbeiten')}
                  />
                </div>
              </Flex>
            ) : bereich === 'kraefte' ? (
              <UhsKraefte
                key={uhs.id}
                einsatzId={einsatzId}
                uhs={uhs}
                schreibgeschuetzt={schreibgeschuetzt}
                einheitZuordnen
              />
            ) : bereich === 'material' ? (
              <MaterialTab
                key={uhs.id}
                einsatzId={einsatzId}
                uhs={uhs}
                schreibgeschuetzt={schreibgeschuetzt}
              />
            ) : bereich === 'bewegungen' ? (
              <BewegungenTab uhs={uhs} dataUpdatedAt={detailQuery.dataUpdatedAt} />
            ) : (
              <UhsAnhaenge
                einsatzId={einsatzId}
                uhs={uhs}
                darfSchreiben={!schreibgeschuetzt}
                zeigeZugriffe={istEinsatzLeitung(einsatz)}
              />
            )}
          </div>
        ),
      }}
    >
      {geraet && (
        <div style={{ marginTop: 16 }}>
          <BewegungenTab uhs={uhs} dataUpdatedAt={detailQuery.dataUpdatedAt} />
        </div>
      )}
    </EinsatzSeite>
  );
}
