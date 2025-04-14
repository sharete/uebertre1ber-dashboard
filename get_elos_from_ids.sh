#!/bin/bash

API_KEY="$FACEIT_API_KEY"
INPUT_FILE="players.txt"
TMP_FILE="elo_output.tmp"
TABLE_BLOCK="elo-table.html"

> "$TMP_FILE"

# Daten für jeden Spieler sammeln
while read -r line; do
  player_id=$(echo "$line" | awk '{print $1}')
  nickname=$(echo "$line" | cut -d'#' -f2 | xargs)

  # Spieler-Daten abrufen
  player_data=$(curl -sL -H "Authorization: Bearer $API_KEY" \
    -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36" \
    "https://open.faceit.com/data/v4/players/$player_id")


  # DEBUG: Ausgabe der Rohantwort für den Spieler
  echo "DEBUG: Response für Spieler $player_id ($nickname): $player_data" >&2
  
  # Überprüfe, ob die Antwort mit einem "{" beginnt (Grundprüfung auf JSON)
  if [[ -z "$player_data" || "${player_data:0:1}" != "{" ]]; then
    echo "DEBUG: Ungültige JSON-Antwort für Spieler $player_id ($nickname)" >&2
    continue
  fi
  
  # ELO aus der JSON-Antwort extrahieren
  elo=$(echo "$player_data" | jq -r '.games.cs2.faceit_elo')

  # Letztes Match-Datum abrufen
  matches=$(curl -sL -H "Authorization: Bearer $API_KEY" \
    -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36" \
    "https://open.faceit.com/data/v4/players/$player_id/history?game=cs2&limit=1")


  if [[ "$last_match_timestamp" != "null" && "$last_match_timestamp" != "" ]]; then
    last_match_date=$(date -d @"$last_match_timestamp" "+%Y-%m-%d %H:%M")
  else
    last_match_date="—"
  fi

  if [[ "$elo" != "null" && -n "$elo" ]]; then
    echo "$elo@@@$nickname: $elo ELO | Letztes Match: $last_match_date" >> "$TMP_FILE"
  fi
done < "$INPUT_FILE"

# Tabellenblock in HTML generieren
{
  echo '<div class="table-wrapper">'
  echo '  <table class="alt">'
  echo '    <thead><tr><th>Nickname</th><th>ELO</th><th>Letztes Match</th></tr></thead>'
  echo '    <tbody>'
  sort -nr "$TMP_FILE" | while IFS='@@@' read -r elo raw; do
    nickname=$(echo "$raw" | cut -d':' -f1 | sed 's/^@*//')
    elo_value=$(echo "$raw" | grep -oP '[0-9]+(?= ELO)')
    match_date=$(echo "$raw" | grep -oP 'Letztes Match: .*' | cut -d':' -f2- | xargs)
    echo "      <tr><td>$nickname</td><td>$elo_value</td><td>$match_date</td></tr>"
  done
  echo '    </tbody>'
  echo '  </table>'
  echo '</div>'
} > "$TABLE_BLOCK"

# 🔁 Ersetze Platzhalter in index.html
if grep -q "<!-- INSERT_ELO_TABLE_HERE -->" index.html; then
  sed -i "/<!-- INSERT_ELO_TABLE_HERE -->/ {
    r $TABLE_BLOCK
    d
  }" index.html
fi

# Aufräumen
rm "$TMP_FILE"
rm "$TABLE_BLOCK"
