/**
 * Tests for the guest-vs-Microsoft flow permission policy.
 *
 * The policy is exercised directly via `policy.handle()` with a synthetic
 * `PolicyQueryUser`; no backend boot is required. It replaces the allow-all
 * policy, so both the restricted (guest) and unrestricted (Microsoft) paths
 * are asserted.
 */

import { AuthorizeResult } from '@backstage/plugin-permission-common';
import {
  actionExecutePermission,
  templateParameterReadPermission,
  templateStepReadPermission,
} from '@backstage/plugin-scaffolder-common/alpha';
import { TenantFlowPermissionPolicy } from '../../../modules/permission/flowPolicy';

const policy = new TenantFlowPermissionPolicy();

const GUEST = 'user:development/guest';
const MICROSOFT = 'user:default/alice';

function userFor(userEntityRef: string) {
  return {
    credentials: {} as any,
    info: { userEntityRef, ownershipEntityRefs: [userEntityRef] },
  } as any;
}

const catalogEntityReadPermission = {
  type: 'resource',
  name: 'catalog.entity.read',
  attributes: { action: 'read' },
  resourceType: 'catalog-entity',
} as any;

const unrelatedPermission = {
  type: 'resource',
  name: 'catalog.entity.create',
  attributes: { action: 'create' },
  resourceType: 'catalog-entity',
} as any;

describe('TenantFlowPermissionPolicy', () => {
  describe('guest', () => {
    it('restricts catalog.entity.read to non-templates or onboarding templates', async () => {
      const decision = await policy.handle(
        { permission: catalogEntityReadPermission },
        userFor(GUEST),
      );

      expect(decision.result).toBe(AuthorizeResult.CONDITIONAL);
      const criteria = JSON.stringify(decision);
      expect(criteria).toContain('IS_ENTITY_KIND');
      expect(criteria).toContain('HAS_SPEC');
      expect(criteria).toContain('onboarding');
    });

    it.each([templateParameterReadPermission, templateStepReadPermission])(
      'allows %s so the onboarding form can render (boundary is catalog read + action execute)',
      async permission => {
        const decision = await policy.handle({ permission }, userFor(GUEST));

        expect(decision.result).toBe(AuthorizeResult.ALLOW);
      },
    );

    it('restricts scaffolder.action.execute to the onboarding action', async () => {
      const decision = await policy.handle(
        { permission: actionExecutePermission },
        userFor(GUEST),
      );

      expect(decision.result).toBe(AuthorizeResult.CONDITIONAL);
      const criteria = JSON.stringify(decision);
      expect(criteria).toContain('HAS_ACTION_ID');
      expect(criteria).toContain('onboarding:create-jira-issue');
      // debug:wait is allow-listed too (delay step for the cross-guest cancel test).
      expect(criteria).toContain('debug:wait');
    });

    it('allows an unrelated permission', async () => {
      const decision = await policy.handle(
        { permission: unrelatedPermission },
        userFor(GUEST),
      );

      expect(decision.result).toBe(AuthorizeResult.ALLOW);
    });
  });

  describe('microsoft', () => {
    it.each([
      catalogEntityReadPermission,
      templateParameterReadPermission,
      templateStepReadPermission,
      actionExecutePermission,
      unrelatedPermission,
    ])('allows %s', async permission => {
      const decision = await policy.handle({ permission }, userFor(MICROSOFT));

      expect(decision.result).toBe(AuthorizeResult.ALLOW);
    });
  });

  it('allows everything when there is no user', async () => {
    const decision = await policy.handle({
      permission: actionExecutePermission,
    });

    expect(decision.result).toBe(AuthorizeResult.ALLOW);
  });
});
