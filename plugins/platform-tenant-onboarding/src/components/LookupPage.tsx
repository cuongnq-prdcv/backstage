import { useCallback, useState } from 'react';
import {
  Content,
  EmptyState,
  Header,
  Link,
  Page,
  Progress,
  ResponseErrorPanel,
  Table,
  type TableColumn,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import TextField from '@material-ui/core/TextField';
import Button from '@material-ui/core/Button';
import Box from '@material-ui/core/Box';
import {
  onboardingApiRef,
  type OnboardingRequestSummary,
} from '../api/OnboardingApi';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; rows: OnboardingRequestSummary[] }
  | { status: 'error'; error: Error };

const columns: TableColumn<OnboardingRequestSummary>[] = [
  {
    title: 'Key',
    field: 'issueKey',
    render: row => <Link to={row.url}>{row.issueKey}</Link>,
  },
  { title: 'Summary', field: 'summary' },
  { title: 'Status', field: 'status' },
  { title: 'Created', field: 'created' },
];

/**
 * Page where a guest looks up their onboarding requests by contact email.
 *
 * The state machine keeps `success` (which may hold an empty list) and `error`
 * distinct, so a failed lookup renders an error panel rather than the "no
 * requests" empty state — conflating them would tell a user they have no
 * request when the lookup merely failed.
 */
export function LookupPage() {
  const api = useApi(onboardingApiRef);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });

  const onLookup = useCallback(async () => {
    if (!email) {
      return;
    }
    setState({ status: 'loading' });
    try {
      const rows = await api.listRequests(email);
      setState({ status: 'success', rows });
    } catch (error) {
      setState({ status: 'error', error: error as Error });
    }
  }, [api, email]);

  return (
    <Page themeId="tool">
      <Header
        title="My onboarding requests"
        subtitle="Look up the status of your onboarding requests by contact email"
      />
      <Content>
        <Box display="flex" gridGap={16} alignItems="center" marginBottom={2}>
          <TextField
            label="Contact email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            variant="outlined"
            size="small"
            inputProps={{ 'aria-label': 'Contact email' }}
          />
          <Button variant="contained" color="primary" onClick={onLookup}>
            Look up
          </Button>
        </Box>

        {state.status === 'loading' && <Progress />}

        {state.status === 'error' && (
          <ResponseErrorPanel error={state.error} />
        )}

        {state.status === 'success' && state.rows.length === 0 && (
          <EmptyState
            missing="data"
            title="No requests found"
            description="No onboarding requests were found for that contact email."
          />
        )}

        {state.status === 'success' && state.rows.length > 0 && (
          <Table
            title="Onboarding requests"
            options={{ search: false, paging: false }}
            columns={columns}
            data={state.rows}
          />
        )}
      </Content>
    </Page>
  );
}
