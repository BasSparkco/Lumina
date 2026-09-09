import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import MembersPage from '@/app/[locale]/(app)/members/page';
import en from '../../../messages/en.json';
const fixture = vi.hoisted(() => ({ fail: false, invite: vi.fn(async () => ({})) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'ADMIN', orgId: 'review-org', email: 'admin@example.test' } }) }));
vi.mock('@/hooks/useRouteGuard', () => ({ useRouteGuard: (allowed: boolean) => allowed }));
vi.mock('@/lib/api', () => ({ membersApi: {
  list: async () => { if (fixture.fail) throw new Error('Unavailable'); return []; },
  listInvites: async () => [], invite: fixture.invite,
} }));
beforeEach(() => {
  fixture.fail = false; fixture.invite.mockClear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
function show() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <NextIntlClientProvider locale="en" messages={en}><MembersPage /></NextIntlClientProvider>
  </QueryClientProvider>);
}
it('keeps the invitation payload and excludes the owner role', async () => {
  show(); const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: en.members.inviteMember }));
  const dialog = screen.getByRole('dialog', { name: en.members.inviteByEmail });
  const email = within(dialog).getByLabelText(en.members.emailAddress);
  expect(email).toHaveFocus();
  await user.type(email, 'editor@example.test');
  expect(within(dialog).queryByRole('option', { name: en.common.roles.OWNER })).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: en.members.sendInvite }));
  await waitFor(() => expect(fixture.invite).toHaveBeenCalledWith('editor@example.test', 'EDITOR'));
});
it('distinguishes failed loading from an empty member list', async () => {
  fixture.fail = true; show();
  expect(await screen.findByRole('alert')).toHaveTextContent(en.common.loadFailed);
  expect(screen.queryByText(en.members.empty)).not.toBeInTheDocument();
});
