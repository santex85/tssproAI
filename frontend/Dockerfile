# Stage 1: build Expo web
FROM node:20-alpine AS builder

# Limit Node heap to avoid OOM during build on low-RAM servers (dev/VPS). Increase build time, reduces peak memory.
ARG NODE_MEMORY_MB=2048
ENV NODE_OPTIONS=--max-old-space-size=${NODE_MEMORY_MB}

WORKDIR /app

COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm install

COPY . .
ARG EXPO_PUBLIC_API_URL=
ARG EXPO_PUBLIC_SENTRY_DSN=
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_SENTRY_DSN=$EXPO_PUBLIC_SENTRY_DSN
ENV EXPO_PUBLIC_DEV_LOG=1
RUN --mount=type=cache,target=/app/node_modules/.cache \
    --mount=type=cache,target=/app/.expo \
    npx expo export -p web

# Stage 2: serve with nginx
FROM nginx:alpine
RUN apk add --no-cache wget

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
