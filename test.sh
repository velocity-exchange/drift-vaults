#!/usr/bin/env bash

# Thin wrapper: build then run the full test suite.
# Validator lifecycle lives in test-scripts/run-anchor-tests.sh — it starts
# (and stops) its own local validator for the suites that need one, or
# reuses a validator you already have running on 8899.
#
# usage: ./test.sh [--no-build]
#   --no-build  - skip building the program and SDK, reuse last build

no_build=false
while [[ -n $1 ]]; do
  if [[ $1 == --no-build ]]; then
    no_build=true
    shift 1
  elif [[ $1 == -h ]]; then
    sed -n '3,9p' "$0"
    exit 0
  else
    echo "Unknown argument: $1"
    exit 1
  fi
done

if [[ $no_build == false ]]; then
  chmod +x ./build.sh
  ./build.sh --anchor-test
fi

bash ./test-scripts/run-anchor-tests.sh --skip-build
