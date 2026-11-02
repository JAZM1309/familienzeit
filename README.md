# Familienzeit – Version 1.0 (Grundgerüst)

Installierbare Familien-PWA für maximal vier Mitglieder. Geplant als gemeinsamer Ort für Einkaufsliste, Essenswunschliste und Familientermine.

## Enthalten
- Responsive Oberfläche für Smartphone und Desktop
- PWA-Manifest, App-Icon und Service Worker
- Anmeldeoberfläche mit Firebase Authentication vorbereitet
- Bereiche: Übersicht, Einkaufsliste, Essenswünsche, Termine und Familie
- Lokaler Vorschau-Modus zum Testen der Oberfläche ohne Firebase
- Firebase-Konfigurationsplatzhalter
- Firestore-Sicherheitsregeln als Ausgangspunkt

## Wichtige Funktionsgrenzen dieser ersten ZIP
Diese ZIP ist ein lauffähiges Frontend-Grundgerüst, aber noch keine fertig produktive Mehrbenutzer-App. Der lokale Vorschau-Modus speichert Daten nur im Arbeitsspeicher des Browsers. Für echte gemeinsame Daten müssen Firebase eingerichtet und die serverseitige Einladungs-/Familienanlage ergänzt werden. Die Schaltfläche „Einladung vorbereiten“ ist bis dahin bewusst nur ein Hinweis und versendet keine Einladung.

## Architektur und Kosten
- Hosting und Quellcode: GitHub Pages / GitHub Repository
- Backend: Firebase Spark (kostenloser Tarif)
- Keine kostenpflichtigen Dienste oder automatische Upgrades
- Firebase-Konfiguration bleibt in `app.js` austauschbar
- Keine Cloud Functions in dieser Basisversion; dadurch werden keine kostenpflichtigen Functions vorausgesetzt

## Einrichtung
1. Repository `familienzeit` öffnen.
2. Inhalt dieser ZIP im Hauptverzeichnis hochladen (Dateien und Ordner, nicht den äußeren ZIP-Ordner).
3. In Firebase ein Projekt anlegen bzw. das vorgesehene Projekt verwenden.
4. Authentication → E-Mail/Passwort aktivieren.
5. Firestore Database einrichten und `firestore.rules` veröffentlichen.
6. Web-App in Firebase registrieren und die Konfigurationswerte in `app.js` eintragen.
7. GitHub Repository → Settings → Pages → Deploy from a branch → `main` / `root` auswählen.

## Noch vor dem echten Familienbetrieb erforderlich
- Sichere Erst-Familienanlage und Einladungscodes mit Ablaufdatum und Einmalverwendung
- Mitgliedsrollen (Administration / Erwachsene / Kinder) und Limit von vier Mitgliedern serverseitig erzwingen
- Kindertermine so absichern, dass sie nur für berechtigte Personen sichtbar sind
- Datenschutz-/Löschkonzept und Regeln für Familienwechsel
- Firebase-Regeln anhand der finalen Datenstruktur testen

## Datenmodell – vorgesehener Zielzustand
- `families/{familyId}` – Familien-Stammdaten
- `families/{familyId}/members/{uid}` – Rollen und Mitgliedschaft
- `families/{familyId}/shopping/{itemId}` – gemeinsame Einkäufe
- `families/{familyId}/meals/{itemId}` – Essenswünsche
- `families/{familyId}/events/{eventId}` – Familientermine; private Kindertermine erhalten zusätzliche Zugriffsbeschränkung
- `users/{uid}/memberships/{membershipId}` – Zuordnung des Kontos zu einer Familie
- `invites/{inviteId}` – Einladungen, ausschließlich serverseitig verwaltet

## Kalender-Synchronisierung
Optional und zunächst nur in eine Richtung geplant: externer Kalender → Familienzeit. Jedes Mitglied verwaltet eigene Kalenderverbindungen. In Version 1.0 ist diese Anbindung noch nicht implementiert.
