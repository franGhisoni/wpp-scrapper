export interface Session {
  id: number;
  active: boolean;
  sessionData: string;
  createdAt: Date;
  updatedAt: Date;
} 