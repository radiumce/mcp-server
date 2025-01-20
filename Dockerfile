# Dockerfile for E2B MCP Server JavaScript Edition

FROM node:22-alpine AS builder

WORKDIR /app

# Copy package.json and package-lock.json to install dependencies
COPY packages/js/package.json packages/js/package-lock.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application files
COPY packages/js/ .

# Build the application
RUN npm run build

FROM node:22-alpine AS release

WORKDIR /app

# Copy built files from builder
COPY --from=builder /app/dist /app/dist

# Install production dependencies
RUN npm ci --omit=dev

ENV NODE_ENV=production

# Define the environment variable for the API key
ENV E2B_API_KEY=

ENTRYPOINT ["node", "./dist/index.js"]
