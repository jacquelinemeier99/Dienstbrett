# Dienstbrett

Handy-App fürs Team: wer ist wann im Büro, Dienstplan, Teamtermine, Auto-Reservierung und ein persönliches Kalender-Abo für Outlook, Google und iPhone.

- **Web-App zum Installieren (PWA):** Läuft auf iPhone und Android, ohne App Store. Im Browser öffnen und „Zum Home-Bildschirm“ wählen.
- **Anmeldung:** Per Code an die E-Mail-Adresse. Nur eingeladene Personen kommen hinein.
- **Daten:** Liegen in einer Supabase-Datenbank (Region Frankfurt). Wer was sehen darf, regelt die Datenbank selbst über Zugriffsregeln.

## Was wer sieht

| | Team | Praktikum (Gast) | Nur ich | Admin zusätzlich |
|---|---|---|---|---|
| Dienste aller | sehen, eigene ändern | sehen, eigene ändern | | alle ändern, Excel-Import |
| Teamtermine | sehen, eintragen | sehen | | alle löschen |
| Autos | sehen, reservieren | nur sehen | | alle stornieren |
| Eigene Termine | – | – | ✅ | – (auch Admins sehen sie nicht) |
| E-Mail-Adressen | – | – | | ✅ |

Gast-Zugänge enden automatisch am eingetragenen Tag.

---

## Einrichtung (einmalig, ca. 1 Stunde)

### 1. Supabase-Projekt anlegen
1. Auf **supabase.com** ein kostenloses Konto anlegen.
2. **New project** wählen, als Region **Central EU (Frankfurt)** einstellen und ein sicheres Datenbank-Passwort vergeben.
3. Unter **SQL Editor** den Inhalt von `supabase/migrations/0001_init.sql` einfügen und **Run** klicken.
4. Unter **Authentication → Sign In / Providers → Email**:
   - „Confirm email“ **aus**
   - „Allow new users to sign up“ **an**. Das ist nötig für den ersten Login. Ohne Einladung bekommt trotzdem niemand Zugriff.
5. Unter **Authentication → Emails → Templates** bei **Magic Link** und **Confirm signup** den Text aus `supabase/templates/magic_link.html` einsetzen. Er enthält `{{ .Token }}`, also den 6-stelligen Code.
6. Unter **Authentication → Emails → SMTP Settings** einen eigenen Mail-Versand eintragen, z. B. das SMTP eines vorhandenen Postfachs. **Wichtig:** Der eingebaute Versand von Supabase ist nur zum Testen gedacht und schickt Mails nicht an beliebige Adressen.
7. Unter **Authentication → URL Configuration** als **Site URL** die spätere Adresse der App eintragen.
8. **Dich selbst als Admin eintragen** (SQL Editor):
   ```sql
   insert into invites (email, name, ini, role) values ('deine@adresse.de', 'Jacqueline Meier', 'JM', 'admin');
   ```
9. **Automatisches Löschen alter Daten einschalten:** Unter Database → Extensions **pg_cron** aktivieren, dann:
   ```sql
   select cron.schedule('dienstbrett-aufraeumen', '17 3 * * *', 'select public.purge_old()');
   ```

### 2. Kalender-Abo-Funktion veröffentlichen
Mit der Supabase-Kommandozeile (einmalig `npx supabase login`):
```bash
npx supabase link --project-ref <projekt-id>
npx supabase functions deploy feed --no-verify-jwt
```

### 3. App bauen und veröffentlichen
1. `.env.example` nach `.env` kopieren und die Werte aus **Project Settings → API** eintragen: Project URL und der anon- bzw. publishable-Key. Der Key ist öffentlich und darf in der App stehen; geschützt wird über die Zugriffsregeln.
2. Bauen:
   ```bash
   npm install
   npm run build
   ```
3. Den Inhalt des Ordners `dist/` auf einen Webspace mit HTTPS hochladen. Gut geeignet ist ein deutscher Hoster (z. B. IONOS, Strato, Hetzner Webhosting). Die App besteht nur aus statischen Dateien und braucht keinen Server.

### 4. Team einladen
In der App unter **Ich → Team verwalten**: Name, Kürzel (wie in der Excel), E-Mail und Rolle eintragen. Die App kopiert eine fertige Nachricht mit dem Link, die du nur noch verschickst.

### 5. Team-Excel übernehmen
Unter **Ich → Team-Excel importieren** die .xlsx-Datei auswählen.
- Pro Blatt ein Monat, mit dem Monatsnamen im Blatt- oder Tabellenkopf.
- Eine Kopfzeile mit den Kürzeln der Personen, darunter eine Zeile pro Tag mit dem Tag in der ersten Spalte.
- Leere Werktage werden auf Wunsch als T eingetragen.
- `#` gilt als Frei, `LD` als LDF.
- Unbekannte Kürzel (z. B. `K`) werden **nicht** übernommen und angezeigt.
- Personen müssen sich vorher einmal angemeldet haben.

Die Datei wird nur im Browser gelesen und nirgendwohin hochgeladen.

---

## Anpassen
In der `.env`:
- `VITE_CARS` – Autos, Format: `Name|Modell|Kennzeichen;…`
- `VITE_MIN_STAFF` – ab wann ein Tag als dünn besetzt (rot) gilt
- `VITE_ORG_NAME`, `VITE_PRIVACY_CONTACT` – erscheinen im Datenschutzhinweis

Landesfeiertage lassen sich in `src/holidays.js` ergänzen. Dienstarten stehen in `supabase/functions/_shared/codes.js` und in der Prüfregel der Tabelle `shifts` (beide anpassen).

## Entwicklung und Tests
```bash
npm test                         # Logik: Import, Kürzel, Kalenderdateien
npx supabase start               # lokale Datenbank (Docker)
npm run dev                      # App unter http://localhost:5173
node tests/e2e.cjs               # Ende-zu-Ende-Test (lokale Datenbank + Mailpit)
```
