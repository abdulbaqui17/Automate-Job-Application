#!/bin/bash
# Start worker fully detached from any terminal
cd /Users/abdul/projects/week4

# Kill any existing worker
pkill -f "bun.*src/index" 2>/dev/null
sleep 1

# Clear log
> /tmp/worker.log

# Start worker fully detached using setsid-equivalent on macOS
export HEADLESS=false
nohup bun --cwd apps/worker src/index.ts >> /tmp/worker.log 2>&1 &
WORKER_PID=$!
disown $WORKER_PID

echo "Worker started with PID: $WORKER_PID"
echo "Monitor with: tail -f /tmp/worker.log"
echo "Trigger with: redis-cli PUBLISH automation:start '{\"userId\":\"15f064a5-26f8-4e19-b9b6-68d977a336ef\"}'"
