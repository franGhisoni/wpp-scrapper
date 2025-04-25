/**
 * Simple console-based logger
 */
const logger = {
  info: (messageOrContext: string | any, contextOrEmpty?: any) => {
    if (typeof messageOrContext === 'string') {
      if (contextOrEmpty) {
        console.log('[INFO] ' + messageOrContext, contextOrEmpty);
      } else {
        console.log('[INFO] ' + messageOrContext);
      }
    } else {
      console.log('[INFO]', messageOrContext);
    }
  },
  warn: (messageOrContext: string | any, contextOrEmpty?: any) => {
    if (typeof messageOrContext === 'string') {
      if (contextOrEmpty) {
        console.warn('[WARN] ' + messageOrContext, contextOrEmpty);
      } else {
        console.warn('[WARN] ' + messageOrContext);
      }
    } else {
      console.warn('[WARN]', messageOrContext);
    }
  },
  error: (messageOrContext: string | any, contextOrEmpty?: any) => {
    if (typeof messageOrContext === 'string') {
      if (contextOrEmpty) {
        console.error('[ERROR] ' + messageOrContext, contextOrEmpty);
      } else {
        console.error('[ERROR] ' + messageOrContext);
      }
    } else {
      console.error('[ERROR]', messageOrContext);
    }
  },
  debug: (messageOrContext: string | any, contextOrEmpty?: any) => {
    if (typeof messageOrContext === 'string') {
      if (contextOrEmpty) {
        console.debug('[DEBUG] ' + messageOrContext, contextOrEmpty);
      } else {
        console.debug('[DEBUG] ' + messageOrContext);
      }
    } else {
      console.debug('[DEBUG]', messageOrContext);
    }
  }
};

export default logger; 