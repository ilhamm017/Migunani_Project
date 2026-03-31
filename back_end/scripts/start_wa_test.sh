#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f ".env.wa_test" ]]; then
  echo "Missing back_end/.env.wa_test"
  echo "Create it from back_end/.env.wa_test.example first."
  exit 1
fi

export $(grep -v '^[[:space:]]*#' .env.wa_test | grep -v '^[[:space:]]*$' | xargs)

npm run dev

