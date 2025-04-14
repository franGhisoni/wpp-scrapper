import { Browser } from 'puppeteer';

declare module 'whatsapp-web.js' {
  interface Client {
    pupBrowser?: Browser;
    on(event: string, listener: Function): this;
    initialize(): Promise<void>;
    destroy(): Promise<void>;
    getState(): Promise<string>;
    getChats(): Promise<any[]>;
    getChatById(id: string): Promise<any>;
    getContact(id: string): Promise<any>;
    getContacts(): Promise<any[]>;
    getGroupMembers(groupId: string): Promise<any[]>;
    logout(): Promise<void>;
  }
  
  enum WAState {
    INITIALIZING = 'INITIALIZING',
    CONNECTED = 'CONNECTED',
    DISCONNECTED = 'DISCONNECTED',
    AUTHENTICATED = 'AUTHENTICATED',
  }
  
  interface Connection {
    state: WAState;
  }
} 