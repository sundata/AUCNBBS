FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate
WORKDIR /app
COPY . .
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @aucn/domain build && pnpm --filter @aucn/api build && pnpm --filter @aucn/web build
RUN mkdir -p /app/uploads && chown -R node:node /app
ENV NODE_ENV=production
USER node

FROM build AS api
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/main.js"]

FROM build AS web
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
