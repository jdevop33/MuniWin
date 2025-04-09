FROM --platform=$BUILDPLATFORM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY maxun-core ./maxun-core

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy frontend source code and config
COPY src ./src
COPY public ./public 
COPY index.html ./
COPY vite.config.js ./
COPY tsconfig.json ./

# Expose the frontend port
EXPOSE ${FRONTEND_PORT:-5173}

# Start the frontend using the client script
CMD ["npm", "run", "client", "--", "--host"]