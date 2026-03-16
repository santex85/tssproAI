# Build stage: Vite
FROM node:20-alpine AS builder

ARG NODE_MEMORY_MB=2048
ENV NODE_OPTIONS=--max-old-space-size=${NODE_MEMORY_MB}

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
ARG VITE_APP_URL=https://app.tsspro.tech
ARG VITE_UMAMI_URL=
ARG VITE_UMAMI_WEBSITE_ID=
ENV VITE_APP_URL=$VITE_APP_URL
ENV VITE_UMAMI_URL=$VITE_UMAMI_URL
ENV VITE_UMAMI_WEBSITE_ID=$VITE_UMAMI_WEBSITE_ID
RUN npm run build

# Serve stage: nginx
FROM nginx:alpine
RUN apk add --no-cache wget

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
