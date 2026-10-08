import { App, Breadcrumb, Button, Collapse, Flex, Form, Input, Space } from 'antd';
import { PRESSE_ANTWORT_MAX, PRESSE_KURZ_MAX, PRESSE_THEMA_MAX } from '../api/eingabegrenzen';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { IconPlus } from '../icons';
import type { Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { taktischeDtgVoll } from '../anzeige/format';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { abrufZustand } from '../api/abrufZustand';
import { ladeEinsatz } from '../api/einsaetze';
import { ladeAnrufe } from '../api/infotelefon';
import type { AbschlussCursor } from '../api/meldungen';
import {
  eingangCursor,
  ladeErledigteMedienkontakte,
  ladeMedienkontakt,
  ladeMedienkontaktKennzahlen,
  ladeOffeneMedienkontakte,
  ladePressemitteilungen,
  MEDIENKONTAKTE_SEITE,
  legeMedienkontaktAn,
  legePressemitteilungAn,
  setzeMedienkontaktStatus,
  type MedienkontaktStatusEingabe,
} from '../api/presse';
import { einsatzKeys } from '../api/queryKeys';
import type {
  Medienkontakt,
  MedienkontaktArt,
  MedienkontaktStatus,
  PressemitteilungVorlageKey,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import Datensicht, { HERVORGEHOBEN, scrolleZurZeile, spaltenFuer } from '../components/Datensicht';
import EinsatzSeite from '../components/EinsatzSeite';
import { ErfassungsModal } from '../components/Erfassung';
import { Kennzahl, Paneel, Segmentleiste, monoStil, useRollen } from '../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import Markdown from '../components/Markdown';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { Select } from '../components/Select';
import { RechteHinweis, SpeicherFehler } from '../components/SpeicherHinweis';
import StatusTag from '../components/StatusTag';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import { kettenKoepfe } from '../lageberichte/ketten';
import { ART_REIHENFOLGE, MEDIENKONTAKT_ART_LABEL } from '../presse/labels';
import { VORLAGEN, mitteilungVorlage } from '../presse/vorlagen';
import { pressemitteilungPfad, stabPfad } from '../routing/deeplinks';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { baueMedienlage, rendereMedienlageMarkdown } from '../stab/medienlage';
import { stabFreigabeAnzeige, useStabFreigabe } from '../stab/useStabFreigabe';
import { stabZeilenzielStil } from '../stab/zeilenziel';
import { medienkontaktStatus, pressemitteilungStatus } from '../theme/statusFarben';

/**
 * Pressearbeit des Sachgebiets S5 (LFH-554), Zielkontext Stabsraum. Herleitung:
 * `openspec/changes/archive/2026-09-30-lfh-554-presse-medienarbeit-s5/design.md`.
 *
 * - **Ort:** Unterroute des Stabs, Einstieg aus der S5-Zeile. Kein Modul; die Seite prüft die
 *   Stab-Freigabe selbst (`useStabFreigabe`, D1).
 * - **Presse-Log:** oben, weil hier gearbeitet wird und „offene Anfragen“ ins erste Bild gehört.
 *   Karten, weil die Frage „was ist mit diesem?“ lautet (D6). Der Status wird an der
 *   Statusanzeige gewechselt; „beantwortet“ öffnet die Antwortmaske, weil der Übergang die Antwort
 *   verlangt. Jede Rücknahme nach „offen“ ist möglich, deshalb keine Rückfrage, sondern ein
 *   Rückgängig-Toast (LFH-343).
 * - **Pressemitteilungen:** Kettenköpfe wie beim Lagebericht; der Titel führt auf die Detailseite.
 * - **Medienlage:** unten, aus den Kennzahlen des Presse-Logs und denselben Listen wie die
 *   Paneele darüber, ohne Personenbezug (`stab/medienlage.ts`, D7). Sie wächst live, deshalb
 *   steht sie unter der Arbeitsliste und nicht darüber.
 * - **Blättern (LFH-1075):** offene Kontakte vollständig, erledigte seitenweise mit „Ältere
 *   laden“; Kopfzeile und Medienlage zählen über den ganzen Bestand (Kennzahlen).
 */

type Sicht = 'alle' | 'offen';

interface KontaktWerte {
  art: MedienkontaktArt;
  medium: string;
  thema: string;
  kontakt_name?: string;
  kontakt_erreichbarkeit?: string;
  eingang?: Dayjs;
}

interface AntwortWerte {
  antwort: string;
  freigabe_durch?: string;
  pressemitteilung_id?: number;
}

interface MitteilungWerte {
  titel: string;
  vorlage: PressemitteilungVorlageKey;
}

const SEITE = { titel: 'Pressearbeit', mitArtikel: 'die Pressearbeit' };

/** Die Zielstatus einer Art von „offen“ aus (Spiegel von `MedienkontaktArt::erlaubte_ziele`). */
const ZIELE: Record<MedienkontaktArt, MedienkontaktStatus[]> = {
  anfrage: ['beantwortet', 'abgelehnt'],
  abstimmung: ['erledigt'],
  termin: ['erledigt'],
};

/** Welche Optionen die Statuswahl einer Zeile anbietet: von „offen“ die Ziele, sonst zurück. */
export function statusOptionen(k: Pick<Medienkontakt, 'art' | 'status'>): MedienkontaktStatus[] {
  return k.status === 'offen' ? ['offen', ...ZIELE[k.art]] : [k.status, 'offen'];
}

function kontaktSpalten() {
  return spaltenFuer<Medienkontakt>()([
    {
      key: 'titel',
      title: 'Medium · Thema',
      immerSichtbar: true,
      render: (_t, k) => `${k.medium} · ${k.thema}`,
    },
    {
      key: 'art',
      title: 'Art',
      render: (_t, k) => MEDIENKONTAKT_ART_LABEL[k.art],
    },
    {
      key: 'eingang',
      title: 'Eingang',
      render: (_t, k) => (
        <span style={monoStil(12)}>
          <ZeitAnzeige wert={k.eingang_at} />
        </span>
      ),
    },
    {
      key: 'kontakt',
      title: 'Ansprechperson',
      render: (_t, k) =>
        [k.kontakt_name, k.kontakt_erreichbarkeit].filter(Boolean).join(' · ') ||
        (k.antwort ? `Antwort: ${k.antwort}` : '—'),
    },
  ]);
}

export default function PressePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const stabFreigabe = useStabFreigabe(einsatzId);
  const frei = stabFreigabe.zustand === 'frei';

  const [sicht, setSicht] = useState<Sicht>('alle');
  const [kontaktOffen, setKontaktOffen] = useState(false);
  const [antwortFuer, setAntwortFuer] = useState<Medienkontakt | null>(null);
  const [mitteilungOffen, setMitteilungOffen] = useState(false);
  const [hervorgehoben, setHervorgehoben] = useState<number | null>(null);
  const [kontaktForm] = Form.useForm<KontaktWerte>();
  const [antwortForm] = Form.useForm<AntwortWerte>();
  const [mitteilungForm] = Form.useForm<MitteilungWerte>();
  const spalten = useMemo(() => kontaktSpalten(), []);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const offeneQuery = useQuery({
    queryKey: einsatzKeys.medienkontakteOffen(einsatzId),
    queryFn: () => ladeOffeneMedienkontakte(einsatzId),
    enabled: frei,
  });
  const erledigteQuery = useInfiniteQuery({
    queryKey: einsatzKeys.medienkontakteErledigt(einsatzId),
    queryFn: ({ pageParam }) => ladeErledigteMedienkontakte(einsatzId, pageParam),
    initialPageParam: undefined as AbschlussCursor | undefined,
    getNextPageParam: (letzte) =>
      letzte.length < MEDIENKONTAKTE_SEITE ? undefined : eingangCursor(letzte[letzte.length - 1]),
    enabled: frei,
  });
  const kennzahlenQuery = useQuery({
    queryKey: einsatzKeys.medienkontaktKennzahlen(einsatzId),
    queryFn: () => ladeMedienkontaktKennzahlen(einsatzId),
    enabled: frei,
  });
  const mitteilungenQuery = useQuery({
    queryKey: einsatzKeys.pressemitteilungen(einsatzId),
    queryFn: () => ladePressemitteilungen(einsatzId),
    enabled: frei,
  });
  // Nur für die Medienlage; das Protokoll selbst steht auf seiner eigenen Seite.
  const anrufeQuery = useQuery({
    queryKey: einsatzKeys.infotelefon(einsatzId),
    queryFn: () => ladeAnrufe(einsatzId),
    enabled: frei,
  });

  const offene = offeneQuery.data;
  const erledigte = useMemo(() => {
    const gesehen = new Set<number>();
    return (erledigteQuery.data?.pages ?? []).flat().filter((k) => {
      if (gesehen.has(k.id)) return false;
      gesehen.add(k.id);
      return true;
    });
  }, [erledigteQuery.data]);

  // Deeplink ?kontakt=<id>: steht der Kontakt in keiner geladenen Liste (ein älterer erledigter),
  // holt die Seite ihn einzeln und hängt ihn hinten an, bis er in einer geladenen Seite auftaucht.
  const [verlinkteId, setVerlinkteId] = useState<number | null>(null);
  useQueryParamSelektion('kontakt', offeneQuery.isSuccess && erledigteQuery.isSuccess, (kid) => {
    setSicht('alle');
    setHervorgehoben(kid);
    const geladen = [...(offene ?? []), ...erledigte].some((k) => k.id === kid);
    setVerlinkteId(geladen ? null : kid);
  });
  const verlinkteQuery = useQuery({
    queryKey: einsatzKeys.medienkontaktEinzeln(einsatzId, verlinkteId ?? 0),
    queryFn: () => ladeMedienkontakt(einsatzId, verlinkteId ?? 0),
    enabled: frei && verlinkteId != null,
  });
  const verlinkte =
    verlinkteId != null && verlinkteQuery.data?.id === verlinkteId ? verlinkteQuery.data : null;
  const kontakte = useMemo(() => {
    const alle = [...(offene ?? []), ...erledigte];
    return verlinkte && !alle.some((k) => k.id === verlinkte.id) ? [...alle, verlinkte] : alle;
  }, [offene, erledigte, verlinkte]);
  const hervorgehobenGeladen = kontakte.some((k) => k.id === hervorgehoben);
  useEffect(() => {
    if (hervorgehoben != null && hervorgehobenGeladen) scrolleZurZeile(hervorgehoben);
  }, [hervorgehoben, hervorgehobenGeladen]);

  const invalidate = () => qc.invalidateQueries({ queryKey: einsatzKeys.presse(einsatzId) });

  const kontaktMutation = useMutation({
    mutationFn: (w: KontaktWerte) =>
      legeMedienkontaktAn(einsatzId, {
        art: w.art,
        medium: w.medium,
        thema: w.thema,
        kontakt_name: w.kontakt_name,
        kontakt_erreichbarkeit: w.kontakt_erreichbarkeit,
        ...(w.eingang ? { eingang_at: alsBackendZeit(w.eingang) } : {}),
      }),
    onSuccess: invalidate,
  });

  const statusMutation = useMutation({
    mutationFn: (v: { kontakt: Medienkontakt; wechsel: MedienkontaktStatusEingabe }) =>
      setzeMedienkontaktStatus(einsatzId, v.kontakt.id, v.wechsel),
    onSuccess: (_neu, v) => {
      invalidate();
      const vorher = v.kontakt.status;
      // Der Rückweg ist ein Übergang, den der Server kennt (eine Stufe zurück nach „offen“).
      if (v.wechsel.status !== 'offen') {
        zeigeRueckgaengig(
          message,
          `${v.kontakt.medium}: ${medienkontaktStatus[v.wechsel.status].label}`,
          () =>
            statusMutation.mutate({
              kontakt: { ...v.kontakt, status: v.wechsel.status },
              wechsel: { status: vorher },
            }),
        );
      }
    },
  });

  const mitteilungMutation = useMutation({
    mutationFn: (w: MitteilungWerte) => legePressemitteilungAn(einsatzId, w),
    onSuccess: (pm) => {
      invalidate();
      navigate(pressemitteilungPfad(einsatzId, pm.id));
    },
  });

  if (stabFreigabe.zustand !== 'frei') return stabFreigabeAnzeige(stabFreigabe, SEITE, einsatzId);
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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);
  const sichtbar = sicht === 'offen' ? (offene ?? []) : kontakte;
  // Die offenen sind vollständig geladen: die Zahl stimmt ohne Kennzahlen.
  const offeneAnfragen = (offene ?? []).filter((k) => k.art === 'anfrage').length;
  const kennzahlen = kennzahlenQuery.data;
  const listeGescheitert = offeneQuery.isError || (erledigteQuery.isError && !erledigteQuery.data);
  const mitteilungen = mitteilungenQuery.data ?? [];
  const ketten = kettenKoepfe(mitteilungen);
  const freigegeben = mitteilungen.filter((m) => m.status === 'freigegeben');

  const medienlage = baueMedienlage({
    kontakte: { zustand: abrufZustand(kennzahlenQuery), daten: kennzahlen ?? null },
    mitteilungen: { zustand: abrufZustand(mitteilungenQuery), daten: mitteilungen },
    anrufe: { zustand: abrufZustand(anrufeQuery), daten: anrufeQuery.data ?? [] },
  });
  const medienlageText = rendereMedienlageMarkdown(medienlage, (w) =>
    taktischeDtgVoll(w, konventionen),
  );

  const waehleStatus = (k: Medienkontakt, ziel: MedienkontaktStatus) => {
    if (ziel === k.status || statusMutation.isPending) return;
    if (ziel === 'beantwortet') {
      antwortForm.setFieldsValue({
        antwort: k.antwort ?? '',
        freigabe_durch: k.freigabe_durch ?? '',
      });
      setAntwortFuer(k);
      return;
    }
    statusMutation.mutate({ kontakt: k, wechsel: { status: ziel } });
  };

  return (
    <EinsatzSeite
      titel="Pressearbeit"
      meta={`${kennzahlen?.gesamt ?? '—'} Medienkontakte · ${mitteilungen.length} Pressemitteilungen`}
      dataUpdatedAt={offeneQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={stabPfad(einsatzId)}>Stab</Link> },
            { title: 'Pressearbeit' },
          ]}
        />
      }
      aktionen={
        <Space wrap>
          <Button
            onClick={() => {
              kontaktMutation.reset();
              setKontaktOffen(true);
            }}
            disabled={!darfSchreiben}
          >
            Medienkontakt erfassen
          </Button>
          <Button
            type="primary"
            icon={<IconPlus />}
            aria-label="Neue Pressemitteilung"
            onClick={() => {
              mitteilungMutation.reset();
              setMitteilungOffen(true);
            }}
            disabled={!darfSchreiben}
          >
            Neue Pressemitteilung
          </Button>
        </Space>
      }
      hinweis={
        darfSchreiben ? undefined : (
          <RechteHinweis sichtbar text={einsatzRechteGrund(einsatz.status)} />
        )
      }
    >
      <Flex vertical gap={token.margin}>
        {/* Die Arbeitsliste steht oben: was darunter live wächst (Pressemitteilungen, Medienlage),
            schiebt sie nicht weg (Prüfliste, Kriterium 12). */}
        <Paneel titel="Presse-Log">
          <Flex vertical gap={token.marginSM} style={{ padding: token.paddingSM }}>
            <Kennzahl
              titel="offene Anfragen"
              wert={offeneAnfragen}
              zustand={offeneQuery.isPending ? 'laden' : offeneQuery.isError ? 'fehler' : 'daten'}
              ton={offeneAnfragen > 0 ? 'achtung' : 'neutral'}
              groesse="klein"
            />
            <Segmentleiste<Sicht>
              beschriftung="Medienkontakte filtern"
              wert={sicht}
              onWechsel={setSicht}
              optionen={[
                { wert: 'alle', label: 'alle' },
                { wert: 'offen', label: 'offen' },
              ]}
            />
            {listeGescheitert ? (
              <SeitenFehler
                text="Presse-Log konnte nicht geladen werden"
                ursache={offeneQuery.error ?? erledigteQuery.error}
                onWiederholen={() => {
                  void offeneQuery.refetch();
                  void erledigteQuery.refetch();
                }}
              />
            ) : (
              <Datensicht
                bezeichnung="Presse-Log"
                form="karte"
                spalten={spalten}
                daten={sichtbar}
                zeilenSchluessel={(k) => k.id}
                ladend={offeneQuery.isLoading || (sicht === 'alle' && erledigteQuery.isLoading)}
                leerText={
                  sicht === 'offen' ? 'Keine offenen Medienkontakte' : 'Noch keine Medienkontakte'
                }
                zeilenKlasse={(k) => (k.id === hervorgehoben ? HERVORGEHOBEN : undefined)}
                karte={{
                  art: 'plan',
                  titel: { spalte: 'titel' },
                  status: (k) => medienkontaktStatus[k.status],
                  statusBedienung: (k) =>
                    darfSchreiben
                      ? {
                          optionen: statusOptionen(k).map((s) => ({
                            wert: s,
                            label: medienkontaktStatus[s].label,
                            darstellung: medienkontaktStatus[s],
                          })),
                          aktuell: k.status,
                          kennung: `${k.medium} · ${k.thema}`,
                          laeuft:
                            statusMutation.isPending &&
                            statusMutation.variables?.kontakt.id === k.id,
                          gesperrt: statusMutation.isPending,
                          onWaehlen: (w) => waehleStatus(k, w as MedienkontaktStatus),
                        }
                      : null,
                  sekundaer: ['art', 'eingang', 'kontakt'],
                  aktion: {
                    etikett: 'Beantworten',
                    onKlick: (k) => waehleStatus(k, 'beantwortet'),
                    zugaenglicherName: (k) => `Anfrage von ${k.medium} beantworten`,
                    sichtbar: (k) => darfSchreiben && k.art === 'anfrage' && k.status === 'offen',
                  },
                }}
              />
            )}
            {sicht === 'alle' &&
              !listeGescheitert &&
              erledigteQuery.hasNextPage &&
              (kennzahlen == null || erledigte.length < kennzahlen.gesamt - kennzahlen.offen) && (
                <Flex vertical align="center" gap={token.marginXS}>
                  <Button
                    onClick={() => void erledigteQuery.fetchNextPage()}
                    loading={erledigteQuery.isFetchingNextPage}
                  >
                    Ältere laden
                  </Button>
                  {kennzahlen && (
                    <span style={{ color: token.colorTextSecondary }}>
                      {(offene?.length ?? 0) + erledigte.length} von {kennzahlen.gesamt} geladen
                    </span>
                  )}
                </Flex>
              )}
            {statusMutation.error != null && <SpeicherFehler fehler={statusMutation.error} />}
          </Flex>
        </Paneel>
        <Paneel titel="Pressemitteilungen" meta={`${freigegeben.length} freigegeben`}>
          <Liste
            // Unter dem Paneel (h2): jede Mitteilung ein Gegenstand mit Status und Verlauf
            // darunter, ihr Titel h3 (LFH-826).
            unterEbene={2}
            dataSource={ketten}
            rowKey={(k) => k.kopf.id}
            loading={mitteilungenQuery.isLoading}
            emptyText="Noch keine Pressemitteilung"
            renderItem={(k) => (
              <ListenEintrag>
                <ListenEintragMeta
                  title={
                    <Space wrap>
                      <Link
                        to={pressemitteilungPfad(einsatzId, k.kopf.id)}
                        style={stabZeilenzielStil(token)}
                      >
                        {k.kopf.titel}
                      </Link>
                      <StatusTag darstellung={pressemitteilungStatus[k.kopf.status]} />
                    </Space>
                  }
                  description={
                    <span>
                      {mitteilungVorlage(k.kopf.vorlage)?.label ?? k.kopf.vorlage}
                      {` · v${k.kopf.version} · `}
                      <ZeitAnzeige wert={k.kopf.freigegeben_at ?? k.kopf.zeitstand} />
                      {k.vorgaenger.length > 0 && ` · ${k.vorgaenger.length} frühere Fassungen`}
                    </span>
                  }
                />
              </ListenEintrag>
            )}
          />
        </Paneel>

        <Paneel titel="Medienlage" meta="ohne Personenbezug" koerperPolster>
          <Markdown variante="dokument" unterEbene={2}>
            {medienlageText}
          </Markdown>
        </Paneel>
      </Flex>

      {/* Medienkontakt erfassen: drei sichtbare Felder, der Rest eingeklappt (Feldbudget LFH-19).
          Serie: an einem Pressetelefon kommen Anfragen hintereinander. */}
      <ErfassungsModal<KontaktWerte>
        offen={kontaktOffen}
        titel="Medienkontakt erfassen"
        form={kontaktForm}
        erfassenText="Erfassen"
        laeuft={kontaktMutation.isPending}
        serie
        initialValues={{ art: 'anfrage' }}
        onErfassen={(w) => kontaktMutation.mutateAsync(w)}
        onFertig={() => setKontaktOffen(false)}
        onAbbrechen={() => setKontaktOffen(false)}
      >
        {kontaktMutation.error != null && (
          <div style={{ marginBottom: token.marginSM }}>
            <SpeicherFehler fehler={kontaktMutation.error} titel="Nicht erfasst" />
          </div>
        )}
        <Form.Item label="Art" name="art" rules={[{ required: true }]}>
          <Select
            options={ART_REIHENFOLGE.map((a) => ({ value: a, label: MEDIENKONTAKT_ART_LABEL[a] }))}
          />
        </Form.Item>
        <Form.Item
          label="Medium"
          name="medium"
          rules={[{ required: true, whitespace: true, message: 'Medium erforderlich' }]}
        >
          <Input placeholder="z. B. NDR 1, dpa, Polizei-Pressestelle" maxLength={PRESSE_KURZ_MAX} />
        </Form.Item>
        <Form.Item
          label="Thema"
          name="thema"
          rules={[
            { required: true, whitespace: true, message: 'Thema erforderlich' },
            zeichenRegel(PRESSE_THEMA_MAX, 'Thema'),
          ]}
        >
          <Input placeholder="z. B. Zahl der Evakuierten" count={zeichenGrenze(PRESSE_THEMA_MAX)} />
        </Form.Item>
        <Collapse
          ghost
          items={[
            {
              key: 'weitere',
              label: 'Ansprechperson und Uhrzeit',
              children: (
                <>
                  <Form.Item label="Ansprechperson" name="kontakt_name">
                    <Input maxLength={PRESSE_KURZ_MAX} />
                  </Form.Item>
                  <Form.Item label="Erreichbarkeit" name="kontakt_erreichbarkeit">
                    <Input placeholder="Telefon oder E-Mail" maxLength={PRESSE_THEMA_MAX} />
                  </Form.Item>
                  {/* Leer setzt der Server jetzt (`routes/presse.rs`, `zeit_oder_jetzt`). */}
                  <Form.Item label="Eingang" name="eingang">
                    <ZeitpunktEingabe
                      format="DD.MM.YYYY HH:mm"
                      placeholder="jetzt"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </>
              ),
            },
          ]}
        />
      </ErfassungsModal>

      {/* Beantworten: der Übergang verlangt die gegebene Antwort (sonst 422). */}
      <ErfassungsModal<AntwortWerte>
        offen={antwortFuer != null}
        titel={
          antwortFuer ? `Anfrage von ${antwortFuer.medium} beantworten` : 'Anfrage beantworten'
        }
        form={antwortForm}
        erfassenText="Als beantwortet speichern"
        laeuft={statusMutation.isPending}
        onErfassen={(w) =>
          statusMutation.mutateAsync({
            kontakt: antwortFuer!,
            wechsel: {
              status: 'beantwortet',
              antwort: w.antwort,
              freigabe_durch: w.freigabe_durch,
              pressemitteilung_id: w.pressemitteilung_id,
            },
          })
        }
        onFertig={() => setAntwortFuer(null)}
        onAbbrechen={() => setAntwortFuer(null)}
      >
        {statusMutation.error != null && (
          <div style={{ marginBottom: token.marginSM }}>
            <SpeicherFehler fehler={statusMutation.error} titel="Nicht gespeichert" />
          </div>
        )}
        <Form.Item
          label="Gegebene Antwort"
          name="antwort"
          rules={[
            { required: true, whitespace: true, message: 'Antwort erforderlich' },
            zeichenRegel(PRESSE_ANTWORT_MAX, 'Antwort'),
          ]}
        >
          <Input.TextArea autoSize={{ minRows: 2 }} count={zeichenGrenze(PRESSE_ANTWORT_MAX)} />
        </Form.Item>
        <Form.Item label="Freigegeben durch" name="freigabe_durch">
          <Input placeholder="z. B. EL mündlich 14:20" maxLength={PRESSE_KURZ_MAX} />
        </Form.Item>
        <Form.Item label="Verweis auf Pressemitteilung" name="pressemitteilung_id">
          <Select
            allowClear
            placeholder="optional"
            options={freigegeben.map((m) => ({
              value: m.id,
              label: `${m.titel} (v${m.version})`,
            }))}
          />
        </Form.Item>
      </ErfassungsModal>

      <ErfassungsModal<MitteilungWerte>
        offen={mitteilungOffen}
        titel="Neue Pressemitteilung"
        form={mitteilungForm}
        erfassenText="Anlegen"
        laeuft={mitteilungMutation.isPending}
        initialValues={{ vorlage: 'erstinformation' }}
        onErfassen={(w) => mitteilungMutation.mutateAsync(w)}
        onFertig={() => setMitteilungOffen(false)}
        onAbbrechen={() => setMitteilungOffen(false)}
      >
        {mitteilungMutation.error != null && (
          <div style={{ marginBottom: token.marginSM }}>
            <SpeicherFehler fehler={mitteilungMutation.error} titel="Nicht angelegt" />
          </div>
        )}
        <Form.Item
          label="Titel"
          name="titel"
          rules={[{ required: true, whitespace: true, message: 'Titel erforderlich' }]}
        >
          <Input placeholder="z. B. Hochwasser Musterstadt – Evakuierung Nord" />
        </Form.Item>
        <Form.Item label="Vorlage" name="vorlage" rules={[{ required: true }]}>
          <Select options={VORLAGEN.map((v) => ({ value: v.schluessel, label: v.label }))} />
        </Form.Item>
      </ErfassungsModal>
    </EinsatzSeite>
  );
}
