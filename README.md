# 🎯 uebertre1ber FACEIT ELO Dashboard

Ein automatisiertes FACEIT-Dashboard, das Statistiken wie ELO-Entwicklung, Match-Performance und Spieleranalysen übersichtlich darstellt. Ideal für Spielergruppen, Teams oder Streamer, die ihre Leistung langfristig verfolgen möchten.

## 🚀 Features

- 📊 **Live ELO-Tracking** (alle 30 Minuten via GitHub Actions)
- 🧠 **Statistik-Auswertung** der letzten 30 Matches:
  - Wins/Losses, Winrate
  - K/D, ADR, HS%, K/R
  - ELO +/- pro Spiel
- 🗓️ **ELO-Verlauf** als Sparkline (täglich, wöchentlich, monatlich, jährlich)
- 📁 **Match-Analyse** mit:
  - Beste/schlechteste Map
  - Durchschnittliche K/D pro Map
  - Stats gegen häufige Gegner
- 👥 **Häufigster Mitspieler** & gemeinsame Winrate
- 🧩 Modernes UI mit **Tailwind CSS** und **Glassmorphism**
- 🔍 Sortierbare Tabellen & Tooltips für jede Zahl

## 🛠️ Technologie-Stack

- 📦 `Node.js` + `node-fetch` zur Datenabfrage via [FACEIT API](https://developers.faceit.com/)
- 🧪 Datenanalyse mit JavaScript (Matchauswertung & Snapshots)
- 🎨 Frontend mit HTML + TailwindCSS
- 🔁 Automatisches Deployment mit GitHub Actions

## ⚙️ Einrichtung (lokal)

```bash
git clone https://github.com/deinname/uebertre1ber-dashboard.git
cd uebertre1ber-dashboard
npm install
node fetch-elos.js
```

> Die Datei `players.txt` enthält die zu überwachenden Spieler (FACEIT URLs). IDs werden automatisch via `resolve_ids.sh` extrahiert.

## 📄 Struktur

```
.
├── data/                  # ELO Snapshots (daily, weekly, monthly, yearly)
├── icons/                 # Icons und Visuals
├── index.template.html    # HTML-Template mit Platzhaltern
├── fetch-elos.js          # Main Script zur ELO-Analyse und HTML-Generierung
├── players.txt            # Liste der Spieler-Links
├── resolve_ids.sh         # Script zur Auflösung von player_ids
├── .github/workflows/     # GitHub Actions für automatisiertes Update
└── README.md              # Diese Datei
```

## ⏰ Automatisierte Aktualisierung

Das Dashboard aktualisiert sich automatisch alle 30 Minuten über GitHub Actions. Es wird `fetch-elos.js` ausgeführt, welches:

1. Daten über die FACEIT API abruft
2. Statistiken berechnet und Snapshots erstellt
3. Die `index.html` neu generiert und auf GitHub Pages veröffentlicht

## 📦 Geplante Features

- 🔍 Filter & Suche nach Spielern
- 📈 Interaktive Charts mit Chart.js
- 🧮 Mehr Vergleichsmetriken zwischen Spielern
- 🏷️ Ranglisten-Sektion (Top K/D, Winrate etc.)

## 📜 Lizenz

MIT – feel free to fork, verbessern oder deinen eigenen Style hinzufügen!

---

> Maintained with ❤️ by [Sharam / sharete](https://github.com/sharete)
