# ItemCase Server – Einrichtung

Node.js/Express-Backend für ItemCase (Community-Katalog, Konten, Sammlungen, Bilder, Realtime). Läuft gegen eine MySQL-8-Datenbank.

## Voraussetzungen

- Node.js ≥ 20 (getestet mit 24)
- MySQL 8 (eigene, leere Datenbank + Benutzer mit vollen Rechten darauf)
- Ein SMTP-Postfach für Bestätigungs- und Passwort-Reset-Mails
- Ein persistentes Verzeichnis für hochgeladene Bilder (wird zusammen mit der Datenbank gesichert)
- Für den öffentlichen Betrieb: HTTPS-Reverse-Proxy (nginx, Caddy, Plesk o. ä.) vor dem Node-Prozess

## Installation

```bash
cd server
npm install --omit=dev
cp .env.example .env      # dann .env ausfüllen (siehe unten)
npm run db:check          # prüft die Datenbankverbindung
npm run db:migrate        # legt das Schema an / aktualisiert es (idempotent, beliebig oft ausführbar)
npm start                 # startet auf PORT (Standard 5100)
```

Beim Start bricht der Server bewusst ab, wenn `MYSQL_URL` oder `JWT_SECRET` fehlen, `JWT_SECRET` kürzer als 32 Bytes ist oder die Datenbank nicht erreichbar ist.

## Konfiguration (`.env`)

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `MYSQL_URL` | ja | `mysql://user:passwort@host:3306/datenbank` – Sonderzeichen im Passwort URL-kodieren (`!` → `%21`, `$` → `%24`) |
| `JWT_SECRET` | ja | Mind. 32 Bytes. Erzeugen: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Wird auch zum Signieren privater Bild-Links genutzt – Änderung loggt alle Nutzer aus. |
| `PORT` / `HOST` | nein | Standard `5100` / `0.0.0.0` |
| `NODE_ENV` | nein | `production` im Live-Betrieb |
| `PUBLIC_BASE_URL` | für Produktion | Öffentliche HTTPS-Adresse des Servers **ohne** `/api`, z. B. `https://api.example.com`. Wird für Links in E-Mails (Bestätigung, Passwort-Reset) und Bild-URLs verwendet. Ohne Angabe wird der Host der jeweiligen Anfrage genutzt. |
| `TRUST_PROXY` | hinter Proxy | `1`, wenn genau ein Reverse-Proxy vorgeschaltet ist (sonst sehen Rate-Limits nur die Proxy-IP). |
| `CLIENT_ORIGIN` | nein | Komma-getrennte erlaubte Browser-Origins (für den Web-Client). Die Desktop-App sendet keinen Origin. `*` erlaubt alle. |
| `UPLOADS_DIR` | empfohlen | Absoluter Pfad für Bild-Uploads (Standard: `server/uploads`). Muss persistent sein und mitgesichert werden. |
| `MAX_IMAGE_BYTES` | nein | Max. Größe pro Bild, Standard 6 MiB |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | ja für Registrierung | Ohne diese Werte startet der Server, verschickt aber keine Mails – Registrierungs-Bestätigung und „Passwort vergessen“ funktionieren dann nicht. `SMTP_SECURE=false` für Port 587 (STARTTLS), `true` für 465. |
| `CLIENT_APP_SECRET` | nein | Komma-getrennte Client-Kennungen, die `/api/*` im Header `X-ItemCase-Client` mitschicken muss (`itemcase-desktop-v1,itemcase-mobile-v1`). **Kein echter Schutz**, da die Kennung in der App steckt – filtert nur Bots/Scanner. Leer lassen = Filter aus. |

**Wichtig:** `.env` enthält Zugangsdaten und gehört nie ins Git.

## Betrieb

- **Prozess dauerhaft laufen lassen:** z. B. mit `pm2` (`pm2 start server.js --name itemcase`), systemd oder dem Node-Manager des Hosters. Bei Änderung an `.env` oder Code neu starten.
- **Reverse-Proxy:** HTTPS terminieren und auf `http://127.0.0.1:5100` weiterleiten. **Keine WebSockets nötig:** Live-Updates laufen per normalem HTTP-Polling (`GET /api/realtime/poll`, alle ~10 s), es funktioniert also auch auf Webhosting-Paketen. Der Event-Puffer liegt im Arbeitsspeicher – daher genau **einen** Node-Prozess betreiben. Dazu `TRUST_PROXY=1` und `PUBLIC_BASE_URL` setzen.
- **Uploads:** Bilder liegen als Dateien unter `UPLOADS_DIR`. Private Bilder werden nur über zeitlich begrenzte, signierte URLs ausgeliefert (gültig ca. 1 Stunde).
- **Backups:** Datenbank **und** `UPLOADS_DIR` gemeinsam sichern.
- **Updates:** neuen Code einspielen → `npm install --omit=dev` → `npm run db:migrate` → Prozess neu starten.

## Erste Schritte nach der Installation

1. Über die App ein Konto registrieren (Bestätigungsmail muss ankommen).
2. Dieses Konto zum Admin machen (einmalig direkt in der DB, danach geht es über das Admin-Panel):
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'deine@mail.de';
   ```
3. Im Admin-Panel unter „Nutzer“ können weitere Konten zu **Moderator** (nur Freigaben, Korrekturen, Duplikate) oder **Admin** gemacht werden.

## Rollen

| Rolle | Rechte |
|---|---|
| `user` | normale Nutzung |
| `moderator` | Katalog-Freigaben, Korrekturvorschläge, Duplikate (eigenes Panel, blau) |
| `admin` | alles, inkl. Nutzerverwaltung, Meldungen, Feedback, XP, Tarife, Händler |

## Nützliche Skripte

| Befehl | Zweck |
|---|---|
| `npm run db:check` | Datenbankverbindung testen |
| `npm run db:migrate` | Schema anlegen/aktualisieren |
| `npm run test:xp-invariants` | Konsistenzprüfung des XP-Systems (gegen die konfigurierte DB) |
| `npm run test:image-security` | Prüfung der Bild-Verarbeitung |

## Desktop-App auf den Server zeigen lassen

Die Server-Adresse ist in der App fest hinterlegt: `electron/main.js` (`DEFAULT_API_ORIGIN`) für die Desktop-App bzw. `VITE_API_BASE_URL` für den Web-/Mobile-Client (`src/mobile-api.js`). Vor dem Bauen eines Installers für externe Tester auf die öffentliche HTTPS-Adresse umstellen (aktuell steht dort eine lokale LAN-Adresse).
