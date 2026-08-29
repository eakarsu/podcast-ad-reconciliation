# API server image: Node 22 + Express + Postgres client.
# The frontend (vinext/Next.js app) deploys separately via Cloudflare Workers;
# see DEPLOY.md for the full topology.

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# Install dependencies (full lockfile for reproducibility)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Server code + database migrations
COPY server ./server
COPY database ./database

# Uploaded airchecks land here; mount a volume for persistence.
RUN mkdir -p /app/server/uploads
ENV AIRCHECK_DIR=/app/server/uploads
VOLUME ["/app/server/uploads"]

EXPOSE 4010

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4010)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
