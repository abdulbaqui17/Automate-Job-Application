#!/bin/bash
redis-cli PUBLISH automation:start '{"userId":"15f064a5-26f8-4e19-b9b6-68d977a336ef"}'
echo "Triggered at $(date)! Check Chrome window for LinkedIn login."
