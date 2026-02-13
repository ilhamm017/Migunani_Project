#!/bin/bash

# Colors for output
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🛑 Stopping Migunani Motor System...${NC}\n"

# Stop Docker containers
echo -e "${YELLOW}📦 Stopping MySQL database...${NC}"
docker compose down

echo -e "${GREEN}✅ System stopped successfully${NC}\n"
echo -e "To start again, run: ${GREEN}./start.sh${NC} or ${GREEN}npm start${NC}"
