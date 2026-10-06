FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

FROM dependencies AS build
COPY backend ./backend
COPY frontend ./frontend
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DB_CLIENT=mysql2 \
    PORT=4000
RUN apt-get update \
  && apt-get install -y --no-install-recommends default-mysql-client libstdc++6 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/src ./backend/src
COPY --from=build /app/frontend/package.json ./frontend/package.json
COPY --from=build /app/frontend/dist ./frontend/dist
RUN mkdir -p /data/uploads /data/backups \
  && chown -R node:node /app /data
USER node
EXPOSE 4000
CMD ["sh", "-c", "npm run migrate && npm run seed && npm start"]
