package dev.rubeen.lifeline.kern

import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

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

    @Test
    fun `die Datei heißt server json`() {
        val verzeichnis = verzeichnis()
        Serverablage(verzeichnis).save(Serverliste())
        assertEquals(listOf("server.json"), verzeichnis.list()!!.toList())
    }
}
