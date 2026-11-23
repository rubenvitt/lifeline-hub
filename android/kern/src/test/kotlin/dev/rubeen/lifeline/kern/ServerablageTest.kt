package dev.rubeen.lifeline.kern

import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Ablage der Serverliste als JSON (`<verzeichnis>/server.json`). */
class ServerablageTest {
    private val aufzuraeumen = mutableListOf<File>()

    private fun verzeichnis(): File =
        Files.createTempDirectory("serverablage").toFile().also { aufzuraeumen += it }

    @AfterTest
    fun aufraeumen() {
        aufzuraeumen.forEach { it.deleteRecursively() }
    }

    @Test
    fun `ohne Datei ist die Liste leer`() {
        assertEquals(Serverliste(), Serverablage(verzeichnis()).load())
    }

    @Test
    fun `die Liste übersteht Speichern und Laden`() {
        val ablage = Serverablage(File(verzeichnis(), "neu"))
        var zaehler = 0
        val neueId = { "id-${++zaehler}" }
        val (eins, elw) = Serverliste().add(ServerAdresse.parse("https://elw.local:8443"), neueId = neueId)
        val (zwei, lager) = eins.add(ServerAdresse.parse("https://lager.example"), "Lager", neueId)
        val liste = zwei.activate(lager.id).markVerbunden(elw.id, 1_800_000_000_000, 1).markGeladen(elw.id)
        ablage.save(liste)
        val gelesen = ablage.load()
        assertEquals(liste, gelesen)
        assertEquals(lager.id, gelesen.aktiv?.id)
    }

    @Test
    fun `eine kaputte Datei wird beiseitegelegt statt überschrieben`() {
        val verzeichnis = verzeichnis()
        val ablage = Serverablage(verzeichnis)
        File(verzeichnis, "server.json").writeText("{kaputt")
        assertFailsWith<Exception> { ablage.load() }
        assertEquals(Serverliste(), ablage.loadOrRecover())
        assertEquals("{kaputt", File(verzeichnis, "server.defekt.json").readText())
        assertFalse(File(verzeichnis, "server.json").exists())
    }

    /**
     * Ein Eintrag, dessen Adresse die Prüfung heute ablehnt (etwa ein gesperrter Port, LLH-1987),
     * fällt beim Laden heraus; die übrigen Server bleiben, die Datei wird nicht beiseitegelegt.
     * War er aktiv, wird der erste übrige aktiv, sonst stünde die App ohne Weg zur Liste im
     * Onboarding (wie iOS und Desktop, `0c270c9f`).
     */
    @Test
    fun `ein Eintrag mit heute abgelehnter Adresse fällt heraus, die übrigen bleiben`() {
        val verzeichnis = verzeichnis()
        val ablage = Serverablage(verzeichnis)
        var zaehler = 0
        val neueId = { "id-${++zaehler}" }
        val (eins, elw) = Serverliste().add(ServerAdresse.parse("https://elw.local:8443"), neueId = neueId)
        val (zwei, lager) = eins.add(ServerAdresse.parse("https://lager.example:6001"), neueId = neueId)
        ablage.save(zwei.activate(lager.id))
        val datei = File(verzeichnis, "server.json")
        datei.writeText(datei.readText().replace("lager.example:6001", "lager.example:6000"))

        val gelesen = ablage.loadOrRecover()

        assertEquals(listOf(elw.id), gelesen.eintraege.map { it.id })
        assertEquals(elw.id, gelesen.aktiv?.id)
        assertTrue(datei.exists())
        assertFalse(File(verzeichnis, "server.defekt.json").exists())
    }

    @Test
    fun `ein abgelehnter nicht aktiver Eintrag lässt den aktiven aktiv`() {
        val verzeichnis = verzeichnis()
        val ablage = Serverablage(verzeichnis)
        var zaehler = 0
        val neueId = { "id-${++zaehler}" }
        val (eins, elw) = Serverliste().add(ServerAdresse.parse("https://elw.local:8443"), neueId = neueId)
        val (zwei, kv) = eins.add(ServerAdresse.parse("https://kv.example"), neueId = neueId)
        val (drei, _) = zwei.add(ServerAdresse.parse("https://lager.example:6001"), neueId = neueId)
        ablage.save(drei.activate(kv.id))
        val datei = File(verzeichnis, "server.json")
        datei.writeText(datei.readText().replace("lager.example:6001", "lager.example:6000"))

        val gelesen = ablage.load()

        assertEquals(listOf(elw.id, kv.id), gelesen.eintraege.map { it.id })
        assertEquals(kv.id, gelesen.aktiv?.id)
    }

    /**
     * Nur eine abgelehnte Adresse lässt einen Eintrag fallen. Ist er aus einem anderen Grund
     * unlesbar, bleibt die Datei unlesbar und wird beiseitegelegt statt still gekürzt.
     */
    @Test
    fun `ein anders kaputter Eintrag macht die Datei unlesbar`() {
        val verzeichnis = verzeichnis()
        val ablage = Serverablage(verzeichnis)
        val (eins, _) = Serverliste().add(ServerAdresse.parse("https://elw.local:8443"), neueId = { "id-1" })
        val (zwei, _) = eins.add(ServerAdresse.parse("https://lager.example"), "Lager", neueId = { "id-2" })
        ablage.save(zwei)
        val datei = File(verzeichnis, "server.json")
        datei.writeText(datei.readText().replace("\"name\": \"Lager\"", "\"name\": 7"))

        assertFailsWith<Exception> { ablage.load() }
        assertEquals(Serverliste(), ablage.loadOrRecover())
        assertTrue(File(verzeichnis, "server.defekt.json").exists())
    }

    @Test
    fun `die Datei heißt server json`() {
        val verzeichnis = verzeichnis()
        Serverablage(verzeichnis).save(Serverliste())
        assertEquals(listOf("server.json"), verzeichnis.list()!!.toList())
    }
}
