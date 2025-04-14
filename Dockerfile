FROM node:16-slim

# Install latest chrome dev package and fonts
RUN apt-get update && apt-get install -y wget gnupg2 ca-certificates \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

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