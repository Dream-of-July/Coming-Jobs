#!/bin/bash
set -e
cd "$(dirname "$0")"
exec node --no-warnings scripts/install.mjs "$@"
