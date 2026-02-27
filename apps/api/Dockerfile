FROM node:20.19.0-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

COPY . .

ENV DATABASE_URL=postgresql://app:app@postgres:5432/applybot

RUN bun install --frozen-lockfile
RUN bun run db:generate

EXPOSE 3001

CMD ["/bin/sh", "-c", "bunx prisma migrate deploy --schema=prisma/schema.prisma && bun --cwd apps/api start"]
