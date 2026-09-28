/**
 * Tests for the identity-aware sidebar navigation.
 *
 * The flow decision lives in the pure `selectFlowNavItems`, which is where the
 * guest-vs-Microsoft behaviour is asserted. `AppSidebar` only wires this pure
 * function to the identity API and renders `SidebarItem`s; rendering the full
 * sidebar in a unit test pulls in unrelated APIs (notifications, search) and is
 * covered instead by the Task 16 manual check.
 */

import { selectFlowNavItems } from '../../../modules/nav/Sidebar';

describe('selectFlowNavItems', () => {
  it('returns the onboarding entries for a guest', () => {
    expect(selectFlowNavItems('user:development/guest')).toEqual([
      { to: '/create', text: 'Onboard a tenant' },
      { to: '/tenant-onboarding/requests', text: 'My requests' },
    ]);
  });

  it('returns the provisioning entry for a Microsoft user', () => {
    const items = selectFlowNavItems('user:default/alice');
    expect(items).toEqual([{ to: '/create', text: 'Create...' }]);
    expect(items.some(i => i.to === '/tenant-onboarding/requests')).toBe(false);
  });

  it('returns nothing while the identity is unknown', () => {
    expect(selectFlowNavItems(undefined)).toEqual([]);
  });
});
