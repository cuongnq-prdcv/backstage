import {
  AuthorizeResult,
  isPermission,
  isResourcePermission,
  type PolicyDecision,
} from '@backstage/plugin-permission-common';
import type {
  PermissionPolicy,
  PolicyQuery,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import {
  catalogConditions,
  createCatalogConditionalDecision,
} from '@backstage/plugin-catalog-backend/alpha';
import { RESOURCE_TYPE_CATALOG_ENTITY } from '@backstage/plugin-catalog-common/alpha';
import {
  actionExecutePermission,
  RESOURCE_TYPE_SCAFFOLDER_ACTION,
  RESOURCE_TYPE_SCAFFOLDER_TEMPLATE,
  templateParameterReadPermission,
  templateStepReadPermission,
} from '@backstage/plugin-scaffolder-common/alpha';
import {
  createScaffolderActionConditionalDecision,
  scaffolderActionConditions,
} from '@backstage/plugin-scaffolder-backend/alpha';

/** The shared anonymous guest identity issued by the guest provider. */
const GUEST_USER_ENTITY_REF = 'user:development/guest';

/** The onboarding template's `spec.type`, and the onboarding action id. */
const ONBOARDING_SPEC_TYPE = 'onboarding';
const ONBOARDING_ACTION_ID = 'onboarding:create-jira-issue';

/**
 * The scaffolder actions a guest may execute. `onboarding:create-jira-issue` is
 * the onboarding flow's real action; `debug:wait` is allowed only so the
 * onboarding template can include a delay step used to test cross-guest task
 * cancellation. Everything else (Git, cloud, provisioning actions) stays denied.
 */
const GUEST_ALLOWED_ACTION_IDS = [ONBOARDING_ACTION_ID, 'debug:wait'];

/**
 * Permission policy that separates the guest onboarding flow from the
 * Microsoft provisioning flow.
 *
 * The direction that must be enforced is guest → provisioning, because a
 * provisioning task opens pull requests against the live repository and leads
 * to Azure spend. A guest is therefore restricted to reading and running only
 * onboarding templates and the onboarding action; a task the guest starts for
 * the provisioning template fails at its first step because
 * `scaffolder.action.execute` is denied for any action other than the
 * onboarding one.
 *
 * Every other identity (any non-guest, e.g. a Microsoft user) and every
 * permission this policy does not explicitly govern is allowed, preserving the
 * existing behaviour.
 */
export class TenantFlowPermissionPolicy implements PermissionPolicy {
  async handle(
    request: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    const isGuest = user?.info.userEntityRef === GUEST_USER_ENTITY_REF;

    if (!isGuest) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Guests only see onboarding templates in the catalog; non-Template
    // entities stay readable.
    if (
      isResourcePermission(request.permission, RESOURCE_TYPE_CATALOG_ENTITY) &&
      request.permission.name === 'catalog.entity.read'
    ) {
      return createCatalogConditionalDecision(request.permission, {
        anyOf: [
          { not: catalogConditions.isEntityKind({ kinds: ['template'] }) },
          catalogConditions.hasSpec({
            key: 'type',
            value: ONBOARDING_SPEC_TYPE,
          }),
        ],
      });
    }

    // Guests must be able to read the parameters/steps of the onboarding
    // template — otherwise the scaffolder returns an empty `steps` array and the
    // form renders blank. A conditional `hasTag` decision does NOT work here:
    // scaffolder-backend evaluates templateParameterRead/templateStepRead per
    // parameter/step, where the template-level `hasTag` rule never matches, so
    // every parameter is filtered out. This is safe to ALLOW because the flow
    // boundary is enforced by the two layers that remain conditional:
    //   1. catalog.entity.read above — a guest only ever sees the onboarding
    //      template in the catalog, so they cannot reach another template's
    //      parameter-schema from the UI.
    //   2. scaffolder.action.execute below — a guest can only execute the
    //      onboarding action, so a provisioning task fails at its first step.
    // Parameter/step read is schema disclosure, not an execution boundary.
    if (
      (isPermission(request.permission, templateParameterReadPermission) ||
        isPermission(request.permission, templateStepReadPermission)) &&
      isResourcePermission(
        request.permission,
        RESOURCE_TYPE_SCAFFOLDER_TEMPLATE,
      )
    ) {
      return { result: AuthorizeResult.ALLOW };
    }

    // The enforceable boundary: guests may only execute the allow-listed
    // actions (the onboarding action, plus debug:wait for the test delay step).
    // A provisioning task they start fails at its first step.
    if (
      isPermission(request.permission, actionExecutePermission) &&
      isResourcePermission(request.permission, RESOURCE_TYPE_SCAFFOLDER_ACTION)
    ) {
      const [firstActionId, ...restActionIds] = GUEST_ALLOWED_ACTION_IDS;
      return createScaffolderActionConditionalDecision(request.permission, {
        anyOf: [
          scaffolderActionConditions.hasActionId({ actionId: firstActionId }),
          ...restActionIds.map(actionId =>
            scaffolderActionConditions.hasActionId({ actionId }),
          ),
        ],
      });
    }

    return { result: AuthorizeResult.ALLOW };
  }
}
