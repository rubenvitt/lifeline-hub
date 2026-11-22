package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Entscheidungen des Updaters (Entwurf D9): wann prüfen, was neuer ist, woher laden, wann installieren. */
class UpdateTest {
    private val sha = "a".repeat(64)

    private fun manifest(version: String, code: Int) =
        Updatemanifest(version, code, "https://github.com/rubenvitt/lifeline-hub/releases/download/x/a.apk", sha)

    // Manifest

    @Test
    fun `das Manifest wird gelesen und ignoriert Unbekanntes`() {
        val m = Updatemanifest.parse(
            """{"version":"1.0.0-alpha.6","version_code":101,"url":"https://github.com/x.apk","sha256":"$sha","neu":1}""",
        )
        assertEquals(Updatemanifest("1.0.0-alpha.6", 101, "https://github.com/x.apk", sha), m)
    }

    @Test
    fun `ein kaputtes Manifest ergibt nichts`() {
        for (json in listOf("", "{", "[]", """{"version":"1"}""", """{"version":"1","version_code":"x","url":"u","sha256":"s"}""")) {
            assertNull(Updatemanifest.parse(json), json)
        }
    }

    // Neuer?

    @Test
    fun `nur ein neueres Release mit größerem Code ist ein Update`() {
        val eigen = "1.0.0-alpha.5"
        assertTrue(Updateentscheidung.isNeuer(eigen, 100, manifest("1.0.0-alpha.6", 101)))
        assertFalse(Updateentscheidung.isNeuer(eigen, 100, manifest("1.0.0-alpha.6", 100)))
        assertTrue(Updateentscheidung.isNeuer(eigen, 100, manifest("1.0.0", 200)))
        assertFalse(Updateentscheidung.isNeuer(eigen, 100, manifest("1.0.0-alpha.4", 300)))
        assertFalse(Updateentscheidung.isNeuer(eigen, 100, manifest("1.0.0-alpha.5", 300)))
        // Eine unlesbare Version ist nie ein Update.
        assertFalse(Updateentscheidung.isNeuer(eigen, 100, manifest("neu", 300)))
        assertFalse(Updateentscheidung.isNeuer("kaputt", 100, manifest("1.0.0", 300)))
    }

    // Download

    @Test
    fun `Download nur von GitHub`() {
        val ok = listOf(
            "https://github.com/rubenvitt/lifeline-hub/releases/download/v1/x.apk",
            "https://objects.githubusercontent.com/github-production-release-asset/1",
            "https://release-assets.githubusercontent.com/x",
            "https://GitHub.com/rubenvitt/x.apk",
        )
        for (url in ok) assertTrue(Updateentscheidung.isErlaubterDownload(url), url)
        val nein = listOf(
            "http://github.com/rubenvitt/lifeline-hub/releases/download/v1/x.apk",
            "https://github.com.evil.example/rubenvitt/x.apk",
            "https://evil.example/github.com/x.apk",
            "https://github.com@evil.example/x.apk",
            "https://user@github.com/x.apk",
            "https://github.com:8443/x.apk",
            "https://githubusercontent.com/x",
            "ftp://github.com/x",
            "file:///sdcard/x.apk",
            "",
            "kein link",
        )
        for (url in nein) assertFalse(Updateentscheidung.isErlaubterDownload(url), url)
        assertEquals(
            setOf("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"),
            Updateentscheidung.ERLAUBTE_HOSTS,
        )
    }

    @Test
    fun `Prüfsumme ist 64 Hexziffern`() {
        assertTrue(Updateentscheidung.isSha256(sha))
        assertTrue(Updateentscheidung.isSha256("0123456789ABCDEFabcdef0123456789ABCDEFabcdef0123456789ABCDEFabcd"))
        for (text in listOf("", "abc", "a".repeat(63), "a".repeat(65), "g".repeat(64), " " + "a".repeat(63))) {
            assertFalse(Updateentscheidung.isSha256(text), text)
        }
    }

    // Prüfabstand

    @Test
    fun `Prüfung höchstens alle vier Stunden`() {
        val stunde = 60 * 60 * 1000L
        assertEquals(4 * stunde, Updateentscheidung.PRUEF_ABSTAND_MS)
        val jetzt = 1_000 * stunde
        assertTrue(Updateentscheidung.isFaellig(null, jetzt))
        assertFalse(Updateentscheidung.isFaellig(jetzt, jetzt))
        assertFalse(Updateentscheidung.isFaellig(jetzt - 4 * stunde + 1, jetzt))
        assertTrue(Updateentscheidung.isFaellig(jetzt - 4 * stunde, jetzt))
        // Eine zurückgestellte Uhr sperrt die Prüfung nicht auf Stunden.
        assertTrue(Updateentscheidung.isFaellig(jetzt + stunde, jetzt))
    }

    // Installzeitpunkt

    private val minute = 60 * 1000L
    private val jetzt = 10_000 * minute

    @Test
    fun `im Vordergrund installiert der Updater nie`() {
        for (rueckfrage in listOf(false, true)) {
            assertEquals(
                Installzeitpunkt.Weg.HINWEIS,
                Installzeitpunkt.decide(Installzeitpunkt.Lage.VORDERGRUND, null, jetzt, rueckfrage),
            )
            assertEquals(
                Installzeitpunkt.Weg.HINWEIS,
                Installzeitpunkt.decide(Installzeitpunkt.Lage.VORDERGRUND, jetzt - 60 * minute, jetzt, rueckfrage),
            )
        }
    }

    @Test
    fun `beim Start vor der Oberfläche wird installiert`() {
        for (rueckfrage in listOf(false, true)) {
            assertEquals(
                Installzeitpunkt.Weg.INSTALLIEREN,
                Installzeitpunkt.decide(Installzeitpunkt.Lage.START_VOR_OBERFLAECHE, null, jetzt, rueckfrage),
            )
        }
    }

    @Test
    fun `im Hintergrund erst nach 15 Minuten und nur ohne Rückfrage`() {
        assertEquals(15 * minute, Updateentscheidung.HINTERGRUND_MS)
        val h = Installzeitpunkt.Lage.HINTERGRUND
        assertEquals(Installzeitpunkt.Weg.WARTEN, Installzeitpunkt.decide(h, jetzt - 14 * minute, jetzt, false))
        assertEquals(Installzeitpunkt.Weg.WARTEN, Installzeitpunkt.decide(h, jetzt - 14 * minute, jetzt, true))
        assertEquals(Installzeitpunkt.Weg.INSTALLIEREN, Installzeitpunkt.decide(h, jetzt - 15 * minute, jetzt, false))
        assertEquals(Installzeitpunkt.Weg.HINWEIS, Installzeitpunkt.decide(h, jetzt - 15 * minute, jetzt, true))
        // Ohne Zeitpunkt des Wechsels in den Hintergrund wird nicht installiert.
        assertEquals(Installzeitpunkt.Weg.WARTEN, Installzeitpunkt.decide(h, null, jetzt, false))
    }

    @Test
    fun `die Updatestände sind benannt`() {
        assertEquals(
            listOf("KEINS", "LAEDT", "BEREIT", "INSTALLIERT_GLEICH", "BLOCKIERT", "ERLAUBNIS_FEHLT", "FEHLER"),
            Updatestand.entries.map { it.name },
        )
    }

    // Semver

    @Test
    fun `Semver ordnet nach Vorrang`() {
        val geordnet = listOf(
            "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2",
            "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0", "10.0.0",
        )
        for (i in geordnet.indices) for (j in geordnet.indices) {
            val soll = i.compareTo(j).coerceIn(-1, 1)
            assertEquals(soll, Semver.compare(geordnet[i], geordnet[j])?.coerceIn(-1, 1), "${geordnet[i]} ? ${geordnet[j]}")
        }
        assertEquals(1, Semver.compare("1.0.0-alpha.196", "1.0.0-alpha.9"))
        assertEquals(1, Semver.compare("1.0.0-alpha.1", "1.0.0-alpha"))
    }

    @Test
    fun `Semver ignoriert Build-Metadaten`() {
        assertEquals(0, Semver.compare("1.0.0+a", "1.0.0+b"))
        assertEquals(0, Semver.compare("1.0.0-alpha.1+x", "1.0.0-alpha.1"))
    }

    @Test
    fun `Semver lehnt Ungültiges ab`() {
        for (version in listOf("", "1", "1.0", "1.0.0.0", "01.0.0", "1.0.0-", "1.0.0-01", "1.0.0-a..b", "v1.0.0", "1.0.0-ä", "a.b.c")) {
            assertNull(Semver.compare(version, "1.0.0"), version)
            assertNull(Semver.compare("1.0.0", version), version)
        }
    }
}
