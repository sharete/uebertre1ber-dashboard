#!/bin/bash

API_KEY="$FACEIT_API_KEY"
INPUT_FILE="players.txt"
TMP_FILE="elo_output.tmp"

> "$TMP_FILE"

while read -r line; do
  player_id=$(echo "$line" | awk '{print $1}')
  nickname=$(echo "$line" | cut -d'#' -f2 | xargs)

  # Spieler-Daten abrufen
  player_data=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "https://open.faceit.com/data/v4/players/$player_id")

  elo=$(echo "$player_data" | jq -r '.games.cs2.faceit_elo')

  # Letztes Match-Datum abrufen
  matches=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "https://open.faceit.com/data/v4/players/$player_id/history?game=cs2&limit=1")

  last_match_timestamp=$(echo "$matches" | jq -r '.items[0].started_at')

  if [[ "$last_match_timestamp" != "null" && "$last_match_timestamp" != "" ]]; then
    last_match_date=$(date -d @"$last_match_timestamp" "+%Y-%m-%d %H:%M")
  else
    last_match_date="—"
  fi

  # Nur wenn ELO vorhanden, zur temporären Datei hinzufügen
  if [[ "$elo" != "null" && -n "$elo" ]]; then
    echo "$elo@@@$nickname: $elo ELO | Letztes Match: $last_match_date" >> "$TMP_FILE"
  fi
done < "$INPUT_FILE"

# Sortierte finale Ausgabe
echo "📊 Sortierte Ausgabe nach ELO:"
echo "------------------------------"
sort -nr "$TMP_FILE" | awk -F'@@@' '{print $2}'


OUTPUT_HTML="index.html"

{
  echo '<!DOCTYPE HTML>'
  echo '<html>'
  echo '<head>'
  echo '  <title>uebertre1ber ELO Dashboard</title>'
  echo '  <meta charset="utf-8" />'
  echo '  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />'
  echo '  <link rel="stylesheet" href="https://html5up.net/uploads/demos/hyperspace/assets/css/main.css" />'
  echo '  <style>body{padding:2em} h2{margin-top:1em}</style>'
  echo '</head>'
  echo '<body>'
  echo '<header id="header"><a href="#" class="title">uebertre1ber Dashboard</a></header>'
  echo '<section id="main" class="wrapper">'
  echo '  <div class="inner">'
  echo '    <h2>uebertre1ber ELO Leaderboard</h2>'
  echo '    <div class="table-wrapper">'
  echo '      <table class="alt">'
  echo '        <thead><tr><th>Nickname</th><th>ELO</th><th>Letztes Match</th></tr></thead>'
  echo '        <tbody>'
  sort -nr "$TMP_FILE" | while IFS='@@@' read -r elo raw; do
  nickname=$(echo "$raw" | cut -d':' -f1 | sed 's/^@*//')
  elo_value=$(echo "$raw" | grep -oP '[0-9]+(?= ELO)')
  match_date=$(echo "$raw" | grep -oP 'Letztes Match: .*' | cut -d':' -f2- | xargs)
  echo "<tr><td>$nickname</td><td>$elo_value</td><td>$match_date</td></tr>"
  done
  echo '        </tbody>'
  echo '      </table>'
  echo '    </div>'
  echo '  </div>'
  echo '</section>'
  echo '<footer id="footer"><div class="inner"><ul class="menu"><li>&copy; uebertre1ber Dashboard</li><li>Made by: <a href="https://www.faceit.com/de/players/sha89?nickname=sha89">Sharam</a></li></ul></div></footer>'
  echo '</body>'
  echo '</html>'
} > "$OUTPUT_HTML"

rm "$TMP_FILE"
