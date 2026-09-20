#!/usr/bin/env bash
set -euo pipefail

bash -n scripts/*.sh

set +e
refusal_output="$(bash scripts/apply-db-change.sh src/db/schema.sql 2>&1)"
refusal_status=$?
set -e

if [[ "$refusal_status" -ne 2 ]] || [[ "$refusal_output" != *"Refusing to replay schema.sql"* ]]; then
  echo "FAIL: database helper did not refuse non-bootstrap schema replay" >&2
  exit 1
fi

echo "verify-tooling: OK"
