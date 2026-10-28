# Puls

[GitHub: Witzelfitz/puls-feedback](https://github.com/Witzelfitz/puls-feedback)

Live abstimmen. Node.js 24, SQLite und Socket.IO. Eine npm-Abhängigkeit, kein Build-Schritt.

## Lokal

```sh
git clone https://github.com/Witzelfitz/puls-feedback.git
cd puls-feedback
npm ci
npm start
```

http://localhost:3000 öffnen. Die Moderations-PIN steht im Terminal. Unter `/host` anmelden, eine Frage mit zwei bis sechs Antworten erstellen und den Teilnehmerlink teilen. `/r/CODE` ist die Beameransicht, `/p/CODE` die Teilnahmeansicht.

Eine Stimme pro Browser. Eine Änderung der Wahl ersetzt die alte Stimme. Private Fenster oder andere Geräte zählen separat. Die App benötigt keine Namen. Das ist eine einfache Veranstaltungsabstimmung, keine verifizierte Wahl.

## Coolify

- Öffentliches GitHub-Repo mit diesem Ordner als Repo-Root.
- Build Pack **Dockerfile**, Branch **main**, interner Port **3000**.
- Laufzeitvariable **ADMIN_PIN** mit eigener PIN setzen. Keine echte PIN ins Repo schreiben.
- **DATA_DIR=/app/data** und persistentes Volume auf **/app/data**. Der Benutzer `node` im Container muss dort schreiben dürfen.
- Eine Instanz. SQLite braucht hier weder eine eigene Datenbankressource noch einen Datenbankport.
- Eigene HTTPS-Domain setzen. Coolifys Proxy führt auch die Socket.IO-Verbindung über denselben Port.
- Healthcheck: **GET /health**. Das Dockerfile enthält bereits einen Check.

Die SQLite-Datei, WAL-Dateien und lokal erzeugte PIN liegen im Datenordner. Der gesamte Ordner muss ein Redeployment überleben. Ohne gesetztes ADMIN_PIN erzeugt die App einmalig eine PIN und speichert sie in diesem Ordner. Moderationssitzungen gelten bis zum Serverneustart, danach erneut anmelden.

## Was liegt wo?

- `server.mjs`: HTTP-Routen, SQLite und Socket.IO-Events.
- `public/index.html`: Grundgerüst.
- `public/app.js`: Moderation, Abstimmung und Live-Balken.
- `public/style.css`: Gestaltung.
- `Dockerfile`: Container für Coolify.
- `data/`: laufende Daten, in Git und Docker-Build ausgeschlossen.

Socket.IO-Events: `poll:join`, `poll:vote`, `poll:update`, `poll:presence`. Beim Wiederverbinden lädt der Browser den aktuellen Stand erneut aus SQLite.

## Weiterentwicklung am Abend

Als zweite Version einen QR-Code auf der Beameransicht ergänzen. Danach Commit, Push, Redeployment und prüfen, ob die vorherigen Stimmen erhalten bleiben.

Die App ist für das Deployment mit Coolify vorbereitet. Die Workshop-Checkliste liegt nur im lokalen Kursordner neben diesem Projekt und ist nicht Teil des GitHub-Repos oder des Docker-Images.
