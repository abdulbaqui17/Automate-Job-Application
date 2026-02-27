FROM node:20.19.0-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

COPY . .

RUN bun install --frozen-lockfile

EXPOSE 3002

CMD ["bun", "--cwd", "apps/web", "dev", "--", "-p", "3002", "-H", "0.0.0.0"]
