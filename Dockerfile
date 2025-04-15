FROM node:16-slim

# Configure apt to be more resilient
RUN echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99force-ipv4 && \
    echo 'Acquire::Retries "10";' > /etc/apt/apt.conf.d/80-retries && \
    echo 'APT::Get::Assume-Yes "true";' > /etc/apt/apt.conf.d/90assumeyes && \
    # Use Cloudflare mirror instead of default Debian repository
    sed -i 's/deb.debian.org/cloudfront.debian.net/g' /etc/apt/sources.list && \
    apt-get clean

# Install latest chrome dev package and fonts with robust retry logic
RUN for retry in $(seq 1 5); do \
    apt-get update --fix-missing && \
    apt-get install -y --no-install-recommends wget gnupg2 ca-certificates apt-transport-https && break; \
    echo "Retrying apt update... attempt $retry"; \
    sleep 10; \
    done && \
    # Add retry mechanism for unreliable connections
    for retry in $(seq 1 5); do \
    wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && break || \
    echo "Retrying download... attempt $retry"; \
    sleep 10; \
    done && \
    sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
    # Update with retry and more delay
    for retry in $(seq 1 5); do \
    apt-get update --fix-missing && break || \
    echo "Retrying apt-get update... attempt $retry"; \
    sleep 15; \
    done && \
    # Install with retry and more delay
    for retry in $(seq 1 5); do \
    apt-get install -y --no-install-recommends google-chrome-stable \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    libxss1 || { \
        echo "Retrying apt-get install... attempt $retry"; \
        sleep 15; \
        continue; \
    }; \
    break; \
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

# Start app
CMD npm start 