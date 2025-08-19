# Use Node.js 20 Alpine as base image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package.json
COPY package.json ./

# Install dependencies (not using npm ci, since no package-lock.json)
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# Expose port 3000
EXPOSE 3000

# Start the app
CMD ["node", "index.js"]
