#!/bin/bash
echo "=============================================="
echo "  Infocom CMS - Ubuntu Linux Startup Script"
echo "=============================================="

# Install dependencies
echo "Installing Dependencies..."
npm install

echo ""
echo "=============================================="
echo "  Starting The Server..."
echo "=============================================="

# Start the node application
node server.js
