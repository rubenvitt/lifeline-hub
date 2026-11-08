import { useMemo, useState } from 'react';
import { Alert, App, Button, Flex, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import {
  ladeUhsZiele,
  legePersonAn,
  listePersonen,
  registrierAnzeige,
  type PersonAnlegenEingabe,
} from '../api/einsatzPerson';
import { listeMeldungen } from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type { Meldung, Person, UhsZielAuswahl } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenLeer } from '../components/SeitenZustand';
import { Paneel, StatusChip, monoStil, useRollen } from '../components/instrument';
import type { StatusTon } from '../components/instrument/statusFlaeche';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { IconPersonPlus } from '../icons';
import { erfassePersonOfflineFaehig, type OfflineSchreibErgebnis } from '../offline/schreiben';
import { useVorgemerkteSchreibaktionen } from '../offline/useVorgemerkteSchreibaktionen';
import LeichterFallModal, {
  KONTAKT_TITEL,
  type LeichterFallStelle,
} from '../personen/LeichterFallModal';
import { ANLASS_WORT } from '../personen/personMeta';

/** Ausgang eines Kontakts als Marke (LLH-1580, Entwurf K5/K8). */
export interface KontaktMarke {
  ton: StatusTon;
  wort: string;
}

/**
 * Was die Liste am Handy zum Ausgang eines Kontakts zeigt: entlassen, Transport, der Stand der
 * RTW-Meldung (offen mit Frist, bestätigt, nach der Frist „Funk“), die UHS oder offen. Rein.
 */
export function kontaktMarke(
  person: Pick<Person, 'aktuelle_verbleib_art' | 'aktuelle_uhs_id' | 'meldung_id' | 'versorgung'>,
  meldung: Pick<Meldung, 'ist_bestaetigt' | 'ist_ueberfaellig' | 'eskaliert'> | undefined,
  uhsName: string | undefined,
  fristText: string | undefined,
): KontaktMarke {
  if (person.aktuelle_verbleib_art === 'entlassung') return { ton: 'neutral', wort: 'entlassen' };
  if (person.aktuelle_verbleib_art === 'transport') return { ton: 'neutral', wort: 'Transport' };
  if (person.meldung_id != null && meldung) {
    if (meldung.ist_bestaetigt) return { ton: 'normal', wort: 'RTW bestätigt' };
    if (meldung.ist_ueberfaellig || meldung.eskaliert) return { ton: 'alarm', wort: 'RTW · Funk' };
    return { ton: 'achtung', wort: fristText ? `RTW offen bis ${fristText}` : 'RTW offen' };
  }
  if (person.aktuelle_uhs_id != null) return { ton: 'bedien', wort: uhsName ?? 'UHS' };
  if (person.versorgung === 'abgeschlossen') return { ton: 'neutral', wort: 'abgeschlossen' };
  return { ton: 'achtung', wort: 'offen' };
}

/**
 * Kontakte am Einheitengerät (LLH-1580, Konzept LLH-1571 S2): „Kontakt“ öffnet die
 * Schnellerfassung aus LLH-1572 mit fester Einheit und drei Ausgängen (Entlassen, Zur UHS, RTW
 * nötig); darunter die Personen, die die Einheit versorgt, ohne Namen (K5). Entlassen und Zur UHS
 * merkt die Warteschlange ohne Netz vor; der RTW geht nur mit Netz und nie über die
 * Warteschlange (K2), sonst über Funk.
 */
export default function GeraetKontaktePage() {
  const { geraet, benutzer } = useAuth();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const einheitId = geraet?.stelle_id ?? null;
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const [offen, setOffen] = useState(false);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: geraet != null,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: geraet != null,
  });
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
    enabled: geraet != null,
  });
  const meldungenQuery = useQuery({
    queryKey: einsatzKeys.meldungen(einsatzId),
    queryFn: () => listeMeldungen(einsatzId),
    enabled: geraet != null,
  });
  // Das Gerät bekommt das Ereignis `uhs` nicht: beim Öffnen des Kontakts frisch laden.
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.personenUhs(einsatzId),
    queryFn: () => ladeUhsZiele(einsatzId),
    enabled: geraet != null,
    refetchOnMount: 'always',
  });
  const vorgemerkt = useVorgemerkteSchreibaktionen(benutzer?.id, einsatzId, 'person');

  const einheit = einheitenQuery.data?.find((e) => e.id === einheitId);
  const uhsZiele: readonly UhsZielAuswahl[] = useMemo(() => uhsQuery.data ?? [], [uhsQuery.data]);
  const stelle: LeichterFallStelle | null = useMemo(
    () =>
      einheit
        ? {
            art: 'einheit',
            einheit: {
              id: einheit.id,
              name: einheit.name,
              abschnitt_name: einheit.abschnitt_name ?? undefined,
            },
            uhsZiele,
          }
        : null,
    [einheit, uhsZiele],
  );

  const anlegen = useMutation({
    networkMode: 'always',
    mutationFn: async (daten: PersonAnlegenEingabe): Promise<OfflineSchreibErgebnis<Person>> => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      // Der RTW geht nie über die Warteschlange (K2): ein Fehler bleibt im Dialog, dann Funk.
      if (daten.rtw) return { zustand: 'gesendet', daten: await legePersonAn(einsatzId, daten) };
      return erfassePersonOfflineFaehig(benutzer.id, einsatzId, daten);
    },
    onSuccess: (ergebnis, daten) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        void message.warning('Offline vorgemerkt · R-…');
        return;
      }
      const reg = registrierAnzeige(ergebnis.daten.registrier_nr);
      void message.success(
        daten.rtw ? `${reg} · RTW angefordert` : daten.uhs_id != null ? `${reg} · UHS` : reg,
      );
      void qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
      if (daten.rtw) void qc.invalidateQueries({ queryKey: einsatzKeys.meldungen(einsatzId) });
    },
  });

  const meldungen = useMemo(
    () => new Map((meldungenQuery.data ?? []).map((m) => [m.id, m])),
    [meldungenQuery.data],
  );
  const uhsNamen = useMemo(() => new Map(uhsZiele.map((u) => [u.id, u.bezeichnung])), [uhsZiele]);
  const kontakte = [...(personenQuery.data ?? [])].sort((a, b) =>
    b.erfasst_at.localeCompare(a.erfasst_at),
  );
  const eigeneVorgemerkt = vorgemerkt.filter(
    (v) => v.aktion.daten.versorgende_einheit_id === einheitId,
  );
  const darfErfassen = darfImEinsatzSchreiben(einsatzQuery.data) && stelle != null;

  return (
    <EinsatzSeite
      titel="Kontakte"
      dataUpdatedAt={personenQuery.dataUpdatedAt}
      aktionen={
        <Button
          type="primary"
          icon={<IconPersonPlus />}
          disabled={!darfErfassen}
          onClick={() => {
            void uhsQuery.refetch();
            setOffen(true);
          }}
        >
          {KONTAKT_TITEL}
        </Button>
      }
    >
      <Paneel titel="Kontakte der Einheit" koerperPolster>
        {personenQuery.isError ? (
          <Alert type="error" showIcon title="Kontakte konnten nicht geladen werden" />
        ) : personenQuery.isLoading ? (
          <Spin />
        ) : kontakte.length === 0 && eigeneVorgemerkt.length === 0 ? (
          <SeitenLeer titel="Noch keine Kontakte" />
        ) : (
          <Flex vertical gap={token.marginXS} data-lfh="kontakt-liste">
            {eigeneVorgemerkt.map((v) => (
              <KontaktZeile
                key={v.id ?? v.erstellt_at}
                reg="R-…"
                zeit={
                  v.aktion.daten.zeitpunkt_at
                    ? zeitKurz(v.aktion.daten.zeitpunkt_at, konventionen)
                    : ''
                }
                anlass={v.aktion.daten.anlass ? ANLASS_WORT[v.aktion.daten.anlass] : undefined}
                marke={{ ton: 'achtung', wort: 'vorgemerkt' }}
              />
            ))}
            {kontakte.map((p) => {
              const meldung = p.meldung_id != null ? meldungen.get(p.meldung_id) : undefined;
              const frist = meldung?.bestaetigung_frist_at
                ? zeitKurz(meldung.bestaetigung_frist_at, konventionen)
                : undefined;
              return (
                <KontaktZeile
                  key={p.id}
                  reg={registrierAnzeige(p.registrier_nr)}
                  zeit={zeitKurz(p.erfasst_at, konventionen)}
                  anlass={p.anlass ? ANLASS_WORT[p.anlass as keyof typeof ANLASS_WORT] : undefined}
                  marke={kontaktMarke(
                    p,
                    meldung,
                    p.aktuelle_uhs_id != null ? uhsNamen.get(p.aktuelle_uhs_id) : undefined,
                    frist,
                  )}
                />
              );
            })}
          </Flex>
        )}
      </Paneel>
      {stelle && (
        <LeichterFallModal
          einsatzId={einsatzId}
          offen={offen}
          stelle={stelle}
          laeuft={anlegen.isPending}
          speicherung={anlegen}
          onErfassen={(daten) => anlegen.mutateAsync(daten)}
          onFertig={() => setOffen(false)}
          onAbbrechen={() => setOffen(false)}
        />
      )}
    </EinsatzSeite>
  );
}

function KontaktZeile({
  reg,
  zeit,
  anlass,
  marke,
}: {
  reg: string;
  zeit: string;
  anlass: string | undefined;
  marke: KontaktMarke;
}) {
  const { token, rollen } = useRollen();
  return (
    <Flex
      align="center"
      gap="small"
      wrap
      data-lfh="kontakt-zeile"
      style={{
        paddingBlock: token.paddingXS,
        borderBottom: `1px solid ${rollen.linie}`,
      }}
    >
      <span style={monoStil(14, 500)}>{reg}</span>
      <span style={{ ...monoStil(13), color: rollen.gedaempft }}>{zeit}</span>
      {anlass && <span>{anlass}</span>}
      <StatusChip ton={marke.ton} wort={marke.wort} style={{ marginLeft: 'auto' }} />
    </Flex>
  );
}
