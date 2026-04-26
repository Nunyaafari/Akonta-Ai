FROM node:20-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app

COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src

RUN npx prisma generate
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl dumb-init ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 akonta \
  && useradd --system --uid 10001 --gid 10001 --home-dir /home/akonta --create-home akonta

COPY --chown=akonta:akonta --from=deps /app/package*.json ./
COPY --chown=akonta:akonta --from=build /app/node_modules ./node_modules
COPY --chown=akonta:akonta --from=build /app/prisma ./prisma
COPY --chown=akonta:akonta --from=build /app/dist ./dist

EXPOSE 4000
USER akonta
HEALTHCHECK --interval=30s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node ./dist/main.js"]
