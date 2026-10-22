#!/bin/sh
# Container start-up. A volume mounted at /data at run time (Fly, docker -v) is owned by root, which hides the
# build-time chown: the app, running as pwuser, then cannot write resume PDFs and every application fails at
# tailoring. Running briefly as root, hand /data to pwuser (only when it is not already), then start the app as pwuser.
set -e
DATA_DIR="${DATA_DIR:-/data}"
ART_DIR="${ARTIFACTS_DIR:-$DATA_DIR/artifacts}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" "$ART_DIR"
  if [ "$(stat -c %U "$DATA_DIR")" != "pwuser" ] || [ "$(stat -c %U "$ART_DIR")" != "pwuser" ]; then
    chown -R pwuser:pwuser "$DATA_DIR"
    case "$ART_DIR" in "$DATA_DIR"/*) ;; *) chown -R pwuser:pwuser "$ART_DIR" ;; esac
  fi
  exec runuser -u pwuser -- "$@"
fi
exec "$@"
