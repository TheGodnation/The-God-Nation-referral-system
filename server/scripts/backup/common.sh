#!/usr/bin/env bash
# Shared by the backup scripts.

# The app's DATABASE_URL can be pasted as it is. Two things in it get in the
# way of pg_dump / psql, so they are fixed here:
#  - Prisma-only parameters (schema, pgbouncer, connection_limit, …) make
#    libpq refuse the address;
#  - a Neon "pooler" address is swapped for the direct one (a dump cannot go
#    through the pooler), the same thing the app does for its migrations.
clean_url() {
  local url="$1" base query kept="" part
  url="$(printf '%s' "$url" | sed -E 's/-pooler\././')"
  base="${url%%\?*}"
  query=""
  case "$url" in *\?*) query="${url#*\?}" ;; esac
  local IFS='&'
  for part in $query; do
    case "$part" in
      schema=* | pgbouncer=* | connection_limit=* | pool_timeout=* | socket_timeout=* | "") ;;
      *) kept="${kept:+$kept&}$part" ;;
    esac
  done
  printf '%s' "${base}${kept:+?$kept}"
}
