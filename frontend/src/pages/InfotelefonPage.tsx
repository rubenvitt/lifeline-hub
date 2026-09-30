import { App, Breadcrumb, Flex, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { taktischeDtgVoll } from '../anzeige/format';
import { ladeEinsatz } from '../api/einsaetze';
import { erfasseAnruf, ladeAnrufe, setzeAnrufStatus, type AnrufEingabe } from '../api/infotelefon';
import { einsatzKeys } from '../api/queryKeys';
import type { InfotelefonAnruf, InfotelefonStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { HERVORGEHOBEN } from '../components/Datensicht';
import EinsatzSeite from '../components/EinsatzSeite';
import {
  Kennzahl,
  Paneel,
  PaneelZeile,
  Segmentleiste,
  Zeitachseneintrag,
  monoStil,
  useRollen,
  type KennzahlZustand,
} from '../components/instrument';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { RechteHinweis, SpeicherFehler } from '../components/SpeicherHinweis';
import StatusWahl from '../components/StatusWahl';
import StatusTag from '../components/StatusTag';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import AnrufErfassung from '../infotelefon/AnrufErfassung';
import { ANLIEGEN_LABEL, ANLIEGEN_REIHENFOLGE } from '../presse/labels';
import { infotelefonRechteText } from '../presse/rechteText';
import { personenPfad, stabPfad } from '../routing/deeplinks';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { stabFreigabeAnzeige, useStabFreigabe } from '../stab/useStabFreigabe';
import { stabZeilenzielStil } from '../stab/zeilenziel';
import { infotelefonStatus } from '../theme/statusFarben';

/**
 * Informationstelefon des Sachgebiets S5 (LFH-554, Spec `stab-infotelefon`): das Protokoll der
 * Anrufe aus der Bevölkerung. Ein Protokoll wird gelesen — Zeitachse wie ETB und Lagemeldungen,
 * jüngste oben (Ordnung vom Server), keine Sortierung, kein Spaltenfilter; nur die Segmentleiste
 * „alle / offene Rückrufe“.
 *
 * **Zahlen aus EINER Menge:** Kennzahlen und Aufgliederung zählen dieselbe geladene Liste wie die
 * Zeitachse. Ohne Liste steht keine Zahl da (`laden`/`fehler` an der Kennzahl).
 *
 * **Datenschutz:** Name, Rückrufnummer und Notiz stehen nur hier; die Medienlage und der
 * Lagebericht bekommen sie nie (`stab/medienlage.ts`).
 */

type Sicht = 'alle' | 'offen';

const SEITE = { titel: 'Informationstelefon', mitArtikel: 'das Informationstelefon' };

/** Optionen der Statuswahl: ein offener Rückruf wird erledigt, ein erledigter mit Nummer geöffnet. */
function statusOptionen(a: InfotelefonAnruf): InfotelefonStatus[] {
  if (a.status === 'offen') return ['offen', 'erledigt'];
  return a.rueckruf ? ['erledigt', 'offen'] : ['erledigt'];
}

export default function InfotelefonPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const stabFreigabe = useStabFreigabe(einsatzId);
  const frei = stabFreigabe.zustand === 'frei';
  const [sicht, setSicht] = useState<Sicht>('alle');
  const [hervorgehoben, setHervorgehoben] = useState<number | null>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const anrufeQuery = useQuery({
    queryKey: einsatzKeys.infotelefon(einsatzId),
    queryFn: () => ladeAnrufe(einsatzId),
    enabled: frei,
  });

  useQueryParamSelektion('anruf', anrufeQuery.isSuccess, (aid) => {
    if (!(anrufeQuery.data ?? []).some((a) => a.id === aid)) return;
    setSicht('alle');
    setHervorgehoben(aid);
  });
  useEffect(() => {
    if (hervorgehoben == null) return;
    document
      .querySelector(`[data-anruf="${hervorgehoben}"]`)
      ?.scrollIntoView?.({ block: 'center' });
  }, [hervorgehoben]);

  const invalidate = () => qc.invalidateQueries({ queryKey: einsatzKeys.infotelefon(einsatzId) });

  const erfassenMutation = useMutation({
    mutationFn: (e: AnrufEingabe) => erfasseAnruf(einsatzId, e),
    onSuccess: invalidate,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { id: number; status: InfotelefonStatus }) =>
      setzeAnrufStatus(einsatzId, v.id, v.status),
    onSuccess: (_a, v) => {
      invalidate();
      message.success(v.status === 'erledigt' ? 'Rückruf erledigt' : 'Rückruf wieder offen');
    },
  });

  const anrufe = useMemo(() => anrufeQuery.data ?? [], [anrufeQuery.data]);
  const offene = anrufe.filter((a) => a.status === 'offen');
  const jeAnliegen = useMemo(() => {
    const z = new Map<string, number>();
    for (const a of anrufe) z.set(a.anliegen, (z.get(a.anliegen) ?? 0) + 1);
    return ANLIEGEN_REIHENFOLGE.filter((x) => (z.get(x) ?? 0) > 0).map((x) => ({
      anliegen: x,
      anzahl: z.get(x)!,
    }));
  }, [anrufe]);

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
  const personenFrei = istKeyFreigegeben('personen', benutzer, stabFreigabe.overrides);
  const zustand: KennzahlZustand = anrufeQuery.isPending
    ? 'laden'
    : anrufeQuery.isError
      ? 'fehler'
      : 'daten';
  const sichtbar = sicht === 'offen' ? offene : anrufe;

  return (
    <EinsatzSeite
      titel="Informationstelefon"
      meta={zustand === 'daten' ? `${anrufe.length} Anrufe` : undefined}
      dataUpdatedAt={anrufeQuery.dataUpdatedAt}
      beschreibung="Sachgebiet S5 · Anrufe aus der Bevölkerung, offene Rückrufe"
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={stabPfad(einsatzId)}>Stab</Link> },
            { title: 'Informationstelefon' },
          ]}
        />
      }
      hinweis={
        <RechteHinweis sichtbar={!darfSchreiben} text={infotelefonRechteText(einsatz.status)} />
      }
      fuss={
        darfSchreiben ? (
          <div className="etb-erfassung-sticky">
            <AnrufErfassung
              onErfassen={(e) => erfassenMutation.mutateAsync(e)}
              laeuft={erfassenMutation.isPending}
              fehler={erfassenMutation.error}
            />
          </div>
        ) : undefined
      }
    >
      <Flex vertical gap={token.margin}>
        {/* Kein `Kennzahlenband`: dessen sechs Plätze gehören der Lage (LFH-640). */}
        <Flex wrap gap={token.margin}>
          <Kennzahl titel="Anrufe" wert={anrufe.length} zustand={zustand} groesse="klein" />
          <Kennzahl
            titel="offene Rückrufe"
            wert={offene.length}
            zustand={zustand}
            ton={offene.length > 0 ? 'achtung' : 'neutral'}
            groesse="klein"
          />
        </Flex>
        {zustand === 'daten' && jeAnliegen.length > 0 && (
          <Paneel titel="Nach Anliegen">
            {jeAnliegen.map((x) => (
              <PaneelZeile key={x.anliegen}>
                <span>{ANLIEGEN_LABEL[x.anliegen]}</span>
                <span style={monoStil(14)}>{x.anzahl}</span>
              </PaneelZeile>
            ))}
          </Paneel>
        )}
        <Segmentleiste<Sicht>
          beschriftung="Anrufe filtern"
          wert={sicht}
          onWechsel={setSicht}
          optionen={[
            { wert: 'alle', label: 'alle' },
            { wert: 'offen', label: 'offene Rückrufe' },
          ]}
        />
        {statusMutation.error != null && <SpeicherFehler fehler={statusMutation.error} />}
        {anrufeQuery.isError ? (
          <SeitenFehler
            text="Anrufe konnten nicht geladen werden"
            ursache={anrufeQuery.error}
            onWiederholen={() => void anrufeQuery.refetch()}
          />
        ) : sichtbar.length === 0 && zustand === 'daten' ? (
          <Typography.Text type="secondary">
            {sicht === 'offen' ? 'Keine offenen Rückrufe' : 'Noch keine Anrufe'}
          </Typography.Text>
        ) : (
          <ol aria-label="Anrufprotokoll" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {sichtbar.map((a) => (
              <Zeitachseneintrag
                key={a.id}
                als="li"
                data-anruf={a.id}
                data-lfh="datensicht-karte"
                className={a.id === hervorgehoben ? HERVORGEHOBEN : undefined}
                zeit={<ZeitAnzeige wert={a.eingang_at} />}
                typwort={ANLIEGEN_LABEL[a.anliegen]}
                meta={[a.anrufer_name, a.rueckruf].filter(Boolean).join(' · ') || undefined}
                verfasser={
                  a.anliegen === 'vermisstensuche' && personenFrei ? (
                    <Link
                      to={personenPfad(einsatzId, { ansicht: 'zeilen', filter: 'vermisst' })}
                      style={stabZeilenzielStil(token)}
                    >
                      Vermisste <span aria-hidden>↗</span>
                    </Link>
                  ) : undefined
                }
                aktionen={
                  <StatusWahl<InfotelefonStatus>
                    darstellung={infotelefonStatus[a.status]}
                    aktuell={a.status}
                    optionen={statusOptionen(a).map((s) => ({
                      wert: s,
                      label: infotelefonStatus[s].label,
                      darstellung: infotelefonStatus[s],
                    }))}
                    // Menschenlesbar und je Zeile verschieden: Anliegen plus Eingang (DTG).
                    kennung={`Anruf ${ANLIEGEN_LABEL[a.anliegen]} ${taktischeDtgVoll(a.eingang_at, konventionen)}`}
                    darfSchreiben={darfSchreiben && statusOptionen(a).length > 1}
                    laeuft={statusMutation.isPending && statusMutation.variables?.id === a.id}
                    gesperrt={statusMutation.isPending}
                    onWaehlen={(s) => {
                      if (s !== a.status && !statusMutation.isPending)
                        statusMutation.mutate({ id: a.id, status: s });
                    }}
                    etikett={<StatusTag darstellung={infotelefonStatus[a.status]} />}
                  />
                }
              >
                {a.notiz ?? <Typography.Text type="secondary">—</Typography.Text>}
              </Zeitachseneintrag>
            ))}
          </ol>
        )}
      </Flex>
    </EinsatzSeite>
  );
}
