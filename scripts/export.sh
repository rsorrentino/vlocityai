#!/usr/bin/env bash
# Ensure we are running under bash even if invoked via `sh`
if [ -z "${BASH_VERSION:-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi
set -euo pipefail

########################################
# Locate script directory and cd there #
########################################
SCRIPT_DIR="$(cd "$(dirname "${BASH_VERSION:+${BASH_SOURCE[0]}}")" && pwd)"
cd "$SCRIPT_DIR"

########################################
# Args & flags                        #
########################################
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
      echo "Usage: $0 [-e|--env ENVIRONMENT] [VERBOSE=1] [DEBUG=1] [MAX_ITERS=N] [KEEP_TMP=1]"
      echo "  -e, --env, --environment  Environment to use (dev, uat, prod)"
      echo "  -h, --help                 Show this help message"
      echo ""
      echo "Environment variables:"
      echo "  VERBOSE=1                  Enable verbose output"
      echo "  DEBUG=1                    Enable debug mode"
      echo "  MAX_ITERS=N                Maximum iterations (default: 10)"
      echo "  KEEP_TMP=1                 Keep temporary files"
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
TMP_DIR="."

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
KEEP_TMP="${KEEP_TMP:-0}"

# Config
# Load usernames from properties in this folder (overridable by env)
PROP_FILES=("$SCRIPT_DIR/environments.properties" "$SCRIPT_DIR/placeholder.properties")
get_prop_any() { # get first non-empty value by key from PROP_FILES
  local key="$1"; local val=""; local file
  for file in "${PROP_FILES[@]}"; do
    [[ -f "$file" ]] || continue
    val=$(grep -E "^[[:space:]]*$key[[:space:]]*=" "$file" | tail -n 1 | sed -E "s/^[[:space:]]*$key[[:space:]]*=[[:space:]]*//" | sed -E 's/[[:space:]]+$//' )
    if [[ -n "$val" ]]; then echo "$val"; return 0; fi
  done
  return 1
}
get_env_prop() { # prefers key.<ENV>, then plain key
  local base="$1"; local val=""
  if [[ -n "$ENV" ]]; then val=$(get_prop_any "${base}.${ENV}" || true); fi
  if [[ -z "$val" ]]; then val=$(get_prop_any "${base}" || true); fi
  echo "$val"
}

SOURCE_SFDX_USERNAME="${SOURCE_SFDX_USERNAME:-$(get_env_prop SOURCE_SFDX_USERNAME || true)}"
SOURCE_SFDX_USERNAME="${SOURCE_SFDX_USERNAME:-rocco.sorrentino@amplifonapac.com.mastcatdev}"
echo "Using ENV: ${ENV:-default} | SOURCE_SFDX_USERNAME: $SOURCE_SFDX_USERNAME | vlocity: ${PINNED_VLOCITY_VERSION}"
ENV_SUFFIX="${ENV:+.${ENV}}"
PROJECT_PATH="./export${ENV:+/$ENV}"
mkdir -p "$PROJECT_PATH"

# Derive main job file for this env by adjusting projectPath if ENV provided
BASE_JOB_MAIN="EPC-export.yaml"
if [[ -n "$ENV" ]]; then
  JOB_MAIN="$TMP_DIR/EPC-export${ENV_SUFFIX}.yaml"
  if [[ -f "$BASE_JOB_MAIN" ]]; then
    awk -v PP="$PROJECT_PATH" 'NR==1{seen=0} { if (!seen && $0 ~ /^projectPath:/) { print "projectPath: " PP; seen=1; next } print }' "$BASE_JOB_MAIN" > "$JOB_MAIN"
  else
    echo "projectPath: $PROJECT_PATH" > "$JOB_MAIN"; echo "queries:" >> "$JOB_MAIN"
  fi
else
  JOB_MAIN="$BASE_JOB_MAIN"
fi

JOB_RECOVERY="EPC-export-recovery${ENV_SUFFIX}.yaml"

VERBOSE=${VERBOSE:-1}
DEBUG=${DEBUG:-0}
if (( DEBUG )); then set -x; fi

# Prepare local temp workspace early (used by processed ids tracking)
TMP_BASE="$SCRIPT_DIR/vlocity-temp"
mkdir -p "$TMP_BASE"
TMP_DIR="$TMP_BASE/export-$(date +%s)-$$"
mkdir -p "$TMP_DIR"
if [[ "$KEEP_TMP" != "1" ]]; then
  trap 'rm -rf "$TMP_DIR"' EXIT
else
  echo "KEEP_TMP=1 set; temp retained at $TMP_DIR"
fi

ERROR_LOG="VlocityBuildErrors.log"
PROCESSED_IDS_FILE="$TMP_DIR/processed_ids.txt"
: > "$PROCESSED_IDS_FILE"

# Prepare merge accumulator for final combined job
MERGE_QUERIES_TMP="$TMP_DIR/merge_queries.tmp"
: > "$MERGE_QUERIES_TMP"
MERGE_JOB="EPC-export-merge${ENV_SUFFIX}.yaml"

# Seed merge with queries from the main job
append_main_queries() {
  if [[ -f "$JOB_MAIN" ]]; then
    awk '
      /^queries:/ { inq=1; next }
      inq && $0 ~ /^[[:space:]]*-[[:space:]]VlocityDataPackType:/ {
        print $0; 
        if (getline > 0) { print $0; }
      }
    ' "$JOB_MAIN" >> "$MERGE_QUERIES_TMP" || true
  fi
}
append_main_queries

# Run in a loop until no new missing Ids remain (max 10 iterations)
MAX_ITERS=${MAX_ITERS:-10}
iter=1

run_main_export() {
  echo "Running main export with $JOB_MAIN (iter $iter)..."
  "${VLOCITY_CMD[@]}" -sfdx.username "$SOURCE_SFDX_USERNAME" -job "$JOB_MAIN" packExport || true
}

extract_missing_ids() {
  if [[ ! -f "$ERROR_LOG" ]]; then
    echo "No $ERROR_LOG produced. Nothing to recover."
    return 1
  fi
  echo "Scanning $ERROR_LOG for missing SObject Ids (iter $iter)..."
  mapfile -t ALL_MISSING < <({
    grep -oE 'SObject/Id:[[:space:]]*[A-Za-z0-9]{15,18}' "$ERROR_LOG" | sed -E 's/.*Id:[[:space:]]*//';
    grep -oE 'orgUrl:[[:space:]]*/[A-Za-z0-9]{15,18}' "$ERROR_LOG" | sed -E 's/.*orgUrl:[[:space:]]*\///';
  } | sort -u)
  # Filter out already processed ids
  if [[ -s "$PROCESSED_IDS_FILE" ]]; then
    mapfile -t MISSING_IDS < <(printf "%s\n" "${ALL_MISSING[@]}" | grep -vxF -f "$PROCESSED_IDS_FILE" || true)
  else
    mapfile -t MISSING_IDS < <(printf "%s\n" "${ALL_MISSING[@]}")
  fi
  if (( VERBOSE )); then
    echo "Missing ids total: ${#ALL_MISSING[@]}, new to process: ${#MISSING_IDS[@]}"
    echo "Sample missing Ids:"; printf '  - %s\n' "${MISSING_IDS[@]:0:10}"
  fi
  if [[ ${#MISSING_IDS[@]} -eq 0 ]]; then
    return 2
  fi
  return 0
}

# Initial main export
run_main_export
extract_missing_ids || status=$?
if [[ ${status:-0} -eq 2 ]]; then
  echo "No missing Ids detected. Nothing to recover."
  exit 0
fi

# Work in temp files to improve portability across shells

# Loop start
while (( iter <= MAX_ITERS )); do
  # Append current ids to processed set
  printf "%s\n" "${MISSING_IDS[@]}" >> "$PROCESSED_IDS_FILE"

  # Unique prefixes for current batch
  printf "%s\n" "${MISSING_IDS[@]}" | awk '{print substr($0,1,3)}' | sort -u > "$TMP_DIR/prefixes.txt"

  PREFIX_COUNT=$(wc -l < "$TMP_DIR/prefixes.txt" | tr -d ' \r\n')
  echo "Unique prefixes (iter $iter): $PREFIX_COUNT"
  if (( VERBOSE )); then
    echo "Prefixes:"; head -n 20 "$TMP_DIR/prefixes.txt" | sed 's/^/  - /'
  fi

# Resolve prefixes in chunks to avoid SOQL IN limits
> "$TMP_DIR/prefix_map.csv" # format: KeyPrefix,QualifiedApiName
chunk=()
emit_prefix_chunk() {
  if [[ ${#chunk[@]} -eq 0 ]]; then return; fi
  inlist=$(printf "'%s'," "${chunk[@]}"); inlist=${inlist%,}
  soql_all="SELECT QualifiedApiName, KeyPrefix FROM EntityDefinition WHERE KeyPrefix IN (${inlist})"
  sfdx force:data:soql:query -u "$SOURCE_SFDX_USERNAME" -q "$soql_all" -r csv -t 2>/dev/null \
    | sed '1d' | tr -d '\r' | sed '/^\s*$/d' \
    | awk -F',' '{print $2","$1}' >> "$TMP_DIR/prefix_map.csv" || true
  chunk=()
}
while IFS= read -r pref; do
  [[ -z "$pref" ]] && continue
  chunk+=("$pref")
  if (( ${#chunk[@]} >= 200 )); then
    emit_prefix_chunk
  fi
done < "$TMP_DIR/prefixes.txt"
emit_prefix_chunk

# Build a per-object id list using the prefix map
> "$TMP_DIR/object_ids.txt" # lines: ObjectApiName,Id
if [[ -s "$TMP_DIR/prefix_map.csv" ]]; then
  if (( VERBOSE )); then
    echo "Resolved prefix mappings (first 10):"; head -n 10 "$TMP_DIR/prefix_map.csv" | sed 's/^/  - /'
  fi
  while IFS= read -r id; do
    pref=${id:0:3}
    # find object for prefix
    obj=$(grep -m1 "^${pref}," "$TMP_DIR/prefix_map.csv" | cut -d',' -f2- | head -n1)
    if [[ -n "$obj" ]]; then
      printf "%s,%s\n" "$obj" "$id" >> "$TMP_DIR/object_ids.txt"
    else
      echo "Warning: No object mapping found for prefix $pref (Id $id)." >&2
    fi
  done < <(printf "%s\n" "${MISSING_IDS[@]}")
else
  echo "No prefix mappings were resolved; prefix_map.csv is empty."
fi

# Derive unique objects list
> "$TMP_DIR/objects.txt"
cut -d',' -f1 "$TMP_DIR/object_ids.txt" 2>/dev/null | sort -u > "$TMP_DIR/objects.txt" || true

if (( VERBOSE )); then
  echo "Objects to recover (count):"
    while IFS= read -r obj; do
    [[ -z "$obj" ]] && continue
    c=$(grep -c "^${obj}," "$TMP_DIR/object_ids.txt" || true)
    printf "  - %s: %s ids\n" "$obj" "$c"
  done < "$TMP_DIR/objects.txt"
fi

if [[ ! -s "$TMP_DIR/objects.txt" ]]; then
  echo "No resolvable objects from missing Ids for iter $iter."
  break
fi

echo "Building recovery job $JOB_RECOVERY..."
# Show how many objects will be written and a preview of object names
OBJ_COUNT=$(wc -l < "$TMP_DIR/objects.txt" 2>/dev/null | tr -d ' \r\n' || echo 0)
echo "Objects to process: $OBJ_COUNT"
if (( VERBOSE )); then
  echo "Objects (first 10):"; head -n 10 "$TMP_DIR/objects.txt" | sed 's/^/  - /'
fi
{
  echo "projectPath: $PROJECT_PATH"
  echo "defaultMaxParallel: 10"
  echo "exportPacksMaxSize: 5000"
  echo "removeInvalidMatchingKeyFields: true"
  echo "maxDepth: 10"
  echo "queries:"
  # Note: messages sent to stderr (>&2) show in console despite redirection
  echo "Starting to emit queries..." >&2
  while IFS= read -r obj; do
    [[ -z "$obj" ]] && continue
    # collect ids for this object
    ids_file="$TMP_DIR/ids_${RANDOM}.txt"
    awk -F',' -v O="$obj" '$1==O {print $2}' "$TMP_DIR/object_ids.txt" | sort -u > "$ids_file"
    # Normalize line endings to avoid empty reads on CRLF files
    sed -i.bak 's/\r$//' "$ids_file" 2>/dev/null || true
    if (( VERBOSE )); then
      id_count=$(wc -l < "$ids_file" | tr -d ' \r\n')
      echo "Processing object $obj with $id_count id(s) (ids_file=$ids_file)" >&2
      if [[ "$id_count" == "0" ]]; then
        echo "  No ids for $obj; skipping." >&2
      else
        echo "  sample ids:" >&2; head -n 5 "$ids_file" | sed 's/^/    - /' >&2
      fi
    fi
    # If no ids, skip emitting queries for this object
    if [[ ! -s "$ids_file" ]]; then
      rm -f "$ids_file"
      continue
    fi
    # chunk and emit using array to avoid read loop edge cases
    mapfile -t ids < "$ids_file"
    if (( VERBOSE )); then echo "  loaded ${#ids[@]} ids into memory" >&2; fi
    count=0
    list=""
    for rid in "${ids[@]}"; do
      rid=${rid%$'\r'}
      rid=${rid//$'\t'/}
      [[ -z "$rid" ]] && continue
      if (( VERBOSE && count < 3 )); then echo "  reading id: '$rid'" >&2; fi
      if (( count == 0 )); then
        list="'$rid'"
      else
        list="$list,'$rid'"
      fi
      ((++count))
      if (( count == 1000 )); then
        printf "  - VlocityDataPackType: SObject\n"
        printf "    query: \"SELECT Id FROM %s WHERE Id IN (%s)\"\n" "$obj" "$list"
        { printf "  - VlocityDataPackType: SObject\n"; printf "    query: \"SELECT Id FROM %s WHERE Id IN (%s)\"\n" "$obj" "$list"; } >> "$MERGE_QUERIES_TMP"
        if (( VERBOSE )); then
          preview=$(echo "$list" | cut -c1-160); [[ ${#list} -gt 160 ]] && preview+="..."
          echo "  emitted chunk for $obj with 1000 id(s)" >&2
          echo "    query preview: SELECT Id FROM $obj WHERE Id IN ($preview)" >&2
        fi
        count=0
        list=""
      fi
    done
    if (( count > 0 )); then
      printf "  - VlocityDataPackType: SObject\n"
      printf "    query: \"SELECT Id FROM %s WHERE Id IN (%s)\"\n" "$obj" "$list"
      { printf "  - VlocityDataPackType: SObject\n"; printf "    query: \"SELECT Id FROM %s WHERE Id IN (%s)\"\n" "$obj" "$list"; } >> "$MERGE_QUERIES_TMP"
      if (( VERBOSE )); then
        preview=$(echo "$list" | cut -c1-160); [[ ${#list} -gt 160 ]] && preview+="..."
        echo "  emitted final chunk for $obj with $count id(s)" >&2
        echo "    query preview: SELECT Id FROM $obj WHERE Id IN ($preview)" >&2
      fi
    fi
    rm -f "$ids_file"
  done < "$TMP_DIR/objects.txt"
  echo "Finished emitting queries into $JOB_RECOVERY" >&2
} > "$JOB_RECOVERY"

echo "Recovery YAML written to $JOB_RECOVERY"
if (( VERBOSE )); then
  echo "Preview of $JOB_RECOVERY:"; sed -n '1,120p' "$JOB_RECOVERY"
  qcount=$(grep -c "^  - VlocityDataPackType: SObject" "$JOB_RECOVERY" || true)
  echo "Queries generated: $qcount"
fi

echo "Running recovery export with $JOB_RECOVERY..."
  "${VLOCITY_CMD[@]}" -sfdx.username "$SOURCE_SFDX_USERNAME" -job "$JOB_RECOVERY" packExport || true
echo "Recovery export completed for iter $iter."

# Re-run main export to surface any new missing references
((iter++))
run_main_export
extract_missing_ids || status=$?
if [[ ${status:-0} -eq 2 ]]; then
  echo "No new missing Ids after iter $((iter-1)). All recovered."
  break
fi
done

echo "Building merged job $MERGE_JOB from main + recovery queries (aggregating by object)..."

# Build aggregated queries section using a heredoc to avoid quoting issues
awk -f - "$MERGE_QUERIES_TMP" > "$TMP_DIR/merged_queries_section.yaml" <<'AWK'
function add_id(obj, id,   key){
  key=obj "|" id
  if (!(key in idsset)) idsset[key]=1
}

$0 ~ /^[[:space:]]*-[[:space:]]VlocityDataPackType:/ {
  type=$0; getline; qline=$0
  q=qline; sub(/^[ 	]*query:[ 	]*"/, "", q); sub(/"$/, "", q)
  if (match(q, /SELECT[ 	]+Id[ 	]+FROM[ 	]+([A-Za-z0-9_]+)[ 	]+WHERE[ 	]+(.+)/, m)) {
    obj=m[1]; where=m[2]
    idonly=0
    if (match(where, /^[ 	]*Id[ 	]+IN[ 	]*\(([^)]*)\)[ 	]*$/, im)) idonly=1
    if (match(where, /Id[ 	]+IN[ 	]*\(([^)]*)\)/, im2)) {
      idsstr=im2[1]; n=split(idsstr, arr, /,[ 	]*/)
      for (i=1;i<=n;i++) { gsub(/^'|'$/, "", arr[i]); if (arr[i] != "") add_id(obj, arr[i]) }
    }
    if (!idonly && !(obj in baseWhere)) { baseWhere[obj]=where; baseType[obj]=type }
  } else {
    others[++oc]=type "\n" qline
  }
  next
}

END {
  # Print merged per-object queries with base WHERE + OR Id IN (...)
  for (obj in baseWhere) {
    t=baseType[obj]; where=baseWhere[obj]
    outids=""; c=0
    for (k in idsset) {
      if (index(k, obj "|") == 1) {
        id=substr(k, length(obj)+2)
        if (outids!="") outids = outids ","
        outids = outids "'" id "'"
        c++
      }
    }
    if (c > 0) where = where " OR Id IN (" outids ")"
    print t
    print "    query: \"SELECT Id FROM " obj " WHERE " where "\""
    printed[obj]=1
  }
  # Objects with only ids (no base query)
  for (obj_id in idsset) {
    split(obj_id, parts, /\|/); obj=parts[1]
    if (printed[obj]) continue
    only[obj]=1
  }
  for (obj in only) {
    # gather ids for this obj
    c=0; list=""
    for (k in idsset) {
      if (index(k, obj "|") == 1) {
        id=substr(k, length(obj)+2)
        if (list!="") list=list ","
        list=list "'" id "'"; c++
        if (c==1000) {
          print "  - VlocityDataPackType: SObject"
          print "    query: \"SELECT Id FROM " obj " WHERE Id IN (" list ")\""
          c=0; list=""
        }
      }
    }
    if (c>0) {
      print "  - VlocityDataPackType: SObject"
      print "    query: \"SELECT Id FROM " obj " WHERE Id IN (" list ")\""
    }
  }
  # Non-SELECT pairs from source
  for (i=1;i<=oc;i++) print others[i]
}
AWK

# Write final merged YAML
{
  awk 'NR==1, /^queries:/ { if ($0 !~ /^queries:/) print }' "$JOB_MAIN"
  echo "queries:"
  cat "$TMP_DIR/merged_queries_section.yaml"
} > "$MERGE_JOB"

if (( VERBOSE )); then
  echo "Preview of $MERGE_JOB:"; sed -n '1,200p' "$MERGE_JOB"
  qcount=$(grep -c "^  - VlocityDataPackType:" "$MERGE_JOB" || true)
  echo "Merged queries count: $qcount"
fi

echo "Running merged export with $MERGE_JOB..."
  "${VLOCITY_CMD[@]}" -sfdx.username "$SOURCE_SFDX_USERNAME" -job "$MERGE_JOB" packExport || true

echo "Done. Check $JOB_RECOVERY, $MERGE_JOB and logs."
if [[ -f "$JOB_RECOVERY" ]]; then
  rcnt=$(grep -c "^  - VlocityDataPackType:" "$JOB_RECOVERY" || true)
  echo "Summary: recovery queries=$rcnt"
fi
if [[ -f "$MERGE_JOB" ]]; then
  mcnt=$(grep -c "^  - VlocityDataPackType:" "$MERGE_JOB" || true)
  echo "Summary: merged queries=$mcnt"
fi
