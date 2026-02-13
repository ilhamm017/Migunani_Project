#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Migunani Motor System...${NC}\n"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Start Docker database
echo -e "${YELLOW}📦 Starting MySQL database...${NC}"
docker-compose up -d

# Wait for database to be ready
echo -e "${YELLOW}⏳ Waiting for database to be ready...${NC}"
sleep 10

# Check if database is healthy
if ! docker-compose ps | grep -q "healthy"; then
    echo -e "${YELLOW}⏳ Database still initializing, waiting a bit more...${NC}"
    sleep 10
fi

# Check if we need to run seeder
echo -e "${YELLOW}🌱 Checking if database needs seeding...${NC}"
read -p "Run database seeder? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]
then
    echo -e "${YELLOW}🌱 Running database seeder...${NC}"
    cd back_end && npm run seed
    cd ..
fi

# Start backend and frontend concurrently
echo -e "\n${GREEN}🚀 Starting Backend & Frontend...${NC}\n"
npm run dev
