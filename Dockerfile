FROM node:16-slim

# Install latest chrome dev package and fonts with retry logic
RUN apt-get update --fix-missing && \
    apt-get install -y --no-install-recommends wget gnupg2 ca-certificates apt-transport-https && \
    # Add retry mechanism for unreliable connections
    for i in 1 2 3 4 5; do \
      wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && break || \
      echo "Retrying download... attempt $i"; \
      sleep 5; \
    done && \
    sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
    # Switch to more reliable mirrors
    echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99force-ipv4 && \
    # Update with retry
    for i in 1 2 3 4 5; do \
      apt-get update --fix-missing && break || \
      echo "Retrying apt-get update... attempt $i"; \
      sleep 5; \
    done && \
    # Install with retry
    for i in 1 2 3 4 5; do \
      apt-get install -y --no-install-recommends google-chrome-stable \
      fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
      libxss1 && break || \
      echo "Retrying apt-get install... attempt $i"; \
      sleep 5; \
    done && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Create directories for session storage
RUN mkdir -p ./.wwebjs_auth
RUN mkdir -p ./tmp
RUN chmod -R 777 ./.wwebjs_auth
RUN chmod -R 777 ./tmp

# Build app
RUN npm run build

# Add additional dependencies for puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Setup environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV AUTO_CLOSE_AFTER_SCAN=true
ENV AUTO_CLOSE_TIMEOUT=300000

# Open port
EXPOSE 3001

# Run upgrade script and start app
CMD npm run upgrade && npm start 