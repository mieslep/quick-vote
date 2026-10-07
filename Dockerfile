# Quick Vote on one machine, with no Cloudflare.
# One container serves the site and the API on port 8080, and keeps its data in /data (SQLite).
#
#   docker build -t quick-vote .
#   docker run -d -p 8080:8080 -e CREATE_CODE=<a long random string> -v quick-vote-data:/data quick-vote
#
# Podman works the same way: replace "docker" with "podman". See DOCKER.md.
FROM node:22-alpine

WORKDIR /app

# The server uses the same API code as the Cloudflare Worker. A small package.json makes Node read it as an ES module.
RUN printf '{"type":"module"}\n' > package.json
COPY server ./server
COPY worker/src ./worker/src
COPY worker/schema.sql ./worker/schema.sql

# The site files. The server serves only these.
COPY index.html ranked-choice-voting.html styles.css sw.js favicon.svg robots.txt sitemap.xml ./
COPY js ./js
COPY assets ./assets

ENV PORT=8080 \
    DATA_DIR=/data \
    SITE_DIR=/app \
    NODE_ENV=production

# The data folder belongs to the unprivileged user, so that a new named volume is writable.
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/ping').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.mjs"]
