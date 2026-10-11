import { App, Breadcrumb, Button, Popconfirm, Space, Tag, Tree, type TreeDataNode } from 'antd';
import { Link, useParams, useSearchParams } from 'react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzKeys } from '../api/queryKeys';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinheiten } from '../api/einheiten';
import {
  listeAbschnitte,
  loeseAbschnittAuf,
  patcheAbschnitt,
  type AbschnittPatch,
} from '../api/einsatzabschnitte';
import type { Einheit, Einsatzabschnitt } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import { Liste, ListenEintrag } from '../components/Liste';
import {
  SeitenFehler,
  SeitenLeer,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import EinsatzSeite from '../components/EinsatzSeite';
import { Augenbraue, Paneel, Segmentleiste, monoStil, useRollen } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import { abschnittStaerken } from './einsatzabschnitte/abschnittStaerke';
import AbschnittKnoten from './einsatzabschnitte/AbschnittKnoten';
import AbschnittDetail, { type AbschnittPatchHandler } from './einsatzabschnitte/AbschnittDetail';
import AbschnittAnlegenModal from './einsatzabschnitte/AbschnittAnlegenModal';
import { abrufZustand } from '../api/abrufZustand';
import {
  einheitenPfad,
  parseAbschnitteAnsicht,
  type AbschnitteAnsicht,
} from '../routing/deeplinks';
import { RechteHinweis, SpeicherFehler } from '../components/SpeicherHinweis';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { SprungKnopf } from '../components/Sprung';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import type { Quelle } from '../stab/luecken';
import Organigramm from './einsatzabschnitte/Organigramm';
import { modulName } from '../einsatz/modulRegistry';

/**
 * Zwei Ansichten derselben Daten (LFH-626): die Gliederung bearbeitet, das Organigramm liest,
 * druckt und übernimmt. Kein Nutzerschalter Tabelle ↔ Karte — das hier sind zwei Fragen.
 */
const ANSICHT_OPTIONEN = [
  { wert: 'gliederung', label: 'Gliederung' },
  { wert: 'organigramm', label: 'Organigramm' },
] as const satisfies readonly { wert: AbschnitteAnsicht; label: string }[];

function baueBaum(abschnitte: Einsatzabschnitt[], einheiten: Einheit[]): TreeDataNode[] {
  const kinder = new Map<number | null, Einsatzabschnitt[]>();
  for (const a of abschnitte) {
    const key = a.ueber_abschnitt_id ?? null;
    if (!kinder.has(key)) kinder.set(key, []);
    kinder.get(key)!.push(a);
  }
  const baue = (parent: number | null): TreeDataNode[] =>
    (kinder.get(parent) ?? []).map((a) => ({
      key: a.id,
      title: (
        <AbschnittKnoten
          abschnitt={a}
          staerke={abschnittStaerken(abschnitte, einheiten, a.id).inklUnter}
          anzahlEinheiten={einheiten.filter((e) => e.abschnitt_id === a.id).length}
        />
      ),
      children: baue(a.id),
    }));
  return baue(null);
}

export default function EinsatzabschnittePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  // „Abschnitt anlegen“ ist eine Erfassung (LFH-1208, design.md D6): kein lokaler Entwurf mehr in
  // der Gliederung, den Datensatz gibt es erst nach dem Absenden.
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const { abBreite } = useViewport();
  const breit = abBreite('md');
  const { token, rollen } = useRollen();
  // Je Einsatz, damit ein Einsatzwechsel in derselben Instanz nicht die Ansicht des vorigen
  // mitnimmt (Muster `FahrzeugePage`).
  const [ansichtNachEinsatz, setAnsichtNachEinsatz] = useState<Record<number, AbschnitteAnsicht>>(
    {},
  );
  const ansicht = ansichtNachEinsatz[einsatzId] ?? 'gliederung';
  const setzeAnsicht = (a: AbschnitteAnsicht) =>
    setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: a }));

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });

  // Cross-Modul-Deeplink: ?abschnitt=<id> selektiert den Abschnitt, sofern vorhanden.
  useQueryParamSelektion('abschnitt', abschnitteQuery.isSuccess, (zid) => {
    if ((abschnitteQuery.data ?? []).some((a) => a.id === zid)) {
      setGewaehlt(zid);
      // Aus dem Organigramm: das Detail steht in der Gliederung (LFH-626, D7).
      setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: 'gliederung' }));
    }
  });

  // Schnellaktion: ?neu=1 öffnet die Erfassung eines neuen Abschnitts (Sprungpalette, LFH-506) —
  // dieselben Schritte wie `anlegenOeffnen`, hier ausgeschrieben, weil die Funktion je Render neu
  // entsteht. Warten bis der Einsatz geladen ist; Param immer löschen, Erfassung nur bei
  // Schreibrecht.
  const [searchParams, setSearchParams] = useSearchParams();
  const darfSchreibenRoh = darfImEinsatzSchreiben(einsatzQuery.data);
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreibenRoh) {
      setAnlegenOffen(true);
      // Der neue Abschnitt steht danach gewählt in der Gliederung, nicht im Organigramm.
      setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: 'gliederung' }));
    }
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('neu');
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, darfSchreibenRoh, einsatzId]);

  // Sichtvorgabe ?ansicht= (LFH-626), apply-then-clean wie auf der Fahrzeugseite. Geräumt wird
  // auch ein unbrauchbarer Wert, sonst stünde er beim Teilen des Links wieder im Auftrag.
  useEffect(() => {
    if (!searchParams.has('ansicht')) return;
    // `?neu=1` gewinnt: der neue Abschnitt steht danach in der Gliederung (Review LFH-626).
    const vorgabe =
      searchParams.get('neu') === '1' ? undefined : parseAbschnitteAnsicht(searchParams);
    if (vorgabe) setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: vorgabe }));
    const rest = new URLSearchParams(searchParams);
    rest.delete('ansicht');
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams, einsatzId]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.abschnitte(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }

  const abschnitte = useMemo(() => abschnitteQuery.data ?? [], [abschnitteQuery.data]);
  const istGesperrt = useSprungSperre(einsatzId);
  // Für das Organigramm: eine fehlende Liste ist kein leerer Bestand (Stärke „—“ mit Grund).
  const einheitenZustand =
    einheitenQuery.data != null ? ('daten' as const) : abrufZustand(einheitenQuery);
  const einheitenQuelle: Quelle<Einheit> = useMemo(
    () => ({ zustand: einheitenZustand, daten: einheitenQuery.data ?? [] }),
    [einheitenZustand, einheitenQuery.data],
  );
  /**
   * Ohne Wahl steht der erste Abschnitt der Gliederung im Detail (LFH-1078): statt einer
   * Aufforderung „Wähle einen Abschnitt im Baum“ zeigt die Seite gleich einen. `gewaehlt` bleibt
   * die Wahl der Person; die Vorwahl ist nur ihr Rückfall.
   */
  const aktuell =
    gewaehlt != null
      ? (abschnitte.find((a) => a.id === gewaehlt) ?? null)
      : (abschnitte.find((a) => a.ueber_abschnitt_id == null) ?? null);

  // Zeilenweg (LFH-1208, design.md D2): EIN Feld je PATCH, nie der Stand vom Öffnen — so
  // überschreibt keine Zeile, was ein anderer Arbeitsplatz inzwischen geändert hat. Der Fehler
  // geht an die Zeile (`mutateAsync` lehnt ab), deshalb kein `onError`-Toast.
  const patch = useMutation({
    mutationFn: ({ aid, patch: p }: { aid: number; etikett: string; patch: AbschnittPatch }) =>
      patcheAbschnitt(einsatzId, aid, p),
    onSuccess: (aktualisiert, { etikett }) => {
      // Erst in den Cache, dann erfüllen: die Zeile zeigt den neuen Wert in derselben Runde, in der
      // sie die Eingabe schließt (Muster Einsatzdaten).
      qc.setQueryData<Einsatzabschnitt[]>(einsatzKeys.abschnitte(einsatzId), (alt) =>
        alt?.map((a) => (a.id === aktualisiert.id ? aktualisiert : a)),
      );
      invalidate();
      message.success(`${etikett} gespeichert`);
    },
  });
  const patchHandler =
    (aid: number): AbschnittPatchHandler =>
    (etikett, p) =>
      patch.mutateAsync({ aid, etikett, patch: p });
  const aufloesen = useMutation({
    mutationFn: (aid: number) => loeseAbschnittAuf(einsatzId, aid),
    onSuccess: () => {
      invalidate();
      setGewaehlt(null);
    },
  });

  /*
   * Auflösen meldet seine Ablehnung im Detailpaneel, kein Toast (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“); die Zeilen melden ihre selbst. Der Grund gehört zum gezeigten
   * Abschnitt: ein neuer Versuch und der Wechsel des Abschnitts räumen ihn. Eine laufende Mutation
   * bleibt unberührt, `reset()` hängte ihr Ergebnis ab. Ref, damit der Effekt beim Wechsel die
   * AKTUELLE Mutation räumt, ohne je Render neu zu laufen.
   */
  const aufloesenRef = useRef(aufloesen);
  aufloesenRef.current = aufloesen;
  const raeumeDetail = useCallback(() => {
    const m = aufloesenRef.current;
    if (!m.isPending && m.error != null) m.reset();
  }, []);

  // Beim Wechsel des angezeigten Abschnitts räumen — auch wenn die Vorwahl wechselt, weil ein
  // anderer Arbeitsplatz den Abschnitt aufgelöst hat. Offene Zeilen räumt `key` am Detail.
  const aktuellId = aktuell?.id;
  useEffect(() => {
    raeumeDetail();
  }, [aktuellId, raeumeDetail]);

  function anlegenOeffnen() {
    raeumeDetail();
    setAnlegenOffen(true);
    setzeAnsicht('gliederung');
  }

  const baumDaten = useMemo(
    () => baueBaum(abschnitte, einheitenQuery.data ?? []),
    [abschnitte, einheitenQuery.data],
  );
  const personal = personalQuery.data ?? [];
  const zugeordneteEinheiten = (einheitenQuery.data ?? []).filter(
    (e) => e.abschnitt_id === aktuell?.id,
  );

  // Zwei Werte, getrennt beschriftet: „eigene" (Bedeutung der Bestandszeile) und „inkl.
  // Unterabschnitte".
  const staerken = aktuell
    ? abschnittStaerken(abschnitte, einheitenQuery.data ?? [], aktuell.id)
    : { eigene: null, inklUnter: null };

  // Zwei Ebenen, getrennt gehalten:
  //
  // Seitenzustand — nur `einsatzQuery`. Ohne sie rendern weder Breadcrumb noch
  // `darfImEinsatzSchreiben(...)`; nur diese Query rechtfertigt einen Frühausstieg.
  //
  // Listenzustand — `abschnitteQuery` und alles Weitere entscheidet an der Stelle der Daten, nie
  // als Frühausstieg: sonst risse ein gescheiterter Nebenabruf die ganze Seite weg.
  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);

  /**
   * Listenzustand der Gliederungs-Karte — der Fehler allein reicht als Bedingung nicht. Ohne
   * Abschnitte im Zwischenspeicher tritt der Fehler an die Stelle des Baums; mit Abschnitten bleibt
   * der Baum stehen und bekommt ein Banner: er ist echt, nur womöglich alt.
   *
   * Gemessen an der ungefilterten Menge (Muster aus `TierePage`/`SchaedenPage`).
   */
  const listeGescheitert = abschnitteQuery.isError && abschnitte.length === 0;
  const standVeraltet = abschnitteQuery.isError && abschnitte.length > 0;

  const einheitenListe = (
    <>
      <Augenbraue
        als="h3"
        style={{ display: 'block', marginTop: token.marginLG, marginBottom: token.marginXS }}
      >
        Zugeordnete Einheiten
      </Augenbraue>
      <Liste
        size="small"
        emptyText="Keine Einheiten zugeordnet"
        dataSource={zugeordneteEinheiten}
        renderItem={(e) => (
          <ListenEintrag>
            <Space>
              <span>{e.name}</span>
              {e.typ_label && <Tag>{e.typ_label}</Tag>}
              <span style={{ ...monoStil(12), color: rollen.gedaempft }}>
                kumuliert <StaerkeAnzeige wert={e.ist_kumuliert} />
              </span>
            </Space>
          </ListenEintrag>
        )}
      />
      {/* Die Zuordnung setzt die Einheit (Feld „Abschnitt“ ihrer Detailseite): ein Sprung
          dorthin statt eines Satzes (LFH-1078). */}
      <div style={{ marginTop: token.marginXS }}>
        <SprungKnopf to={einheitenPfad(einsatzId)} gesperrt={istGesperrt('einheiten')}>
          Zu den Einheiten
        </SprungKnopf>
      </div>
    </>
  );

  return (
    <EinsatzSeite
      titel={modulName('einsatzabschnitte')}

      meta={abschnitteQuery.isSuccess ? `${abschnitte.length} Abschnitte` : undefined}
      dataUpdatedAt={gemeinsamerDatenstand(
        abschnitteQuery.dataUpdatedAt,
        einheitenQuery.dataUpdatedAt,
        personalQuery.dataUpdatedAt,
      )}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('einsatzabschnitte') },
          ]}
        />
      }
      aktionen={
        <Space wrap style={{ minWidth: 0 }}>
          {/* Der Umschalter steht auch ohne Schreibrecht: lesen kann jeder beide Ansichten. */}
          <Segmentleiste<AbschnitteAnsicht>
            beschriftung="Ansicht"
            optionen={ANSICHT_OPTIONEN}
            wert={ansicht}
            onWechsel={setzeAnsicht}
          />
          {darfSchreiben && (
            <Button type="primary" onClick={anlegenOeffnen}>
              Abschnitt anlegen
            </Button>
          )}
        </Space>
      }
      hinweis={
        // Nur gesetzt, wenn er Inhalt hat: ein leerer Slot hielte Abstand frei.
        darfSchreiben ? undefined : (
          <RechteHinweis sichtbar text={einsatzRechteGrund(einsatz.status)} />
        )
      }
    >
      {ansicht === 'organigramm' ? (
        abschnitteQuery.isLoading ? (
          <SeitenSkeleton />
        ) : listeGescheitert ? (
          <SeitenFehler
            text="Abschnitte konnten nicht geladen werden"
            ursache={abschnitteQuery.error}
            onWiederholen={() => void abschnitteQuery.refetch()}
          />
        ) : abschnitte.length === 0 &&
          einheitenQuelle.zustand === 'daten' &&
          einheitenQuelle.daten.length === 0 ? (
          // Leer nur, wenn BEIDE Quellen da sind: ohne Einheiten wäre „keine Abschnitte“ eine
          // Aussage über eine Lage, die niemand geprüft hat.
          <SeitenLeer
            titel="Noch keine Abschnitte"
            aktion={
              darfSchreiben ? { label: 'Abschnitt anlegen', onClick: anlegenOeffnen } : undefined
            }
          />
        ) : (
          <>
            {standVeraltet && (
              <SeitenStandVeraltet onWiederholen={() => void abschnitteQuery.refetch()} />
            )}
            <Organigramm
              einsatz={einsatz}
              abschnitte={abschnitte}
              einheiten={einheitenQuelle}
              datenstand={gemeinsamerDatenstand(
                abschnitteQuery.dataUpdatedAt,
                einheitenQuery.dataUpdatedAt,
              )}
            />
          </>
        )
      ) : (
        /* Unter `md` stapeln statt einer 360-px-Spalte neben dem Detail. Kein Collapse:
          gestapelt trägt die Gliederung dieselbe Bedienung wie breit. */
        <div
          data-testid="abschnitte-rahmen"
          style={{
            display: 'flex',
            flexDirection: breit ? 'row' : 'column',
            gap: token.margin,
            alignItems: breit ? 'flex-start' : 'stretch',
          }}
        >
          <div
            data-testid="abschnitte-gliederung"
            style={breit ? { flex: '0 0 360px', minWidth: 0 } : { width: '100%' }}
          >
            <Paneel
              titel="Gliederung"
              meta={abschnitteQuery.isSuccess ? String(abschnitte.length) : undefined}
              koerperPolster
            >
              {/* Drei Zustände in dieser Reihenfolge: eine Weiche auf die Länge der Liste wäre
                auch beim Laden und im Fehlerfall wahr. Solange geladen wird, wird über die
                Menge nichts behauptet.

                Der Fehlerzweig trägt zusätzlich die Mengenbedingung (`listeGescheitert`): er
                verdrängt den Baum nur, wenn es keinen gibt. */}
              {abschnitteQuery.isLoading ? (
                <SeitenSkeleton />
              ) : listeGescheitert ? (
                <SeitenFehler
                  text="Abschnitte konnten nicht geladen werden"
                  ursache={abschnitteQuery.error}
                  onWiederholen={() => void abschnitteQuery.refetch()}
                />
              ) : abschnitte.length === 0 ? (
                <SeitenLeer
                  titel="Noch keine Abschnitte"
                  /* Derselbe Wortlaut wie der Kopfknopf. Ohne Schreibrecht keine Aktion — ein
                   Knopf, der nur eine Fehlermeldung auslöst, ist kein Weg aus dem Leerzustand. */
                  aktion={
                    darfSchreiben
                      ? { label: 'Abschnitt anlegen', onClick: anlegenOeffnen }
                      : undefined
                  }
                />
              ) : (
                <>
                  {standVeraltet && (
                    <SeitenStandVeraltet onWiederholen={() => void abschnitteQuery.refetch()} />
                  )}
                  <Tree
                    treeData={baumDaten}
                    selectedKeys={aktuell ? [aktuell.id] : []}
                    defaultExpandAll
                    onSelect={(keys) => setGewaehlt(keys.length ? Number(keys[0]) : null)}
                  />
                </>
              )}
            </Paneel>
          </div>

          <Paneel
            style={{ flex: 1, width: breit ? undefined : '100%' }}
            koerperPolster
            titel={aktuell ? `Abschnitt: ${aktuell.name}` : 'Kein Abschnitt gewählt'}
          >
            {/* Ohne Abschnitt (leere Gliederung, Ladefehler) trägt der Titel den Zustand; den
                Weg hinaus zeigt der Leerzustand der Gliederung. */}
            {aktuell && (
              <>
                {/* `key`: ein Wechsel des Abschnitts schließt jede offene Zeile, sonst speicherte
                    ihr Entwurf in den nächsten. */}
                <AbschnittDetail
                  key={aktuell.id}
                  abschnitt={aktuell}
                  abschnitte={abschnitte}
                  personal={personal}
                  einsatzId={einsatzId}
                  staerken={staerken}
                  darfSchreiben={darfSchreiben}
                  onPatch={patchHandler(aktuell.id)}
                />

                {darfSchreiben && (
                  // Rot, abgesetzt, mit Rückfrage (LFH-363): Auflösen ist unumkehrbar.
                  <div style={{ marginTop: token.marginLG }}>
                    <DetailFehler fehler={aufloesen.error} />
                    <Popconfirm
                      title="Abschnitt auflösen?"
                      description={
                        'Unter-Abschnitte rücken hoch, zugeordnete Einheiten werden „nicht zugeordnet“.'
                      }
                      okText="Abschnitt auflösen"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => {
                        raeumeDetail();
                        aufloesen.mutate(aktuell.id);
                      }}
                    >
                      <Button danger>Auflösen</Button>
                    </Popconfirm>
                  </div>
                )}

                {einheitenListe}
              </>
            )}
          </Paneel>
        </div>
      )}
      {darfSchreiben && (
        <AbschnittAnlegenModal
          offen={anlegenOffen}
          einsatzId={einsatzId}
          abschnitte={abschnitte}
          onAngelegt={(id) => {
            setGewaehlt(id);
            setzeAnsicht('gliederung');
          }}
          onSchliessen={() => setAnlegenOffen(false)}
        />
      )}
    </EinsatzSeite>
  );
}

/** Grund eines abgelehnten Auflösens im Detailpaneel, über dem Knopf (LFH-1077). */
function DetailFehler({ fehler }: { fehler: unknown }) {
  const { token } = useRollen();
  if (fehler == null) return null;
  return (
    <div style={{ marginBottom: token.marginSM }}>
      <SpeicherFehler fehler={fehler} titel="Nicht aufgelöst" fallback="Auflösen fehlgeschlagen" />
    </div>
  );
}
