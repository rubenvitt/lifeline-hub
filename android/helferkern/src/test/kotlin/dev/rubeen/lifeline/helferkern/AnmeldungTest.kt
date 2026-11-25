package dev.rubeen.lifeline.helferkern

import dev.rubeen.lifeline.kern.ServerAdresse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Zustandsautomat der Anmeldung (Spec „Die Helfer-App“, „Logik im Kern“). */
class AnmeldungTest {
    private val ziel = HelferZiel(ServerAdresse.parse("https://elw.local:8443"), "AB12CD34")
    private val tracker = Rolle(isTracker = true, personId = null)
    private val ohneRolle = Rolle(isTracker = false, personId = null)
    private val nurPerson = Rolle(isTracker = false, personId = 5)

    private fun aktiv(rolle: Rolle) = Ereignis.Zustand("aktiv", null, rolle)

    private fun bestaetigt() = anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, aktiv(tracker))

    private fun ruht(grund: String) = Ereignis.Antwortet(Antwort.RUHEN, grund)

    private fun anmeldung(vararg ereignisse: Ereignis) =
        Anmeldung().also { a -> ereignisse.forEach(a::verarbeite) }

    @Test
    fun `der Regelweg fuehrt vom Scan bis zur aktiven Ortung`() {
        val a = Anmeldung()
        assertEquals(Phase.Start, a.phase)
        a.verarbeite(Ereignis.Gescannt(ziel))
        assertEquals(Phase.Anmelden(ziel), a.phase)
        a.verarbeite(Ereignis.Eingeloest)
        assertEquals(Phase.Unbestaetigt, a.phase)
        assertTrue(a.phase.ortet, "die Ortung startet schon beim Einlösen")
        a.verarbeite(Ereignis.Bestaetigt)
        assertEquals(Phase.Aktiv, a.phase)
        a.verarbeite(Ereignis.Pausiert)
        assertEquals(Phase.Pausiert, a.phase)
        assertFalse(a.phase.ortet)
        a.verarbeite(Ereignis.Fortgesetzt)
        assertEquals(Phase.Aktiv, a.phase)
        a.verarbeite(Ereignis.Abgemeldet)
        assertEquals(Phase.Beendet(Grund.ABGEMELDET), a.phase)
    }

    @Test
    fun `Stoppen beendet die Anmeldung in jeder Kopplungsphase`() {
        val a = anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, Ereignis.Bestaetigt, Ereignis.Antwortet(Antwort.STOPPEN))
        assertEquals(Phase.Beendet(Grund.ENTFERNT), a.phase)
        assertFalse(a.phase.ortet)
        assertEquals(
            Phase.Beendet(Grund.ENTFERNT),
            anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, Ereignis.Bestaetigt, Ereignis.Pausiert, Ereignis.Antwortet(Antwort.STOPPEN)).phase,
        )
        assertEquals(
            Phase.Beendet(Grund.ENTFERNT),
            anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, Ereignis.Antwortet(Antwort.STOPPEN)).phase,
        )
    }

    @Test
    fun `Warten in Unbestaetigt bleibt unbestaetigt`() {
        val a = anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, Ereignis.Antwortet(Antwort.WARTEN))
        assertEquals(Phase.Unbestaetigt, a.phase)
        assertTrue(a.phase.ortet, "bei 409 läuft der Dienst weiter")
    }

    @Test
    fun `die erste angenommene Position bestaetigt`() {
        assertEquals(
            Phase.Aktiv,
            anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, Ereignis.Antwortet(Antwort.WEITER)).phase,
        )
    }

    @Test
    fun `Wiederholen und Verwerfen aendern nichts`() {
        for (antwort in listOf(Antwort.WIEDERHOLEN, Antwort.VERWERFEN)) {
            assertEquals(Phase.Unbestaetigt, anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, Ereignis.Antwortet(antwort)).phase)
            assertEquals(
                Phase.Aktiv,
                anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, Ereignis.Bestaetigt, Ereignis.Antwortet(antwort)).phase,
            )
        }
        assertEquals(
            Phase.Pausiert,
            anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, Ereignis.Bestaetigt, Ereignis.Pausiert, Ereignis.Antwortet(Antwort.WEITER)).phase,
            "die Antwort auf das Pausieren setzt nicht fort",
        )
    }

    @Test
    fun `ohne Kopplung bewirkt eine Antwort nichts`() {
        assertEquals(Phase.Start, anmeldung(Ereignis.Antwortet(Antwort.STOPPEN)).phase)
        assertEquals(Phase.Anmelden(ziel), anmeldung(Ereignis.Gescannt(ziel), Ereignis.Antwortet(Antwort.WEITER)).phase)
    }

    @Test
    fun `ein Scan waehrend einer Kopplung aendert nichts`() {
        val anderes = HelferZiel(ServerAdresse.parse("https://fremd.example"), "K7M2Q9XA")
        assertEquals(Phase.Unbestaetigt, anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, Ereignis.Gescannt(anderes)).phase)
        assertEquals(Phase.Anmelden(anderes), anmeldung(Ereignis.Gescannt(ziel), Ereignis.Gescannt(anderes)).phase)
    }

    @Test
    fun `nach dem Ende fuehrt nur ein neuer Scan weiter`() {
        val a = anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, Ereignis.Abgemeldet)
        assertEquals(Phase.Beendet(Grund.ABGEMELDET), a.phase)
        for (ereignis in listOf(
            Ereignis.Eingeloest, Ereignis.Bestaetigt, Ereignis.Antwortet(Antwort.WEITER),
            Ereignis.Fortgesetzt, Ereignis.Zustand("aktiv", null, tracker),
        )) {
            a.verarbeite(ereignis)
            assertEquals(Phase.Beendet(Grund.ABGEMELDET), a.phase, "$ereignis")
        }
        a.verarbeite(Ereignis.Gescannt(ziel))
        assertEquals(Phase.Anmelden(ziel), a.phase)
    }

    @Test
    fun `Abbrechen vor dem Einloesen fuehrt zum Start`() {
        assertEquals(Phase.Start, anmeldung(Ereignis.Gescannt(ziel), Ereignis.Abgemeldet).phase)
    }

    @Test
    fun `Zustand vom Server`() {
        val a = anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest)
        a.verarbeite(Ereignis.Zustand("aktiv", null, tracker))
        assertEquals(Phase.Aktiv, a.phase)
        a.verarbeite(Ereignis.Pausiert)
        a.verarbeite(Ereignis.Zustand("aktiv", null, tracker))
        assertEquals(Phase.Pausiert, a.phase, "der Zustand `aktiv` hebt die eigene Pause nicht auf")
        a.verarbeite(Ereignis.Zustand("unbekannt", null, tracker))
        assertEquals(Phase.Pausiert, a.phase)
        a.verarbeite(Ereignis.Zustand("beendet", "incident_closed", tracker))
        assertEquals(Phase.Beendet(Grund.EINSATZ_BEENDET), a.phase)

        assertEquals(
            Phase.Beendet(Grund.ABGELEHNT),
            anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, Ereignis.Zustand("abgelehnt", "rejected", tracker)).phase,
        )
        assertEquals(
            Phase.Beendet(Grund.ENTFERNT),
            anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, Ereignis.Zustand("beendet", null, tracker)).phase,
        )
        assertEquals(
            Phase.Unbestaetigt,
            anmeldung(Ereignis.Zustand("unbestaetigt", null, tracker)).phase,
            "nach einem Neustart der App stellt der Zustand des Servers die Phase her",
        )
        assertEquals(
            Phase.Anmelden(ziel),
            anmeldung(Ereignis.Gescannt(ziel), Ereignis.Zustand("aktiv", null, tracker)).phase,
        )
    }

    @Test
    fun `jeder Wire-Grund hat einen Grund`() {
        val wire = listOf("incident_closed", "revoked", "expired", "rejected", "signed_out")
        assertEquals(Grund.entries.toSet(), wire.mapNotNull(Grund::ausWire).toSet())
        for (grund in Grund.entries) {
            assertEquals(grund, Grund.ausWire(grund.wire))
            assertTrue(grund.titel.isNotEmpty())
            assertTrue(grund.text.isNotEmpty())
        }
        assertNull(Grund.ausWire("tracking_off"))
    }

    @Test
    fun `403 no_role nach der Bestaetigung ruht, statt die Anmeldung zu beenden`() {
        val a = bestaetigt()
        a.verarbeite(ruht("no_role"))
        assertEquals(Phase.Ruht(Ruhegrund.KEINE_ROLLE), a.phase)
        assertFalse(a.phase.ortet, "der Dienst ist aus")
        assertTrue(a.phase.gekoppelt, "Kopplung und Sitzung bleiben, Abmelden geht weiter")
        a.verarbeite(Ereignis.Abgemeldet)
        assertEquals(Phase.Beendet(Grund.ABGEMELDET), a.phase)
    }

    @Test
    fun `403 tracking_off ruht in jeder ortenden Phase, eine Pause bleibt Pause`() {
        assertEquals(Phase.Ruht(Ruhegrund.ORTUNG_AUS), bestaetigt().also { it.verarbeite(ruht("tracking_off")) }.phase)
        assertEquals(
            Phase.Ruht(Ruhegrund.ORTUNG_AUS),
            anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, ruht("tracking_off")).phase,
        )
        assertEquals(
            Phase.Pausiert,
            anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, Ereignis.Bestaetigt, Ereignis.Pausiert, ruht("tracking_off")).phase,
        )
    }

    @Test
    fun `ohne Ortungsgeraet und Person ruht die Anmeldung schon beim Bestaetigen`() {
        val a = anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, aktiv(ohneRolle))
        assertEquals(Phase.Ruht(Ruhegrund.KEINE_ROLLE), a.phase)
        a.verarbeite(aktiv(ohneRolle))
        assertEquals(Phase.Ruht(Ruhegrund.KEINE_ROLLE), a.phase)
        a.verarbeite(aktiv(tracker))
        assertEquals(Phase.Aktiv, a.phase, "die Leitung macht das Gerät zum Ortungsgerät: es ortet weiter")
        assertTrue(a.phase.ortet)
    }

    @Test
    fun `die Ruhe ohne Rolle endet erst mit einer anderen Rolle`() {
        // Person zugeordnet, aber die Organisation ortet keine Personen: 403 no_role.
        val a = anmeldung(Ereignis.Gescannt(ziel), Ereignis.Eingeloest, aktiv(nurPerson))
        assertEquals(Phase.Aktiv, a.phase)
        a.verarbeite(ruht("no_role"))
        a.verarbeite(aktiv(nurPerson))
        assertEquals(Phase.Ruht(Ruhegrund.KEINE_ROLLE), a.phase, "dieselbe Rolle sendete nur wieder in den 403")
        a.verarbeite(aktiv(tracker))
        assertEquals(Phase.Aktiv, a.phase)
    }

    @Test
    fun `eine veraltete Rolle beim Ruhen haelt die Ruhe nicht fest`() {
        val a = bestaetigt()
        a.verarbeite(ruht("no_role"))
        a.verarbeite(aktiv(ohneRolle))
        a.verarbeite(aktiv(tracker))
        assertEquals(Phase.Aktiv, a.phase, "erst ohne Rolle, dann wieder Ortungsgerät")
    }

    @Test
    fun `die Ruhe bei Ortung aus endet nur mit einem angenommenen Fortsetzen`() {
        val a = bestaetigt()
        a.verarbeite(ruht("tracking_off"))
        a.verarbeite(aktiv(tracker))
        assertEquals(Phase.Ruht(Ruhegrund.ORTUNG_AUS), a.phase, "der Zustand nennt die Einstellung der Organisation nicht")
        a.verarbeite(Ereignis.Zustand("unbestaetigt", null, ohneRolle))
        assertEquals(Phase.Ruht(Ruhegrund.ORTUNG_AUS), a.phase)
        a.verarbeite(ruht("tracking_off"))
        assertEquals(Phase.Ruht(Ruhegrund.ORTUNG_AUS), a.phase)
        a.verarbeite(Ereignis.Antwortet(Antwort.WEITER))
        assertEquals(Phase.Aktiv, a.phase)
        assertTrue(Ruhegrund.ORTUNG_AUS.pruefeMitFortsetzen)
        assertFalse(Ruhegrund.KEINE_ROLLE.pruefeMitFortsetzen)
    }

    @Test
    fun `aus der Ruhe beenden 401 404 und der Zustand des Servers`() {
        assertEquals(
            Phase.Beendet(Grund.ENTFERNT),
            bestaetigt().also { it.verarbeite(ruht("no_role")); it.verarbeite(Ereignis.Antwortet(Antwort.STOPPEN)) }.phase,
        )
        assertEquals(
            Phase.Beendet(Grund.EINSATZ_BEENDET),
            bestaetigt().also {
                it.verarbeite(ruht("tracking_off"))
                it.verarbeite(Ereignis.Zustand("beendet", "incident_closed", tracker))
            }.phase,
        )
        assertEquals(
            Phase.Unbestaetigt,
            bestaetigt().also {
                it.verarbeite(ruht("tracking_off"))
                it.verarbeite(Ereignis.Antwortet(Antwort.WARTEN))
            }.phase,
            "ein Fortsetzen mit 409: die Leitung hat noch nicht bestätigt",
        )
    }

    @Test
    fun `403 ohne bekannten Grund beendet weiter`() {
        assertEquals(Phase.Beendet(Grund.ENTFERNT), bestaetigt().also { it.verarbeite(Ereignis.Antwortet(entscheide(403, "target_removed"))) }.phase)
        assertEquals(Antwort.RUHEN, entscheide(403, "no_role"))
        assertEquals(Antwort.STOPPEN, entscheide(403))
        assertEquals(Ruhegrund.entries.toSet(), listOf("no_role", "tracking_off").mapNotNull(Ruhegrund::ausWire).toSet())
        assertNull(Ruhegrund.ausWire(null))
        for (grund in Ruhegrund.entries) assertTrue(grund.text.isNotEmpty())
    }

    @Test
    fun `Statuscodes entscheiden wie im Swift-Kern`() {
        assertEquals(Antwort.VERWERFEN, entscheide(400))
        assertEquals(Antwort.VERWERFEN, entscheide(410))
        assertEquals(Antwort.WIEDERHOLEN, entscheide(408))
        assertEquals(Antwort.WIEDERHOLEN, entscheide(429))
        assertEquals(Antwort.WARTEN, entscheide(409))
        assertEquals(Antwort.WIEDERHOLEN, entscheide(0))
        assertEquals(Antwort.WIEDERHOLEN, entscheide(503))
        assertEquals(Antwort.WIEDERHOLEN, entscheide(302), "eine Weiterleitung folgt die App nicht")
    }
}
