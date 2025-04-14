export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export interface SessionResponse {
  success: boolean;
  message: string;
  qrCode?: string;
  authState?: string;
  sessionExists?: boolean;
  status?: any;
}

export interface SessionStatusResponse {
  success: boolean;
  state: string;
  isAuthenticated: boolean;
  hasSession: boolean;
  availableGroups?: string[];
  error?: string;
}

export interface GroupInfoResponse {
  success: boolean;
  name: string;
  members: {
    name: string;
    phoneNumber: string;
  }[];
}

export interface GroupMetricsResponse {
  success: boolean;
  groupName: string;
  totalMembers: number;
  newMembers: any[];
  leftMembers: any[];
  scanDate: Date;
} 