#!/bin/bash
# Double-click this file to start TCGHaven in development mode.
# App will be available at http://localhost:3000

cd "$(dirname "$0")"
echo "================================"
echo "  Starting TCGHaven (dev mode)"
echo "  http://localhost:3000"
echo "  Press Ctrl+C to stop"
echo "================================"
npm run dev
