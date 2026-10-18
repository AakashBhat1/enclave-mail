export interface BranchTemplate {
  name: string;
  icon: string;
  keywords: string[];
}

/** One-click starter branches; every keyword stays editable after it is added. */
export const BRANCH_TEMPLATES: BranchTemplate[] = [
  { name: 'Finance', icon: '💰', keywords: ['invoice', 'receipt', 'payment', 'billing', 'statement', '-newsletter'] },
  { name: 'Work', icon: '💼', keywords: ['meeting', 'project', 'deadline', 'proposal', 'review'] },
  { name: 'Travel', icon: '✈️', keywords: ['flight', 'booking', 'hotel', 'itinerary', 'boarding'] },
  { name: 'Orders', icon: '📦', keywords: ['order', 'shipped', 'delivery', 'tracking', 'dispatched'] },
  { name: 'Dev & alerts', icon: '🛠️', keywords: ['build', 'deploy', 'alert', 'pull request', 'failed'] },
  { name: 'Security', icon: '🔐', keywords: ['password', 'sign-in', 'login', 'verification', 'security alert'] },
];
