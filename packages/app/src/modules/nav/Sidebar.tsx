import { useEffect, useState } from 'react';
import {
  Sidebar,
  SidebarDivider,
  SidebarGroup,
  SidebarItem,
  SidebarScrollWrapper,
  SidebarSpace,
} from '@backstage/core-components';
import { NavContentBlueprint } from '@backstage/plugin-app-react';
import {
  identityApiRef,
  useApi,
  type BackstageUserIdentity,
} from '@backstage/core-plugin-api';
import { SidebarLogo } from './SidebarLogo';
import MenuIcon from '@material-ui/icons/Menu';
import SearchIcon from '@material-ui/icons/Search';
import AddCircleOutlineIcon from '@material-ui/icons/AddCircleOutline';
import AssignmentIcon from '@material-ui/icons/Assignment';
import { SidebarSearchModal } from '@backstage/plugin-search';
import { UserSettingsSignInAvatar } from '@backstage/plugin-user-settings';
import { NotificationsSidebarItem } from '@backstage/plugin-notifications';

/** The shared anonymous guest identity issued by the guest provider. */
const GUEST_USER_ENTITY_REF = 'user:development/guest';

/** A flow-specific sidebar entry. */
export interface FlowNavItem {
  to: string;
  text: string;
}

/**
 * Pure decision: which flow-specific sidebar entries to show for a given
 * identity. Guest sees the onboarding entries; any other identity sees the
 * provisioning entry. Exported so the branch can be unit-tested without
 * rendering `SidebarItem` (whose DOM output depends on sidebar context).
 */
export function selectFlowNavItems(
  userEntityRef: string | undefined,
): FlowNavItem[] {
  if (userEntityRef === undefined) {
    return [];
  }
  if (userEntityRef === GUEST_USER_ENTITY_REF) {
    return [
      { to: '/create', text: 'Onboard a tenant' },
      { to: '/tenant-onboarding/requests', text: 'My requests' },
    ];
  }
  return [{ to: '/create', text: 'Create...' }];
}

/**
 * The app sidebar, rendered by {@link SidebarContent}. Exported so it can be
 * unit-tested with a mocked identity API.
 *
 * `navItems` is typed `any`: it is the NavContentBlueprint's collection, whose
 * parameter type is a function type that does not index cleanly. This is the
 * single framework-boundary `any`; only `withComponent`/`take`/`rest` are used.
 *
 * The signed-in identity decides which flow's navigation is shown, via
 * {@link selectFlowNavItems}. While the identity is still loading, no
 * flow-specific entry is rendered, to avoid a flash of the wrong menu.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AppSidebar({ navItems }: { navItems: any }) {
  const identityApi = useApi(identityApiRef);
  const [identity, setIdentity] = useState<BackstageUserIdentity | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    identityApi
      .getBackstageIdentity()
      .then(value => {
        if (active) {
          setIdentity(value);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [identityApi]);

  const flowItems = loading ? [] : selectFlowNavItems(identity?.userEntityRef);

  const nav = navItems.withComponent(
    (item: { icon: JSX.Element; href: string; title: string }) => (
      <SidebarItem icon={() => item.icon} to={item.href} text={item.title} />
    ),
  );

  // Skipped items
  nav.take('page:search'); // Using search modal instead
  nav.take('page:notifications'); // Using NotificationsSidebarItem manually instead

  // The onboarding lookup page also appears as a generic nav item; take it out
  // so it does not render twice — its placement is driven by the flow above.
  nav.take('page:platform-tenant-onboarding');

  return (
    <Sidebar>
      <SidebarLogo />
      <SidebarGroup label="Search" icon={<SearchIcon />} to="/search">
        <SidebarSearchModal />
      </SidebarGroup>
      <SidebarDivider />
      <SidebarGroup label="Menu" icon={<MenuIcon />}>
        {nav.take('page:home')}
        {nav.take('page:catalog')}
        {flowItems.map(item => (
          <SidebarItem
            key={item.to}
            icon={item.to === '/create' ? AddCircleOutlineIcon : AssignmentIcon}
            to={item.to}
            text={item.text}
          />
        ))}
        <SidebarDivider />
        <SidebarScrollWrapper>
          {nav.rest({ sortBy: 'title' })}
        </SidebarScrollWrapper>
      </SidebarGroup>
      <SidebarSpace />
      <SidebarDivider />
      <NotificationsSidebarItem />
      <SidebarDivider />
      <SidebarGroup
        label="Settings"
        icon={<UserSettingsSignInAvatar />}
        to="/settings"
      >
        {nav.take('page:app-visualizer')}
        {nav.take('page:user-settings')}
      </SidebarGroup>
    </Sidebar>
  );
}

export const SidebarContent = NavContentBlueprint.make({
  params: {
    component: ({ navItems }) => <AppSidebar navItems={navItems} />,
  },
});
