# Production image for Railway (or any container host). Node 22 ships the SQLite driver the app uses.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY scripts ./scripts

# Railway injects PORT; the app listens on it. Run node directly (not via npm) so SIGTERM reaches the app
# and it can shut down cleanly. Runs as root because Railway volumes are mounted root-owned.
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
