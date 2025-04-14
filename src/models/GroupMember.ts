export interface GroupMember {
  id: number;
  groupName: string;
  phoneNumber: string;
  name: string;
  joinDate: Date;
  leftDate: Date | null;
  isActive: boolean;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupMetrics {
  groupName: string;
  totalMembers: number;
  newMembers: GroupMember[];
  leftMembers: GroupMember[];
  scanDate: Date;
}
