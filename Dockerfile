# The app keeps its database in the deployment, not in a hosted service.
#
# This image is the supported way to run it that way: `/data` is a volume, and
# the SQLite file lives on it. Everything the site stores — accounts, sessions,
# tournaments, games — survives restarts because the volume does. That is the
# property Vercel's per-request filesystem cannot provide.
#
#   docker build -t arbiter .
#   docker run -p 3000:3000 -v arbiter-data:/data arbiter

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# The app reads this. It must point at the mounted volume, never the image.
ENV DATABASE_PATH=/data/arbiter.db

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
