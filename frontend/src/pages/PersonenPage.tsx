import { Alert, App, Breadcrumb, Button, Space, Spin, Tabs, Tag, Typography } from 'antd';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { personDetailPfad } from '../routing/deeplinks';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { legePersonAn, listePersonen, schlageAbgleichVor, setzePersonStatus, type PersonEingabe } from '../api/einsatzPerson';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import type { Person, Sichtungskategorie } from '../api/types';
import { PATIENT_SK, SK_META, istPatient } from '../personen/personMeta';
import { abgleichSpalten, personenKarte, personenSpalten } from '../personen/personenSpalten';
import { filterPersonen, gefundenePersonen, type PersonenSicht } from '../personen/personenFilter';
import AbgleichVorschlagModal from '../personen/AbgleichVorschlagModal';
import PersonErfassungModal, { type ErfassungsModus } from '../personen/PersonErfassungModal';
import LagebildStreifen from '../personen/LagebildStreifen';

/** Sicht-Tabs: 'alle' = kein Filter; 'patienten' = SK-Achse; sonst Status-Filter. */
type Sicht = PersonenSicht;
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'erfasst', label: 'Neu' },
  { key: 'vermisst', label: 'Vermisst' },
  { key: 'betroffen', label: 'Betroffen' },
  { key: 'patienten', label: 'Patienten' },
  { key: 'verstorben', label: 'Verstorben' },
  { key: 'alle', label: 'Alle' },
];

export default function PersonenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const [sicht, setSicht] = useState<Sicht>('erfasst');

  // Live-Updates über den konsolidierten useEinsatzLiveStream im EinsatzLayout (LFH-207).

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
  });

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modus, setModus] = useState<ErfassungsModus | null>(null);
  /** `null` = kein Abgleich-Dialog offen. Trägt die vermisste Person, zu der gesucht wird. */
  const [abgleichFuer, setAbgleichFuer] = useState<Person | null>(null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: async (v: { daten: PersonEingabe; folgeStatus?: 'vermisst' | 'betroffen' }) => {
      const person = await legePersonAn(einsatzId, v.daten);
      if (v.folgeStatus) await setzePersonStatus(einsatzId, person.id, v.folgeStatus);
      return person;
    },
    onSuccess: () => { invalidate(); setModus(null); },
    onError: fehler,
  });

  // Deep-Link: ?person=<id> leitet auf die Detailseite um (rückwärtskompatibel
  // mit dem alten Drawer-Verhalten, z. B. „Vollständig öffnen" aus dem UHS-Drawer).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const pid = searchParams.get('person');
    if (pid) navigate(personDetailPfad(einsatzId, Number(pid)), { replace: true });
  }, [searchParams, einsatzId, navigate]);

  // Schnellaktion: ?neu=1 öffnet die Schnellerfassung (Command-Palette, LFH-11).
  // Warten bis der Einsatz geladen ist; Param immer löschen, aber Modal nur bei Schreibrecht öffnen.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    const e = einsatzQuery.data;
    const darfSchr = darfImEinsatzSchreiben(e, benutzer);
    if (darfSchr) setModus('schnell');
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, einsatzQuery.data, benutzer]);

  const abgleichVorschlagMutation = useMutation({
    mutationFn: (v: { vermisstId: number; gefundenId: number }) =>
      schlageAbgleichVor(einsatzId, v.vermisstId, v.gefundenId),
    onSuccess: () => { invalidate(); setAbgleichFuer(null); message.success('Verdachts-Abgleich angelegt'); },
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const alle = personenQuery.data ?? [];
  const gefundene = gefundenePersonen(alle);
  const darfAbgleichen = darfSchreiben && sicht === 'vermisst';

  /**
   * Die Spaltenliste der Listen-Sicht: Register plus Abgleichspalte.
   *
   * Durch `spaltenFuer<Person>()` geführt, NICHT annotiert. Eine Annotation
   * (`readonly DatensichtSpalte<Person>[]`) weitete die Schlüsselliterale auf `string`, und
   * jeder Tippfehler in einem Kartenplan-Slot wäre danach unbemerkt. Gemessen: durch die
   * Fabrik geführt bleibt `K` die Vereinigung beider Teillisten und ein falscher Slot
   * scheitert am Typcheck.
   */
  const listenSpalten = spaltenFuer<Person>()([
    ...personenSpalten,
    ...(darfAbgleichen
      ? abgleichSpalten(gefundene, (vermisstId, gefundenId) =>
          abgleichVorschlagMutation.mutate({ vermisstId, gefundenId }),
        )
      : []),
  ]);

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Personen' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Personen</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && (
          <Space>
            <Button type="primary" onClick={() => setModus('schnell')}>Schnellerfassung</Button>
            <Button onClick={() => setModus('vermisst')}>Vermisst melden</Button>
            <Button onClick={() => setModus('betroffen')}>Betroffene/n erfassen</Button>
          </Space>
        )}
      </Space>

      <Tabs
        activeKey={sicht}
        onChange={(k) => setSicht(k as Sicht)}
        items={SICHTEN.map((s) => ({ key: s.key, label: s.label }))}
      />

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <LagebildStreifen alle={alle} />

      {sicht === 'patienten' ? (
        /**
         * EINE Sicht mit Gruppenachse statt fünf Tabellen: damit gibt es eine stehende
         * Kopfzeile, eine fixierte Kennungsspalte und einen Spaltenschalter statt fünf.
         * Die Ordnung ist die Dringlichkeit — SK-Rang zuerst (Gruppenachse ist die führende
         * Sortierachse), innerhalb der Kategorie der ÄLTESTE Sichtungszeitpunkt zuerst.
         */
        <Datensicht
          /**
           * `key` ist hier NICHT Kosmetik, sondern das Einzige, was die beiden Sichten
           * trennt. Sie stehen an DERSELBEN Stelle im Elementbaum und haben denselben
           * Komponententyp — React reicht die Instanz samt internem Zustand (Sortierung,
           * Suchbegriff, Spaltenauswahl, Zeilenschleuse) einfach weiter, statt neu zu
           * montieren. Gemessen: ohne die Schlüssel behielt der Patienten-Reiter die
           * `standardSortierung` der Listen-Sicht (`reg`), und die Dringlichkeitsordnung
           * nach `seit` griff nie — ohne Fehler, ohne Warnung. `datensicht.guard.test.ts`
           * hält die Regel seither fest.
           */
          key="patienten"
          bezeichnung="Patienten nach Sichtungskategorie"
          spalten={personenSpalten}
          daten={alle.filter(istPatient)}
          zeilenSchluessel="id"
          ladend={personenQuery.isLoading}
          leerText="Keine Patienten in diesem Einsatz."
          standardSortierung={{ spalte: 'seit', richtung: 'auf' }}
          gruppen={{
            schluessel: (p) => p.aktuelle_sichtung ?? 'ohne',
            // 'ohne' ist hier unerreichbar (`istPatient` filtert es weg) und steht nur,
            // damit die Funktion total bleibt statt an einem Nachschlag zu werfen.
            etikett: (sk) => (sk === 'ohne' ? 'ohne SK' : SK_META[sk as Sichtungskategorie].label),
            reihenfolge: [...PATIENT_SK],
          }}
          onZeileKlick={(p) => navigate(personDetailPfad(einsatzId, p.id))}
          karte={personenKarte(einsatzId)}
        />
      ) : (
        <Datensicht
          /**
           * Gegenstück zum Schlüssel oben — mit einem Zusatz, der dort nicht nötig ist:
           * der Schlüssel trägt den REITER, nicht bloß den Zweig. Diese eine Stelle im
           * Baum bedient FÜNF Sichten mit fünf verschiedenen Datenmengen; bei konstantem
           * Schlüssel reicht React auch beim Reiterwechsel dieselbe Instanz weiter.
           * Gemessen: im Reiter „Vermisst" nach einem Namen gesucht und auf „Betroffen"
           * gewechselt — dort stand der Begriff noch im Feld und filterte eine fremde
           * Menge auf leer. Kein Fehler, keine Warnung, nur fehlende Zeilen.
           *
           * Der Preis, dreifach und gewollt: mit dem Reiterwechsel fallen auch
           * Sortierung, Spaltenauswahl und die Zeilenschleuse (Sammelbanner) zurück.
           * Für die Spaltenauswahl ist das nicht nur hinnehmbar, sondern richtig — die
           * Spaltenliste ist je Reiter eine andere (`abgleichSpalten` existiert nur unter
           * `sicht === 'vermisst'`), eine mitgeschleppte Auswahl trüge also Schlüssel,
           * die es in der nächsten Sicht gar nicht gibt.
           */
          key={`liste-${sicht}`}
          bezeichnung="Personen"
          spalten={listenSpalten}
          daten={filterPersonen(alle, sicht)}
          zeilenSchluessel="id"
          ladend={personenQuery.isLoading}
          leerText="Keine Personen in dieser Sicht"
          suche={{ platzhalter: 'R-Nr. oder Name' }}
          standardSortierung={{ spalte: 'reg', richtung: 'auf' }}
          onZeileKlick={(p) => navigate(personDetailPfad(einsatzId, p.id))}
          karte={{
            ...personenKarte(einsatzId),
            // Der Kartenzweig trägt das Auswahlfeld der Abgleichspalte nicht (24 px hoch,
            // 200 px fest breit) — der Deskriptor ersetzt es durch einen Knopf plus Dialog.
            aktion: darfAbgleichen
              ? { etikett: 'Abgleich vorschlagen …', onKlick: (p) => setAbgleichFuer(p) }
              : undefined,
          }}
        />
      )}

      <AbgleichVorschlagModal
        vermisst={abgleichFuer}
        gefundene={gefundene}
        isPending={abgleichVorschlagMutation.isPending}
        onCancel={() => setAbgleichFuer(null)}
        onFinish={(gefundenId) =>
          abgleichFuer &&
          abgleichVorschlagMutation.mutate({ vermisstId: abgleichFuer.id, gefundenId })
        }
      />

      <PersonErfassungModal
        modus={modus}
        isPending={anlegenMutation.isPending}
        onCancel={() => setModus(null)}
        onFinish={(daten) =>
          anlegenMutation.mutate({
            daten,
            folgeStatus: modus === 'vermisst' ? 'vermisst' : modus === 'betroffen' ? 'betroffen' : undefined,
          })
        }
      />
    </div>
  );
}
