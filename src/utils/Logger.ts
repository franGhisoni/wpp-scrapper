/**
 * Simple console-based logger
 */
const logger = {
  info: (contextOrMessage: any, messageOrEmpty?: string) => {
    if (messageOrEmpty) {
      console.log(`[INFO] ${messageOrEmpty}`, contextOrMessage);
    } else {
      console.log(`[INFO] ${contextOrMessage}`);
    }
  },
  warn: (contextOrMessage: any, messageOrEmpty?: string) => {
    if (messageOrEmpty) {
      console.warn(`[WARN] ${messageOrEmpty}`, contextOrMessage);
    } else {
      console.warn(`[WARN] ${contextOrMessage}`);
    }
  },
  error: (contextOrMessage: any, messageOrEmpty?: string) => {
    if (messageOrEmpty) {
      console.error(`[ERROR] ${messageOrEmpty}`, contextOrMessage);
    } else {
      console.error(`[ERROR] ${contextOrMessage}`);
    }
  },
  debug: (contextOrMessage: any, messageOrEmpty?: string) => {
    if (messageOrEmpty) {
      console.debug(`[DEBUG] ${messageOrEmpty}`, contextOrMessage);
    } else {
      console.debug(`[DEBUG] ${contextOrMessage}`);
    }
  }
};

export default logger; 