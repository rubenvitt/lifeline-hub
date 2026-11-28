import { Alert, App, Button, Popconfirm } from 'antd';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import {
  listeMeldungVorschlaege,
  uebernehmeMeldungVorschlag,
  verwirfMeldungVorschlag,
} from '../api/meldungen';
import { ApiError } from '../api/client';
import type { Einheit, Einsatzabschnitt, NeueMeldung, ReportSuggestion } from '../api/types';
import {
  Knopfreihe,
  MetaZeile,
  Paneel,
  PaneelZeile,
  PaneelZustand,
  Stapel,
  Textstufe,
  useRollen,
} from '../components/instrument';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { alsZeitpunkt } from '../anzeige/zeitEingabe';
import type { Speicherung } from '../components/Erfassung';
import { ZeilenFehler } from '../components/SpeicherHinweis';
import { useZeilenFehler } from '../components/useZeilenFehler';
import type { Vorschlagsquelle } from '../components/StammdatenFeld';
import type { FunktionsVorschlaege } from '../fuehrung/funktionsOptionenKern';
import type { StandardRufname } from '../etb/standardRufname';
import MeldungFormular, { type MeldungFormWerte } from './MeldungFormular';
import { herkunftAbsender, herkunftText } from './maschinenHerkunft';

/** Ein offener Übernahme-Dialog samt dem Einsatz, in dem er geöffnet wurde. */
interface Auswahl {
  einsatzId: number;
  vorschlag: ReportSuggestion;
}

/** Vorbelegung der Meldung aus dem Vorschlag (Design LLH-2112, „Oberfläche“). */
function vorbelegungAus(v: ReportSuggestion): Partial<MeldungFormWerte> {
  return {
    inhalt: v.text,
    absender: herkunftAbsender(v.source),
    meldeweg: 'funk',
    meldungsart: 'sonstige',
    ereigniszeit: alsZeitpunkt(v.sent_at ?? v.received_at) ?? null,
  };
}

const TITEL = 'Vorschläge · unverifiziert';

/**
 * Vorschläge maschineller Zugänge im Meldungseingang (LLH-2112, ADR-0112): kurze Texte etwa einer
 * Mesh-Funkbrücke, unverifiziert. Der Bereich steht über der Liste und nur, solange es offene
 * gibt. „Als Meldung übernehmen“ öffnet das Meldungsformular vorbelegt, Speichern schickt
 * `accept`; „Verwerfen“ fragt nach, denn der Server kennt keinen Rückweg (Bedien-Leitlinie,
 * „Destruktiv ist nicht gleich destruktiv“). Ohne Schreibrecht (Mitarbeit) bleibt die Liste ohne
 * Handlungen. Geräte rendern den Bereich nicht (der Server antwortet ihnen mit 403).
 */
export default function MeldungVorschlaege({
  einsatzId,
  darfSchreiben,
  einheiten,
  abschnitte,
  funktionsVorschlaege,
  vorschlagsquellen,
  eigeneStelle,
}: {
  einsatzId: number;
  /** Übernehmen und Verwerfen: dasselbe Recht wie Status und Zuweisung an der Meldung. */
  darfSchreiben: boolean;
  einheiten?: Einheit[];
  abschnitte?: Einsatzabschnitt[];
  funktionsVorschlaege?: FunktionsVorschlaege;
  vorschlagsquellen?: readonly Vorschlagsquelle[];
  eigeneStelle?: StandardRufname | null;
}) {
  const { token } = useRollen();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: einsatzKeys.meldungVorschlaege(einsatzId),
    queryFn: () => listeMeldungVorschlaege(einsatzId),
  });
  const vorschlaege = query.data;

  const [auswahl, setAuswahl] = useState<Auswahl | null>(null);
  const offen = auswahl?.einsatzId === einsatzId ? auswahl.vorschlag : null;
  const vorbelegung = useMemo(() => (offen ? vorbelegungAus(offen) : undefined), [offen]);

  const neuAbfragen = (eid: number) =>
    qc.invalidateQueries({ queryKey: einsatzKeys.meldungVorschlaege(eid) });

  // Der Dialog schließt erst beim Erfolg (`onFertig`); eine Ablehnung steht in ihm (`speicherung`).
  const annahme = useMutation({
    mutationFn: (v: { einsatzId: number; vorschlagId: number; daten: NeueMeldung }) =>
      uebernehmeMeldungVorschlag(v.einsatzId, v.vorschlagId, v.daten),
    onSuccess: (meldung, v) => {
      void neuAbfragen(v.einsatzId);
      void qc.invalidateQueries({ queryKey: einsatzKeys.meldungen(v.einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.modulZaehler(v.einsatzId) });
      message.success(`Meldung #${meldung.lfd_nr} erfasst`);
    },
    // Nicht mehr offen oder abgelaufen: die Liste zeigt danach den Stand des Servers.
    onError: (e, v) => {
      if (e instanceof ApiError && e.status === 409) void neuAbfragen(v.einsatzId);
    },
  });
  const diese = annahme.variables?.einsatzId === einsatzId;
  const speicherung: Speicherung = {
    error: diese ? annahme.error : null,
    isPending: diese && annahme.isPending,
    reset: annahme.reset,
  };

  // Grund einer Ablehnung an der Zeile (LFH-1077); ein 409 holt den Stand, die Zeile fällt dann weg.
  const zeilenFehler = useZeilenFehler<number>();
  const verwerfen = useMutation({
    mutationFn: (v: { einsatzId: number; vorschlagId: number }) =>
      verwirfMeldungVorschlag(v.einsatzId, v.vorschlagId),
    onMutate: (v) => zeilenFehler.beginne(v.vorschlagId),
    onSuccess: (_d, v) => {
      void neuAbfragen(v.einsatzId);
      void qc.invalidateQueries({ queryKey: einsatzKeys.modulZaehler(v.einsatzId) });
      message.success('Vorschlag verworfen');
    },
    onError: (e, v) => {
      if (v.einsatzId === einsatzId)
        zeilenFehler.melde(v.vorschlagId, e, 'Verwerfen fehlgeschlagen');
      if (e instanceof ApiError && e.status === 409) void neuAbfragen(v.einsatzId);
    },
  });

  if (!vorschlaege) {
    if (!query.isError) return null;
    return (
      <Paneel titel={TITEL} style={{ marginBottom: token.margin }}>
        <PaneelZustand
          zustand="fehler"
          titel={TITEL}
          leerText=""
          onNeuladen={() => void query.refetch()}
        >
          {null}
        </PaneelZustand>
      </Paneel>
    );
  }
  if (vorschlaege.length === 0 && !offen) return null;

  return (
    <>
      {vorschlaege.length > 0 && (
        <Paneel titel={`${TITEL} (${vorschlaege.length})`} style={{ marginBottom: token.margin }}>
          {vorschlaege.map((v) => {
            const grund = zeilenFehler.grund(v.id);
            return (
              <PaneelZeile key={v.id}>
                <Stapel abstand="xs">
                  <MetaZeile>
                    <MetaZeile.Teil mono>
                      <ZeitAnzeige wert={v.sent_at ?? v.received_at} rolle="kurz" />
                    </MetaZeile.Teil>
                    <MetaZeile.Teil>{herkunftText(v.source)}</MetaZeile.Teil>
                  </MetaZeile>
                  <Textstufe als="div">{v.text}</Textstufe>
                  {grund && <ZeilenFehler fehler={grund.fehler} fallback={grund.fallback} />}
                  {darfSchreiben && (
                    <Knopfreihe aria-label={`Vorschlag von ${herkunftAbsender(v.source)}`}>
                      <Button
                        type="primary"
                        onClick={() => setAuswahl({ einsatzId, vorschlag: v })}
                      >
                        Als Meldung übernehmen
                      </Button>
                      <Popconfirm
                        title="Vorschlag verwerfen?"
                        description="Er lässt sich danach nicht mehr übernehmen."
                        okText="Vorschlag verwerfen"
                        cancelText="Abbrechen"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => verwerfen.mutate({ einsatzId, vorschlagId: v.id })}
                      >
                        <Button
                          danger
                          loading={verwerfen.isPending && verwerfen.variables?.vorschlagId === v.id}
                        >
                          Verwerfen
                        </Button>
                      </Popconfirm>
                    </Knopfreihe>
                  )}
                </Stapel>
              </PaneelZeile>
            );
          })}
        </Paneel>
      )}
      {/* Je Vorschlag ein frisch eingehängtes Formular: die Hülle liest Startwerte beim Einhängen.
          Kein Entwurfsspeicher: das Meldungsformular hat keinen, Abbrechen lässt den Vorschlag offen. */}
      {offen && darfSchreiben && (
        <MeldungFormular
          key={offen.id}
          dialog={{
            offen: true,
            titel: 'Vorschlag als Meldung übernehmen',
            onAbbrechen: () => setAuswahl(null),
          }}
          serie={false}
          onFertig={() => setAuswahl(null)}
          senden={speicherung.isPending}
          speicherung={speicherung}
          onAnlegen={(daten) => annahme.mutateAsync({ einsatzId, vorschlagId: offen.id, daten })}
          vorbelegung={vorbelegung}
          hinweis={
            <Alert
              type="warning"
              showIcon
              title={`Unverifiziert · ${herkunftText(offen.source)}`}
            />
          }
          einsatzId={einsatzId}
          einheiten={einheiten}
          abschnitte={abschnitte}
          funktionsVorschlaege={funktionsVorschlaege}
          vorschlagsquellen={vorschlagsquellen}
          eigeneStelle={eigeneStelle}
        />
      )}
    </>
  );
}
