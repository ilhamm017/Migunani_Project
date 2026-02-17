FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit

FROM node:20-bookworm-slim AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://back_end:5000/api/v1
ARG NEXT_PUBLIC_WS_URL=http://localhost:5000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY package*.json ./
RUN npm install --omit=dev --no-audit
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000
CMD ["npm", "run", "start"]
