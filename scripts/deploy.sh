#!/usr/bin/env bash
# Ensure bash even if invoked via sh
if [ -z "${BASH_VERSION:-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi
set -euo pipefail

# Usage: Generate queries list in EPC-deploy.yaml from ./export subfolders
# It preserves existing entries in queries (e.g., ObjectLayout) and appends new folders.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VERBOSE=${VERBOSE:-1}
DEBUG=${DEBUG:-0}
if (( DEBUG )); then set -x; fi

# Parse command-line arguments
# Allow ENV to be set via environment variable, but command-line takes precedence
ENV_ARG=""
while [[ $# -gt 0 ]]; do
  case $1 in
    -e|--env|--environment)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: $1 requires an environment value (dev, uat, prod)" >&2
        exit 1
      fi
      ENV_ARG="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [-e|--env ENVIRONMENT]"
      echo "  -e, --env, --environment  Environment to use (dev, uat, prod)"
      echo "  -h, --help                 Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Use -h or --help for usage information" >&2
      exit 1
      ;;
  esac
done

# Set ENV from command-line argument if provided, otherwise use environment variable
ENV="${ENV_ARG:-${ENV:-}}"

# Validate environment if provided
if [[ -n "$ENV" ]]; then
  case "$ENV" in
    dev|uat|prod)
      # Valid environment
      ;;
    *)
      echo "ERROR: Invalid environment '$ENV'. Must be one of: dev, uat, prod" >&2
      exit 1
      ;;
  esac
fi
PINNED_VLOCITY_VERSION="${PINNED_VLOCITY_VERSION:-1.17.12}"
VLOCITY_CMD=(npx "vlocity@${PINNED_VLOCITY_VERSION}")
PREALIGN_SETTINGS=${PREALIGN_SETTINGS:-0}

# Orgs
# Load usernames from properties in this folder and optional env suffix (overridable by env)
PROP_FILES=("$SCRIPT_DIR/environments.properties" "$SCRIPT_DIR/placeholder.properties")
get_prop() {
  local key="$1"; local val=""; local file
  for file in "${PROP_FILES[@]}"; do
    [[ -f "$file" ]] || continue
    val=$(grep -E "^[[:space:]]*$key[[:space:]]*=" "$file" | tail -n 1 | sed -E "s/^[[:space:]]*$key[[:space:]]*=[[:space:]]*//" | sed -E 's/[[:space:]]+$//')
    if [[ -n "$val" ]]; then echo "$val"; return 0; fi
  done
  return 1
}
get_env_prop() {
  local base="$1"; local val=""
  if [[ -n "$ENV" ]]; then val=$(get_prop "${base}.${ENV}" || true); fi
  if [[ -z "$val" ]]; then val=$(get_prop "${base}" || true); fi
  echo "$val"
}

SOURCE_SFDX_USERNAME="${SOURCE_SFDX_USERNAME:-$(get_env_prop SOURCE_SFDX_USERNAME || true)}"
TARGET_SFDX_USERNAME="${TARGET_SFDX_USERNAME:-$(get_env_prop TARGET_SFDX_USERNAME || true)}"
#SOURCE_SFDX_USERNAME="${SOURCE_SFDX_USERNAME:-rocco.sorrentino@amplifonapac.com.mastcatdev}"
#TARGET_SFDX_USERNAME="${TARGET_SFDX_USERNAME:-rocco.sorrentino@amplifonapac.com.symporting}"
echo "Using ENV: ${ENV:-default} | SOURCE: $SOURCE_SFDX_USERNAME | TARGET: $TARGET_SFDX_USERNAME | vlocity: ${PINNED_VLOCITY_VERSION}"
if [[ "$SOURCE_SFDX_USERNAME" == "$TARGET_SFDX_USERNAME" ]]; then
  echo "ERROR: SOURCE and TARGET usernames are the same. Aborting." >&2
  exit 1
fi

# Jobs
JOB_FILE="EPC-deploy.yaml"
ENV_SUFFIX="${ENV:+.${ENV}}"
EXPORT_DIR="./export${ENV:+/$ENV}"

JOB_EXPORT_MAIN="EPC-export.yaml"
JOB_EXPORT_MERGE="EPC-export-merge.yaml"

log() { echo "$@"; }
warn() { echo "$@" >&2; }

if [[ ! -d "$EXPORT_DIR" ]]; then
  warn "Export directory not found at $EXPORT_DIR — creating"
  mkdir -p "$EXPORT_DIR"
fi

# Read existing projectPath or default
PROJECT_PATH="./deploy"
if [[ -f "$JOB_FILE" ]]; then
  # Extract first occurrence of projectPath: <value>
  existing_pp=$(sed -n 's/^projectPath:[[:space:]]*\(.*\)$/\1/p' "$JOB_FILE" | head -n1 | tr -d '\r') || true
  if [[ -n "${existing_pp:-}" ]]; then
    PROJECT_PATH="$existing_pp"
  fi
fi

# Collect existing queries to preserve (simple list items like: "  - Name")
declare -A seen
queries=()
if [[ -f "$JOB_FILE" ]]; then
  while IFS= read -r line; do
    if [[ $line =~ ^[[:space:]]*-[[:space:]](.+)$ ]]; then
      name="${BASH_REMATCH[1]}"
      name="${name%%[[:space:]]*}"
      name="${name%$'\r'}"
      if [[ -n "$name" && -z "${seen[$name]:-}" ]]; then
        queries+=("$name")
        seen["$name"]=1
      fi
    fi
  done < "$JOB_FILE"
fi

# Discover directories under ./export
mapfile -t export_dirs < <(for d in "$EXPORT_DIR"/*; do [[ -d "$d" ]] && basename "$d"; done | sort -u)

if [[ ${#export_dirs[@]} -eq 0 ]]; then
  echo "No subdirectories found in $EXPORT_DIR" >&2
  exit 1
fi

# Merge export dirs into queries, avoiding duplicates
for name in "${export_dirs[@]}"; do
  if [[ -z "${seen[$name]:-}" ]]; then
    queries+=("$name")
    seen["$name"]=1
  fi
done

# Write back EPC-deploy.yaml
{
  echo "projectPath: $EXPORT_DIR"
  echo "queries:"
  for name in "${queries[@]}"; do
    echo "  - $name"
  done
} > "$JOB_FILE"

log "Updated $JOB_FILE with ${#queries[@]} queries from $EXPORT_DIR"

# 1) Optional pre-align of settings
if (( PREALIGN_SETTINGS )); then
  log "Pre-aligning Vlocity DataPack Settings on SOURCE and TARGET"
  "${VLOCITY_CMD[@]}" -sfdx.username "$SOURCE_SFDX_USERNAME" packUpdateSettings || true
  "${VLOCITY_CMD[@]}" -sfdx.username "$TARGET_SFDX_USERNAME" packUpdateSettings || true
fi

# 2) Try deploy first, then react to errors

has_settings_mismatch() {
  [[ -f "VlocityBuildErrors.log" ]] && (rg -q "setting mismatch" VlocityBuildErrors.log 2>/dev/null || grep -qi "setting mismatch" VlocityBuildErrors.log)
}

has_errors() {
  if [[ -s "VlocityBuildErrors.log" ]]; then return 0; fi
  if [[ -f "VlocityBuildLog.yaml" ]]; then
    # crude parse: look for "Error: <non-zero>"
    grep -qE "^\s*Error:\s*[1-9]" VlocityBuildLog.yaml && return 0 || true
  fi
  return 1
}

# Build a targeted retry deploy job from failed DataPack types in the error log
build_retry_job() {
  local retry_job="EPC-deploy-retry${ENV_SUFFIX}.yaml"
  if [[ ! -f "VlocityBuildErrors.log" ]]; then return 1; fi
  mapfile -t types < <(grep -oE "^[A-Za-z0-9_\-]+/[A-Za-z0-9_\-]+" VlocityBuildErrors.log | cut -d'/' -f1 | sort -u)
  if [[ ${#types[@]} -eq 0 ]]; then return 2; fi
  {
    echo "projectPath: $EXPORT_DIR"
    echo "queries:"
    for t in "${types[@]}"; do
      echo "  - $t"
    done
  } > "$retry_job"
  echo "$retry_job"
}

ATTEMPTS=${ATTEMPTS:-3}
attempt=1
while (( attempt <= ATTEMPTS )); do
  log "Deploy attempt $attempt/$ATTEMPTS to TARGET: $TARGET_SFDX_USERNAME"
  # Preflight validate on first attempt
  if (( attempt == 1 )); then
    log "Preflight validation on TARGET"
    "${VLOCITY_CMD[@]}" -sfdx.username "$TARGET_SFDX_USERNAME" -job "$JOB_FILE" validateLocalData || true
  fi
  "${VLOCITY_CMD[@]}" -sfdx.username "$TARGET_SFDX_USERNAME" -job "$JOB_FILE" packDeploy || true

  if has_errors; then
    if has_settings_mismatch; then
      warn "Settings mismatch detected — running packUpdateSettings on both orgs and retrying"
      "${VLOCITY_CMD[@]}" -sfdx.username "$SOURCE_SFDX_USERNAME" packUpdateSettings || true
      "${VLOCITY_CMD[@]}" -sfdx.username "$TARGET_SFDX_USERNAME" packUpdateSettings || true
      ((attempt++))
      continue
    fi

    # Try a targeted retry job based on failed DataPack types
    if rjob=$(build_retry_job) 2>/dev/null; then
      log "Attempting targeted redeploy using $rjob"
      "${VLOCITY_CMD[@]}" -sfdx.username "$TARGET_SFDX_USERNAME" -job "$rjob" packDeploy || true
      if ! has_errors; then
        log "Deploy succeeded after targeted retry."
        break
      fi
    fi

    # Run export-based recovery only if export.sh is present
    if [[ -f "./export.sh" ]]; then
      log "Deploy errors detected — invoking export recovery on SOURCE: $SOURCE_SFDX_USERNAME"
      SFDX_USERNAME="$SOURCE_SFDX_USERNAME" ENV="$ENV" VERBOSE=${VERBOSE} MAX_ITERS=${MAX_ITERS:-5} PINNED_VLOCITY_VERSION=${PINNED_VLOCITY_VERSION} bash ./export.sh
      log "Re-attempting deploy after export recovery"
      "${VLOCITY_CMD[@]}" -sfdx.username "$TARGET_SFDX_USERNAME" -job "$JOB_FILE" packDeploy || true

      if has_errors; then
        warn "Deploy still reports errors after recovery. Review logs."
      else
        log "Deploy succeeded after recovery."
        break
      fi
    else
      warn "export.sh not found; cannot run recovery export."
    fi
  else
    log "Deploy completed without reported errors."
    break
  fi

  ((attempt++))
done

log "Deploy process completed. Check VlocityBuildErrors.log and VlocityBuildLog.yaml for details."

# 3) Archive logs with timestamp for traceability
ts=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$SCRIPT_DIR/vlocity-temp/logs"
for f in VlocityBuildErrors.log VlocityBuildLog.yaml; do
  if [[ -f "$f" ]]; then
    cp -f "$f" "$SCRIPT_DIR/vlocity-temp/logs/${ts}-$f"
  fi
done
