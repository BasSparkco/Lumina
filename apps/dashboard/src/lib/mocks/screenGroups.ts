// Mock for the Phase 5 "Screen groups & tags" contract — there's no `ScreenGroup` model or
// endpoint on the backend yet. Screens themselves are a real backend entity (see lib/api.ts);
// only the group definitions and the screen -> group assignment are mocked here, keyed by
// screen id, until the backend track ships a real ScreenGroup model + group-publish endpoint.
// Swap this module for a real `req<T>()`-backed client once that lands; the call shapes below
// are designed to match one-for-one so that's a small diff, not a rewrite.

export interface ScreenGroup {
  id: string;
  name: string;
}

const GROUPS_KEY = 'lumina_mock_screen_groups';
const ASSIGNMENTS_KEY = 'lumina_mock_screen_group_assignments';

function loadGroups(): ScreenGroup[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(GROUPS_KEY);
  return raw ? (JSON.parse(raw) as ScreenGroup[]) : [];
}

function saveGroups(data: ScreenGroup[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(GROUPS_KEY, JSON.stringify(data));
}

// screenId -> groupId
function loadAssignments(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(ASSIGNMENTS_KEY);
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

function saveAssignments(data: Record<string, string>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(data));
}

let groups: ScreenGroup[] = loadGroups();
let assignments: Record<string, string> = loadAssignments();

const delay = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));

export const screenGroupsApi = {
  list: async (): Promise<ScreenGroup[]> => {
    await delay();
    groups = loadGroups();
    return [...groups];
  },
  create: async (name: string): Promise<ScreenGroup> => {
    await delay();
    groups = loadGroups();
    const group: ScreenGroup = { id: `g-${Math.random().toString(36).slice(2, 10)}`, name };
    groups = [...groups, group];
    saveGroups(groups);
    return group;
  },
  rename: async (id: string, name: string): Promise<ScreenGroup> => {
    await delay();
    groups = loadGroups();
    groups = groups.map(g => (g.id === id ? { ...g, name } : g));
    saveGroups(groups);
    return groups.find(g => g.id === id)!;
  },
  remove: async (id: string): Promise<void> => {
    await delay();
    groups = loadGroups().filter(g => g.id !== id);
    saveGroups(groups);
    assignments = loadAssignments();
    assignments = Object.fromEntries(Object.entries(assignments).filter(([, groupId]) => groupId !== id));
    saveAssignments(assignments);
  },
  getAssignments: async (): Promise<Record<string, string>> => {
    await delay();
    assignments = loadAssignments();
    return { ...assignments };
  },
  assign: async (screenId: string, groupId: string | null): Promise<void> => {
    await delay();
    assignments = loadAssignments();
    if (groupId) assignments = { ...assignments, [screenId]: groupId };
    else {
      const { [screenId]: _removed, ...rest } = assignments;
      assignments = rest;
    }
    saveAssignments(assignments);
  },
};
