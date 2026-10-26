#!/usr/bin/env sh
set -u

log() {
  printf '%s\n' "[bb-env-setup] $*"
}

run_step() {
  step_name="$1"
  shift
  log "Running: ${step_name}"
  if "$@"; then
    log "Completed: ${step_name}"
    return 0
  else
    exit_code=$?
    log "Warning: ${step_name} failed (exit ${exit_code}); continuing provisioning"
    return 1
  fi
}

# Hash of the inputs that decide what `pnpm install` would do. Stored inside
# node_modules so it travels with an installed tree (copy-on-write
# environments) and disappears with it (fresh worktrees).
INSTALL_STAMP="node_modules/.bb-env-setup-install-hash"
INSTALL_INPUTS="pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc"

install_inputs_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    hash_cmd="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then
    hash_cmd="shasum -a 256"
  else
    return 1
  fi
  for input in ${INSTALL_INPUTS}; do
    if [ -f "${input}" ]; then
      printf '%s\n' "${input}"
      ${hash_cmd} < "${input}"
    fi
  done | ${hash_cmd} | cut -d ' ' -f 1
}

if ! command -v pnpm >/dev/null 2>&1; then
  log "Warning: pnpm is not available; skipping install/build"
  exit 0
fi

if [ ! -f package.json ]; then
  log "Warning: package.json not found; skipping install/build"
  exit 0
fi

# A fresh bb checkout needs several gigabytes for this monorepo. Starting the
# install on a nearly full host is worse than skipping it: pnpm can exhaust the
# filesystem before provisioning finishes and take the running bb server down
# with it. The agent can still inspect and edit the checkout without installed
# dependencies.
available_kb="$(df -Pk . 2>/dev/null | awk 'NR == 2 { print $4 }')"
minimum_install_kb=6291456
case "${available_kb}" in
  ''|*[!0-9]*) ;;
  *)
    if [ "${available_kb}" -lt "${minimum_install_kb}" ]; then
      log "Warning: less than 6 GiB is available; skipping pnpm install"
      exit 0
    fi
    ;;
esac

current_hash="$(install_inputs_hash 2>/dev/null || true)"

if [ -n "${current_hash}" ] && [ -f "${INSTALL_STAMP}" ] && [ -d node_modules/.pnpm ]; then
  if [ "$(cat "${INSTALL_STAMP}" 2>/dev/null)" = "${current_hash}" ]; then
    log "Skipping pnpm install: node_modules already matches the lockfile"
    exit 0
  fi
fi

if run_step "pnpm install" pnpm install && [ -n "${current_hash}" ]; then
  printf '%s\n' "${current_hash}" > "${INSTALL_STAMP}"
fi
exit 0
