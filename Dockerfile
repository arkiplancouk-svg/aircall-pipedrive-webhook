FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install deps first (better caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the rest of the code
COPY . .

# App settings
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Start the server
CMD ["node", "index.js"]
