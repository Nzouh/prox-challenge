FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Baked in at build time: Next inlines NEXT_PUBLIC_* into the client bundle and rewrites
# every asset URL, so the mount point is a property of the image, not of the container's
# environment. Build with --build-arg NEXT_PUBLIC_BASE_PATH=/arc to serve under a subpath.
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH

RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# next.config is re-evaluated when the server boots, so the mount point has to be declared
# in this stage too. The builder bakes it into the client bundle; without it here the
# server routes at / while the HTML it serves asks for assets under the prefix.
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH

# next start reads next.config from the working directory at boot — the build output
# alone does not carry basePath into the router.
COPY --from=builder --chown=node:node /app/next.config.ts ./
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/knowledge ./knowledge

USER node
EXPOSE 3000
CMD ["npm", "start"]
