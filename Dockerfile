# Use official Node.js LTS image
FROM node:22-alpine

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose the port the app runs on
EXPOSE 3002

# Start the application
CMD ["node", "index.js"]
