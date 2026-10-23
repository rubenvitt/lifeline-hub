import { Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { listeNachforderungen } from '../api/nachforderungen';
import { einsatzKeys } from '../api/queryKeys';
import type { ModulFreigaben, Nachforderung } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { SprungKnopf } from '../components/Sprung';
import { KennungsLink } from '../components/kennungsLink';
import { Paneel, PaneelZustand } from '../components/instrument';
import { KEINE_BERECHTIGUNG, istKeyFreigegeben } from '../einsatz/modulRegistry';
import { NACHFORDERUNG_STATUS, StatusBadge, prioRang } from '../kommunikation';
import { nachforderungenPfad } from '../routing/deeplinks';

const TITEL = 'Bedarf';
const LEER_TEXT = 'Kein offener Bedarf angefordert';

/** „40× Feldbetten“ — Anzahl vor der Art, wie die Karte der Nachforderungsseite. */
function bedarfText(n: Pick<Nachforderung, 'anzahl' | 'art'>): string {
  return n.anzahl != null ? `${n.anzahl}× ${n.art}` : n.art;
}

/**
 * Die Nachforderungen einer Stelle, aufgeteilt in offene (sortiert wie die Offen-Ansicht der
 * Nachforderungsseite: Priorität, dann neueste) und die Zahl aller. Rein, für den Test exportiert.
 */
export function bedarfDerStelle(
  alle: readonly Nachforderung[],
  stelleId: number,
): { offene: Nachforderung[]; gesamt: number } {
  const derStelle = alle.filter((n) => n.betreuungsstelle_id === stelleId);
  const offene = derStelle
    .filter((n) => n.ist_offen)
    .sort((a, b) => {
      const rang = prioRang(a.prioritaet) - prioRang(b.prioritaet);
      return rang !== 0 ? rang : b.angefordert_at.localeCompare(a.angefordert_at);
    });
  return { offene, gesamt: derStelle.length };
}

/**
 * Paneel „Bedarf“ einer Betreuungsstelle (LLH-1082, design.md D6): die offenen Nachforderungen,
 * die für diese Stelle angefordert wurden, mit Status und Sprung in die Nachforderung.
 *
 * - **Eine Mengenwahrheit** (LFH-553): der Bedarf steht nur als Nachforderung; das Paneel liest die
 *   Einsatzliste der Nachforderungen (derselbe Cache wie deren Seite, live über `nachforderung`)
 *   und rechnet keine Summe.
 * - Abgefragt nur, wenn das Modul Nachforderungen freigegeben ist (strenge Lesart für Datenabrufe).
 *   Ohne Freigabe steht statt des Paneels eine Zeile mit dem Grund (M16), wie „Betroffene hier“.
 * - „Bedarf anfordern ↗“ führt in die Erfassung der Nachforderungsseite, mit Bezug auf die Stelle
 *   und gefiltert auf sie: das Formular hat sieben Felder, kein Fall für einen Dialog
 *   (`frontend/AGENTS.md`, UI-Form-Leitlinie). Nur mit Schreibrecht.
 * - Eingetroffene und abgelehnte Nachforderungen sind kein offener Bedarf; der Fuß führt auf alle
 *   der Stelle, sobald es welche gibt.
 */
export default function StelleBedarf({
  einsatzId,
  stelleId,
  freigaben,
  darfSchreiben,
}: {
  einsatzId: number;
  stelleId: number;
  /** Modulfreigaben aus dem Rahmen-Cache; `undefined`, solange sie laden. */
  freigaben: ModulFreigaben | undefined;
  darfSchreiben: boolean;
}) {
  const frei = istKeyFreigegeben('nachforderungen', freigaben);
  const query = useQuery({
    queryKey: einsatzKeys.nachforderungen(einsatzId),
    queryFn: () => listeNachforderungen(einsatzId, {}),
    enabled: frei,
  });
  const { offene, gesamt } = useMemo(
    () => bedarfDerStelle(query.data ?? [], stelleId),
    [query.data, stelleId],
  );

  // Freigaben bekannt und ohne Nachforderungen: benannt statt stumm.
  if (freigaben != null && !frei) {
    return (
      <Typography.Text type="secondary" data-lfh="bedarf-ohne-recht">
        {TITEL} · {KEINE_BERECHTIGUNG}
      </Typography.Text>
    );
  }

  const zustand =
    freigaben == null || query.isLoading
      ? 'laden'
      : query.isError && query.data == null
        ? 'fehler'
        : offene.length === 0
          ? 'leer'
          : 'daten';
  return (
    <Paneel
      titel={TITEL}
      meta={zustand === 'daten' ? `${offene.length} offen` : undefined}
      aktion={
        darfSchreiben && frei ? (
          <SprungKnopf
            to={nachforderungenPfad(einsatzId, { bezugStelle: stelleId, stelle: stelleId })}
          >
            Bedarf anfordern
          </SprungKnopf>
        ) : undefined
      }
      fuss={
        gesamt > 0 ? (
          <KennungsLink to={nachforderungenPfad(einsatzId, { stelle: stelleId })}>
            Alle Nachforderungen der Stelle <span aria-hidden="true">↗</span>
          </KennungsLink>
        ) : undefined
      }
    >
      <PaneelZustand
        zustand={zustand}
        titel={TITEL}
        // Kein Ausweg im Leerzustand: „Bedarf anfordern“ steht im Paneelkopf.
        leerText={LEER_TEXT}
        onNeuladen={() => void query.refetch()}
      >
        <Liste
          dataSource={offene}
          rowKey={(n) => n.id}
          size="small"
          unterEbene={2}
          renderItem={(n) => {
            const status = NACHFORDERUNG_STATUS[n.status] ?? NACHFORDERUNG_STATUS.angefordert;
            return (
              <ListenEintrag
                actions={[
                  <Space key="stand" size={8} wrap>
                    <StatusBadge phase={status.phase} label={status.label} ton={status.ton} />
                    <ZeitAnzeige wert={n.angefordert_at} rolle="kurz" />
                  </Space>,
                ]}
              >
                <ListenEintragMeta
                  title={
                    // Der Sprung öffnet die Nachforderung: Ansicht, Hervorhebung, Bildlauf.
                    <KennungsLink to={nachforderungenPfad(einsatzId, { nachforderung: n.id })}>
                      {bedarfText(n)}
                    </KennungsLink>
                  }
                  description={n.bezeichnung}
                />
              </ListenEintrag>
            );
          }}
        />
      </PaneelZustand>
    </Paneel>
  );
}
