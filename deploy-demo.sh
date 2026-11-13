#!/usr/bin/env bash
# Example manual Vlocity deploy. Set the org username (or SF CLI alias) first:
#   TARGET_SFDX_USERNAME=my-target-alias ./deploy-demo.sh ./jobs/MyDeploy.yaml
set -euo pipefail

TARGET="${TARGET_SFDX_USERNAME:?Set TARGET_SFDX_USERNAME to the target org username or alias}"
JOB_FILE="${1:?Usage: deploy-demo.sh <job-file.yaml>}"

vlocity -sfdx.username "$TARGET" -job "$JOB_FILE" packDeploy
vlocity -sfdx.username "$TARGET" -job "$JOB_FILE" packRetry
