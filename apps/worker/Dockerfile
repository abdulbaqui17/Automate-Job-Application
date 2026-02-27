FROM node:20.19.0-bookworm-slim

WORKDIR /app

# System deps for Playwright Chromium
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates curl unzip \
     libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
     libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libxcomposite1 \
     libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
     libcairo2 libasound2 libwayland-client0 \
     fonts-liberation fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

COPY . .

ENV DATABASE_URL=postgresql://app:app@postgres:5432/applybot

RUN bun install --frozen-lockfile
RUN bun run db:generate

# Install Playwright Chromium browser
RUN bunx playwright install chromium

CMD ["bun", "--cwd", "apps/worker", "start"]
