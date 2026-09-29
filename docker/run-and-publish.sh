#!/bin/sh
# The scheduled job: run the pipeline and, if that succeeds, publish. Same steps
# as run-and-publish.ps1. supercronic captures the output into the container log.
cd /app || exit 1

log() { echo "$(date '+%Y-%m-%d %H:%M:%S %Z')  $*"; }

log "=== Starting pipeline ==="
node dist/index.js
code=$?
if [ "$code" -ne 0 ]; then
  log "Pipeline failed with exit code $code. Aborting publish."
  exit "$code"
fi

log "Pipeline complete. Starting publish..."
node dist/index.js --publish
code=$?
if [ "$code" -ne 0 ]; then
  log "Publish failed with exit code $code."
  exit "$code"
fi

touch /tmp/last-run   # the healthcheck reads this
log "Publish complete."
