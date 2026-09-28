import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import scaffolderPlugin from '@backstage/plugin-scaffolder/alpha';
import platformTenantOnboardingPlugin from '@internal/backstage-plugin-platform-tenant-onboarding';
import { navModule } from './modules/nav';
import { homeModule } from './modules/home';
import { authModule } from './modules/auth';

export default createApp({
  features: [
    catalogPlugin,
    scaffolderPlugin,
    platformTenantOnboardingPlugin,
    navModule,
    homeModule,
    authModule,
  ],
});
