#!/usr/bin/env bash
#
# container-watchdog.sh — Auto-remediación acotada para contenedores de EduTrack.
#
# Solo actúa sobre los servicios de WATCHDOG_SERVICES (por defecto web, auth y
# reverse-proxy). PostgreSQL y Keycloak quedan FUERA a propósito: reiniciarlos
# por un healthcheck transitorio es más riesgoso que esperar a una persona.
#
# Reglas:
#   - Reinicia solo si el healthcheck está "unhealthy" N veces seguidas.
#   - Máximo WATCHDOG_MAX_RESTARTS por ventana (default 3 por hora).
#   - Cooldown entre reinicios (default 5 minutos).
#   - Si alcanza el tope, deja de reiniciar y expone la métrica
#     edutrack_container_watchdog_cap_reached para que Grafana avise.
#   - WATCHDOG_DRY_RUN=1 registra lo que haría sin reiniciar.
#
# Pensado para correr como oneshot desde un systemd timer cada 30-60 s.
# No requiere el socket de Docker expuesto a ningún contenedor: corre en el host.
#
# Estado:      /var/lib/edutrack-watchdog/state
# Métricas:    /var/lib/edutrack-watchdog/textfile/edutrack_watchdog.prom
#              (las lee node-exporter con --collector.textfile.directory)
#
# Uso manual:
#   WATCHDOG_DRY_RUN=1 ./scripts/container-watchdog.sh
#   EDUTRACK_DIR=/root/edutrack ./scripts/container-watchdog.sh

set -euo pipefail

EDUTRACK_DIR="${EDUTRACK_DIR:-/root/edutrack}"
EDUTRACK_COMPOSE_FILES="${EDUTRACK_COMPOSE_FILES:-docker-compose.cloud.yml docker-compose.proxy.yml docker-compose.close-ports.prod.yml}"
WATCHDOG_SERVICES="${WATCHDOG_SERVICES:-web auth reverse-proxy}"
WATCHDOG_CONSECUTIVE="${WATCHDOG_CONSECUTIVE:-3}"
WATCHDOG_MAX_RESTARTS="${WATCHDOG_MAX_RESTARTS:-3}"
WATCHDOG_WINDOW_SECONDS="${WATCHDOG_WINDOW_SECONDS:-3600}"
WATCHDOG_COOLDOWN_SECONDS="${WATCHDOG_COOLDOWN_SECONDS:-300}"
WATCHDOG_DRY_RUN="${WATCHDOG_DRY_RUN:-0}"
WATCHDOG_STATE_DIR="${WATCHDOG_STATE_DIR:-/var/lib/edutrack-watchdog/state}"
WATCHDOG_TEXTFILE_DIR="${WATCHDOG_TEXTFILE_DIR:-/var/lib/edutrack-watchdog/textfile}"

read -r -a SERVICES <<< "$WATCHDOG_SERVICES"
read -r -a COMPOSE_FILES <<< "$EDUTRACK_COMPOSE_FILES"

COMPOSE_ARGS=()
for f in "${COMPOSE_FILES[@]}"; do
  COMPOSE_ARGS+=(-f "$EDUTRACK_DIR/$f")
done

now() { date +%s; }

log() {
  printf '%s %s\n' "$(date -Is)" "$*" >&2
}

die() {
  log "FATAL: $*"
  exit 1
}

state_file() {
  printf '%s/%s/%s' "$WATCHDOG_STATE_DIR" "$1" "$2"
}

read_int() {
  local file value
  file="$(state_file "$1" "$2")"
  if [[ -f "$file" ]]; then
    value="$(cat "$file" 2>/dev/null || echo 0)"
  else
    value=0
  fi
  [[ "$value" =~ ^[0-9]+$ ]] || value=0
  printf '%s' "$value"
}

write_int() {
  local dir file
  dir="$WATCHDOG_STATE_DIR/$1"
  mkdir -p "$dir"
  file="$dir/$2"
  printf '%s\n' "$3" > "$file"
}

prune_history() {
  local svc="$1" current="$2" file cutoff
  file="$(state_file "$svc" history)"
  [[ -f "$file" ]] || { : > "$file"; return 0; }
  cutoff=$(( current - WATCHDOG_WINDOW_SECONDS ))
  awk -v cutoff="$cutoff" '$1 + 0 >= cutoff' "$file" > "$file.tmp"
  mv "$file.tmp" "$file"
}

count_history() {
  local file
  file="$(state_file "$1" history)"
  if [[ -f "$file" ]]; then
    wc -l < "$file" | tr -d ' '
  else
    echo 0
  fi
}

container_id() {
  local svc="$1" out
  if ! out="$(cd "$EDUTRACK_DIR" && docker compose "${COMPOSE_ARGS[@]}" ps -q "$svc" 2>/dev/null)"; then
    log "COMPOSE_ERROR service=$svc dir=$EDUTRACK_DIR"
    return 0
  fi
  head -n1 <<< "$out"
}

process_service() {
  local svc="$1" current="$2" cid health name restarting consec in_window
  local last_restart cap

  cid="$(container_id "$svc")"
  if [[ -z "$cid" ]]; then
    log "NO_CONTAINER service=$svc"
    return 0
  fi

  name="$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null || echo "$svc")"
  restarting="$(docker inspect -f '{{.State.Restarting}}' "$cid" 2>/dev/null || echo false)"
  if [[ "$restarting" == "true" ]]; then
    log "RESTARTING service=$svc container=$name (Docker ya lo esta reiniciando)"
    return 0
  fi

  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo unknown)"

  case "$health" in
    healthy|starting)
      cap="$(read_int "$svc" cap_reached)"
      if [[ "$cap" != "0" ]]; then
        write_int "$svc" cap_reached 0
        log "RECOVERED service=$svc cap_reached=0"
      fi
      write_int "$svc" consecutive 0
      ;;
    unhealthy)
      consec=$(( $(read_int "$svc" consecutive) + 1 ))
      write_int "$svc" consecutive "$consec"
      write_int "$svc" unhealthy_total $(( $(read_int "$svc" unhealthy_total) + 1 ))

      if (( consec < WATCHDOG_CONSECUTIVE )); then
        log "UNHEALTHY service=$svc count=$consec/$WATCHDOG_CONSECUTIVE container=$name"
        return 0
      fi

      prune_history "$svc" "$current"
      in_window="$(count_history "$svc")"
      if (( in_window >= WATCHDOG_MAX_RESTARTS )); then
        write_int "$svc" cap_reached 1
        log "CAP_REACHED service=$svc restarts=${in_window}/${WATCHDOG_MAX_RESTARTS} window=${WATCHDOG_WINDOW_SECONDS}s"
        return 0
      fi

      last_restart="$(read_int "$svc" last_restart)"
      if (( last_restart > 0 && current - last_restart < WATCHDOG_COOLDOWN_SECONDS )); then
        log "COOLDOWN service=$svc remaining=$(( WATCHDOG_COOLDOWN_SECONDS - (current - last_restart) ))s"
        return 0
      fi

      if [[ "$WATCHDOG_DRY_RUN" == "1" ]]; then
        log "DRY_RUN would_restart service=$svc count=$consec container=$name"
        # Reiniciar el contador evita que crezca sin limite durante el dry-run.
        write_int "$svc" consecutive 0
        return 0
      fi

      if docker restart "$cid" >/dev/null 2>&1; then
        printf '%s\n' "$current" >> "$(state_file "$svc" history)"
        write_int "$svc" last_restart "$current"
        write_int "$svc" restarts_total $(( $(read_int "$svc" restarts_total) + 1 ))
        write_int "$svc" consecutive 0
        write_int "$svc" cap_reached 0
        log "RESTART service=$svc container=$name result=ok consecutive=$consec"
      else
        log "RESTART service=$svc container=$name result=failed"
      fi
      ;;
    none)
      log "NO_HEALTHCHECK service=$svc container=$name (no se puede vigilar)"
      ;;
    *)
      log "UNKNOWN_HEALTH service=$svc status=$health"
      ;;
  esac
}

write_textfile() {
  local current="$1" tmp="$WATCHDOG_TEXTFILE_DIR/.edutrack_watchdog.prom.$$" svc
  {
    echo "# HELP edutrack_container_restarts_total Reinicios ejecutados por el watchdog."
    echo "# TYPE edutrack_container_restarts_total counter"
    echo "# HELP edutrack_container_unhealthy_total Chequeos unhealthy observados por el watchdog."
    echo "# TYPE edutrack_container_unhealthy_total counter"
    echo "# HELP edutrack_container_watchdog_cap_reached 1 si el watchdog dejo de reiniciar por tope."
    echo "# TYPE edutrack_container_watchdog_cap_reached gauge"
    echo "# HELP edutrack_container_watchdog_last_restart_timestamp_seconds Ultimo reinicio ejecutado por el watchdog."
    echo "# TYPE edutrack_container_watchdog_last_restart_timestamp_seconds gauge"
    echo "# HELP edutrack_container_watchdog_check_timestamp_seconds Ultimo chequeo por servicio."
    echo "# TYPE edutrack_container_watchdog_check_timestamp_seconds gauge"
    echo "# HELP edutrack_container_watchdog_last_run_timestamp_seconds Ultima corrida completa del watchdog."
    echo "# TYPE edutrack_container_watchdog_last_run_timestamp_seconds gauge"

    for svc in "${SERVICES[@]}"; do
      echo "edutrack_container_restarts_total{service=\"$svc\"} $(read_int "$svc" restarts_total)"
      echo "edutrack_container_unhealthy_total{service=\"$svc\"} $(read_int "$svc" unhealthy_total)"
      echo "edutrack_container_watchdog_cap_reached{service=\"$svc\"} $(read_int "$svc" cap_reached)"
      echo "edutrack_container_watchdog_last_restart_timestamp_seconds{service=\"$svc\"} $(read_int "$svc" last_restart)"
      echo "edutrack_container_watchdog_check_timestamp_seconds{service=\"$svc\"} $current"
    done
    echo "edutrack_container_watchdog_last_run_timestamp_seconds $current"
  } > "$tmp"
  chmod 0644 "$tmp"
  mv "$tmp" "$WATCHDOG_TEXTFILE_DIR/edutrack_watchdog.prom"
}

main() {
  local current svc

  command -v docker >/dev/null 2>&1 || die "docker no esta disponible"
  [[ -d "$EDUTRACK_DIR" ]] || die "no existe EDUTRACK_DIR=$EDUTRACK_DIR"
  (( ${#SERVICES[@]} > 0 )) || die "WATCHDOG_SERVICES esta vacio"

  mkdir -p "$WATCHDOG_STATE_DIR" "$WATCHDOG_TEXTFILE_DIR" || die "no se pudo crear el directorio de estado"
  [[ -w "$WATCHDOG_STATE_DIR" ]] || die "sin permiso de escritura en $WATCHDOG_STATE_DIR"
  [[ -w "$WATCHDOG_TEXTFILE_DIR" ]] || die "sin permiso de escritura en $WATCHDOG_TEXTFILE_DIR"

  exec 9>"$WATCHDOG_STATE_DIR/.lock"
  if ! flock -n 9; then
    log "SKIP previous_run_in_progress"
    exit 0
  fi

  current="$(now)"
  for svc in "${SERVICES[@]}"; do
    process_service "$svc" "$current"
  done

  write_textfile "$current"
  log "RUN_OK services=${SERVICES[*]} dry_run=$WATCHDOG_DRY_RUN"
}

main "$@"
