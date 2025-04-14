#!/bin/bash

# API Key aus Umgebungsvariable
API_KEY="$FACEIT_API_KEY"

# Liste der Nicknames
NICKNAMES=("sha89" "rolanHEHE" "SaN" "SEYED" "Vik")

echo "FACEIT ELO Abfrage:"
echo "-------------------"

for nickname in "${NICKNAMES[@]}"; do
  # API-Call zum Abrufen der Spielerinfos
  player_data=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "https://open.faceit.com/data/v4/players?nickname=$nickname")

  # player_id extrahieren
  player_id=$(echo "$player_data" | jq -r '.player_id')

  # Fehlerbehandlung für ungültige Spieler
  if [[ "$player_id" == "null" || -z "$player_id" ]]; then
    echo "$nickname: ❌ Spieler nicht gefunden"
    continue
  fi

  # ELO aus dem cs2-Teil direkt extrahieren
  elo=$(echo "$player_data" | jq -r '.games.cs2.faceit_elo')

  # Ausgabe je nach Ergebnis
  if [[ "$elo" == "null" || -z "$elo" ]]; then
    echo "$nickname ($player_id): ⚠️ Keine CS2-Stats gefunden"
  else
    echo "$nickname ($player_id): $elo ELO"
  fi
done
