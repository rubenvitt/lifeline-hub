package dev.rubeen.lifeline.helferkern

import java.time.Duration
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Wire-Format der Helfer-Routen (`src/helfer/anmeldung.rs`, `src/routes/helfer.rs`). */
class WireTest {
    @Test
    fun `der eigene Zustand wird gelesen, unbekannte Felder stoeren nicht`() {
        val zustand = Wire.zustand(
            """
            {"state":"aktiv","reason":null,"incident":{"id":42,"name":"Stadtfest"},
             "target":{"kind":"unit","id":1,"name":"San-Trupp 2"},"person":{"id":5,"name":"Max"},
             "is_tracker":true,"paused":false,"expires_at":"2026-11-25 22:00:00",
             "server_time":"2026-11-25 14:00:00","neu":1}
            """.trimIndent(),
        )!!
        assertEquals("aktiv", zustand.state)
        assertNull(zustand.reason)
        assertEquals("Stadtfest", zustand.incident.name)
        assertEquals("San-Trupp 2", zustand.target?.name)
        assertEquals("Max", zustand.person?.name)
        assertTrue(zustand.isTracker)
        assertFalse(zustand.paused)
        assertEquals(Rolle(isTracker = true, personId = 5), zustand.rolle)
    }

    @Test
    fun `ein Zustand ohne Ziel und Person`() {
        val zustand = Wire.zustand(
            """{"state":"beendet","reason":"incident_closed","incident":{"id":1,"name":"E"},
               "is_tracker":false,"paused":false,"expires_at":"x","server_time":"y"}""",
        )!!
        assertEquals("incident_closed", zustand.reason)
        assertNull(zustand.target)
        assertNull(zustand.person)
        assertFalse(zustand.rolle.darfOrten)
        assertNull(zustand.ablauf(Instant.EPOCH), "unlesbare Zeiten ergeben keinen Ablauf")
    }

    @Test
    fun `kaputtes JSON ergibt null`() {
        assertNull(Wire.zustand("<html>"))
        assertNull(Wire.zielliste("{}"))
    }

    @Test
    fun `der Ablauf wird auf die Uhr des Geraets umgerechnet`() {
        val zustand = Wire.zustand(
            """{"state":"aktiv","incident":{"id":1,"name":"E"},"is_tracker":true,"paused":false,
               "expires_at":"2026-11-25 22:00:00","server_time":"2026-11-25 14:00:00"}""",
        )!!
        val jetzt = Instant.parse("2030-01-01T00:00:00Z")
        assertEquals(jetzt.plus(Duration.ofHours(8)), zustand.ablauf(jetzt))
    }

    @Test
    fun `die Zielliste mit Rufname und Zeichen`() {
        val liste = Wire.zielliste(
            """{"targets":[{"kind":"unit","id":1,"name":"San-Trupp 2","call_sign":"Rotkreuz 72/2",
               "sign_function":"Sanitätsdienst","sign_organization":"DRK"},
               {"kind":"vehicle","id":1,"name":"RTW"}],"person_tracking_allowed":true}""",
        )!!
        assertTrue(liste.personTrackingAllowed)
        assertEquals(2, liste.targets.size)
        assertEquals("Rotkreuz 72/2", liste.targets[0].callSign)
        assertTrue(liste.targets[1].isFahrzeug)
        assertNull(liste.targets[1].callSign)
        assertTrue(liste.targets[0].kennung != liste.targets[1].kennung, "Einheit und Fahrzeug mit derselben Zahl")
    }

    @Test
    fun `Bodies der App in snake_case`() {
        assertEquals(
            """{"code":"AB","display_name":"Max","target":{"kind":"unit","id":1},"track_person":true}""",
            Wire.einloesung(Einloesung("AB", "Max", ZielEingabe("unit", 1), trackPerson = true)),
        )
        assertEquals("""{"target":{"kind":"vehicle","id":7}}""", Wire.zielaenderung(ZielEingabe("vehicle", 7)))
        assertEquals("""{"paused":true}""", Wire.pause(true))
        assertEquals("""{"code":"AB12CD34"}""", Wire.zielanfrage("AB12CD34"))
        assertEquals(
            """{"lat":50.1,"lon":8.6,"accuracy_m":5.0,"recorded_at":"2026-11-25T14:00:00Z"}""",
            Wire.position(Position(50.1, 8.6, 5.0, Instant.parse("2026-11-25T14:00:00Z"))),
        )
        assertEquals(
            """{"lat":50.1,"lon":8.6,"recorded_at":"2026-11-25T14:00:00Z"}""",
            Wire.position(Position(50.1, 8.6, null, Instant.parse("2026-11-25T14:00:00Z"))),
        )
    }

    @Test
    fun `Fehler-Body mit error und reason`() {
        val fehler = Wire.fehler("""{"error":"Ortung aus","reason":"tracking_off"}""")
        assertEquals("Ortung aus", fehler.error)
        assertEquals("tracking_off", fehler.reason)
        val leer = Wire.fehler("")
        assertNull(leer.error)
        assertNull(leer.reason)
    }
}
