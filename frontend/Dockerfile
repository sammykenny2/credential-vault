# Frontend Dockerfile
# Multi-stage build for production

# ============================================
# Build Stage
# ============================================
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and build. APP_VERSION / APP_REVISION are baked into the bundle
# (vite.config.ts); this build context has no VERSION file to read.
COPY . .
ARG APP_VERSION
ARG APP_REVISION
RUN npm run build

# ============================================
# Production Stage
# ============================================
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config and the shared security-header snippet it includes
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf

# Expose port
EXPOSE 80

# Health check. 127.0.0.1, not localhost: busybox wget resolves localhost to
# ::1 first, and nginx.conf listens on IPv4 only, so the check always failed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
