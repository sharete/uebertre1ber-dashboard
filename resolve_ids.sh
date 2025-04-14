#!/bin/bash

API_KEY="$FACEIT_API_KEY"
LINKS_FILE="faceit_links.txt"
OUTPUT_FILE="players.txt"

> "$OUTPUT_FILE"

while read -r line; do
  nickname=$(echo "$line" | awk -F'/players/' '{print $2}' | cut -d'?' -f1)
  response=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "https://open.faceit.com/data/v4/players?nickname=$nickname")

  player_id=$(echo "$response" | jq -r '.player_id')
  current_nickname=$(echo "$response" | jq -r '.nickname')

  if [[ "$player_id" == "null" || -z "$player_id" ]]; then
    echo "$nickname: ❌ Spieler nicht gefunden"
  else
    echo "$player_id # $current_nickname" >> "$OUTPUT_FILE"
    echo "$current_nickname: ✅ ID gespeichert"
  fi
done < "$LINKS_FILE"
