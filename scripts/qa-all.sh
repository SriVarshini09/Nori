#!/usr/bin/env bash
# One full QA round on the offline stack: click every control (desktop and phone), then keyboard, probe, ReDoS, resume audit,
# random monkey, stress data. Ports 3300/4300 (never the dev servers on 3000/4000). Prints a one-line verdict per stage.
cd "$(dirname "$0")/.."
export E2E_API_PORT=4300 E2E_WEB_PORT=3300 MSYS_NO_PATHCONV=1
free() { for p in 3300 4300; do netstat -ano | grep ":$p " | grep LISTEN | awk '{print $5}' | sort -u | while read pid; do taskkill //PID "$pid" //F >/dev/null 2>&1; done; done; }
stage() { local name="$1"; shift; local out; out=$("$@" 2>&1); local code=$?; echo "$out" | grep -v '^\[api\]' > "test-results/qa/round-$name.txt"; if [ $code -eq 0 ]; then echo "PASS  $name"; else echo "FAIL  $name  (see test-results/qa/round-$name.txt)"; fi; }
mkdir -p test-results/qa
free
stage clicks-desktop npx tsx scripts/qa-clicks.mts
stage clicks-mobile  npx tsx scripts/qa-clicks.mts --mobile
stage resume         env E2E_API_PORT=4302 E2E_WEB_PORT=3302 npx tsx scripts/qa-resume.mts
stage stress         npx tsx scripts/qa-stress.mts
free
(npx tsx scripts/serve.mts > /tmp/serve-qa.log 2>&1 &)
for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code}" http://localhost:3300/login | grep -q 200 && break; sleep 3; done
stage probe   npx tsx scripts/qa-probe.mts
stage redos   npx tsx scripts/qa-redos.mts
stage keys    npx tsx scripts/qa-keys.mts
stage monkey  npx tsx scripts/qa-monkey.mts rounds=2 actions=40
free
echo "round finished"
