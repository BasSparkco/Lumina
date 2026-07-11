// Mock for the Phase 5 `GET/POST /v1/org/members` contract.
// Swap `membersApi` for a real `req<T>()`-backed client (see lib/api.ts) once
// the backend track ships these endpoints — the call shape below is designed
// to match one-for-one so that's a small diff, not a rewrite.
import type { UserRole } from '@/lib/api';

export interface Member {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'ACTIVE' | 'INVITED';
  joinedAt: string;
  inviteToken: string | null;
}

export interface OrgInvite {
  email: string;
  role: UserRole;
  orgName: string;
}

const ORG_NAME = 'Acme Signage Co.';
const STORAGE_KEY = 'lumina_mock_members';

const SEED: Member[] = [
  { id: 'm1', name: 'Imran Jer', email: 'imranjer511@gmail.com', role: 'OWNER', status: 'ACTIVE', joinedAt: '2026-05-01T09:00:00Z', inviteToken: null },
  { id: 'm2', name: 'Sara Ahmed', email: 'sara@example.com', role: 'ADMIN', status: 'ACTIVE', joinedAt: '2026-05-12T09:00:00Z', inviteToken: null },
  { id: 'm3', name: 'Karim Youssef', email: 'karim@example.com', role: 'EDITOR', status: 'ACTIVE', joinedAt: '2026-06-02T09:00:00Z', inviteToken: null },
  { id: 'm4', name: 'Layla Hassan', email: 'layla@example.com', role: 'VIEWER', status: 'INVITED', joinedAt: '2026-06-28T09:00:00Z', inviteToken: 'demo-invite-layla' },
];

// Persisted to localStorage (not just an in-memory variable) so an invite link
// still resolves after a full page load/reload in a new tab — a plain module
// variable resets on every navigation since each page load re-runs this file.
function loadMembers(): Member[] {
  if (typeof window === 'undefined') return SEED;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Member[]) : SEED;
}

function saveMembers(data: Member[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let members: Member[] = loadMembers();

const delay = (ms = 350) => new Promise(resolve => setTimeout(resolve, ms));

export const membersApi = {
  list: async (): Promise<Member[]> => {
    await delay();
    return [...members];
  },
  invite: async (email: string, role: UserRole): Promise<Member> => {
    await delay();
    if (members.some(m => m.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('This email has already been invited.');
    }
    const member: Member = {
      id: `m-${Math.random().toString(36).slice(2, 10)}`,
      name: email.split('@')[0] ?? email,
      email,
      role,
      status: 'INVITED',
      joinedAt: new Date().toISOString(),
      inviteToken: `demo-invite-${Math.random().toString(36).slice(2, 10)}`,
    };
    members = [...members, member];
    saveMembers(members);
    return member;
  },
  updateRole: async (id: string, role: UserRole): Promise<Member> => {
    await delay();
    const member = members.find(m => m.id === id);
    if (!member) throw new Error('Member not found');
    member.role = role;
    saveMembers(members);
    return member;
  },
  remove: async (id: string): Promise<void> => {
    await delay();
    members = members.filter(m => m.id !== id);
    saveMembers(members);
  },
  getInvite: async (token: string): Promise<OrgInvite> => {
    await delay();
    members = loadMembers(); // pick up invites created in another tab since this module loaded
    const member = members.find(m => m.inviteToken === token && m.status === 'INVITED');
    if (!member) throw new Error('This invite link is invalid or has already been used.');
    return { email: member.email, role: member.role, orgName: ORG_NAME };
  },
  acceptInvite: async (token: string, name: string): Promise<void> => {
    await delay();
    const member = members.find(m => m.inviteToken === token && m.status === 'INVITED');
    if (!member) throw new Error('This invite link is invalid or has already been used.');
    member.status = 'ACTIVE';
    member.name = name;
    member.inviteToken = null;
    saveMembers(members);
  },
};
