#!/bin/bash
# Run the worker in a way that survives terminal reuse
# This script traps SIGINT/SIGHUP so stray ^C from VS Code doesn't kill the worker

cd /Users/abdul/projects/week4

# Kill any existing worker
pkill -f "bun.*src/index" 2>/dev/null
pkill -f "Chrome for Testing" 2>/dev/null
sleep 1

# Clean stale lock files
find artifacts/sessions -name SingletonLock -delete 2>/dev/null

export HEADLESS=false

echo "Starting worker (PID $$)..."
echo "Press Ctrl+C TWICE quickly to actually stop."

# First Ctrl+C just prints a message, second one actually kills
trap 'echo ""; echo "Press Ctrl+C again to stop worker."; trap "exit 0" INT' INT

exec bun --cwd apps/worker src/index.ts
