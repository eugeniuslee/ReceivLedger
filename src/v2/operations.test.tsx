// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManagerOperations, ManagerOperationsView } from './ManagerOperations';
import { operationsSummary, type FundReport } from './operations';
import { concentrationReport, type ReportingInvoice } from './reporting';
import { V2Ledger } from './V2Ledger';
const wallet = '0x' + '11'.repeat(20), other = '0x' + '22'.repeat(20);
// Synthetic fixtures exist only in this test module, never in the dashboard.
function snapshot(): FundReport {
  return { wallet, blockTag: 123, timestamp: 1792800000n, subscriptions: [], redemptions: [], invoices: [], concentrations: [],
    fund: { navCents: 0n, pricingUnits: 0n, liquidCents: 0n, freeLiquidityCents: 0n, outstandingCents: 0n,
      accruedInterestCents: 0n, financingCommitmentsCents: 0n, reservedRedemptionCents: 0n, pendingSubscriptionCents: 0n,
      smeReservePoolCents: 0n, SME_CAP_CENTS: 10000000n, valuationValidUntil: 1792886400n, paused: false },
  } as unknown as FundReport;
}
function invoice(id: bigint, extra: Partial<ReportingInvoice> = {}): ReportingInvoice {
  return { id, sme: wallet, entity: 'SME A', payer: 'Payer A', face: 500000n, advance: 500000n, principal: 0n,
    commitment: 0n, maturity: 1795392000n, status: 0n, collectedBase: 0n, collectedOverdue: 0n, collectedPrincipal: 0n, ...extra };
}
function view(report: FundReport | null = snapshot()) {
  return render(<ManagerOperationsView report={report} loading={false} error="" canRead refresh={vi.fn()} />);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('manager operations accounting indicators', () => {
  it('distinguishes an empty verified fund from unavailable data and has no invented obligations', () => {
    expect(operationsSummary(snapshot())).toMatchObject({ navPerUnit: null, investmentCount: 0, redemptionCount: 0, invoiceCount: 0,
      proposedExitValue: 0n, overduePrincipal: 0n, payerExposures: [], warnings: [] });
  });
  it('counts unresolved lifecycle states including refunds, approved financing and allocated exits', () => {
    const report = snapshot();
    report.subscriptions = Array.from({length: 8}, (_, status) => ({id: BigInt(status), status: BigInt(status)})) as FundReport['subscriptions'];
    report.redemptions = Array.from({length: 6}, (_, status) => ({id: BigInt(status), status: BigInt(status), units: 100n})) as FundReport['redemptions'];
    report.invoices = Array.from({length: 6}, (_, status) => invoice(BigInt(status), {status: BigInt(status)}));
    expect(operationsSummary(report)).toMatchObject({investmentCount: 4, redemptionCount: 3, invoiceCount: 3});
  });
  it('prices pending units at active NAV once and keeps allocated claims and segregated funding separate', () => {
    const report = snapshot();
    Object.assign(report.fund, {navCents: 150000n, pricingUnits: 100000n, freeLiquidityCents: 200n, liquidCents: 10000n,
      reservedRedemptionCents: 3000n, financingCommitmentsCents: 2000n, pendingSubscriptionCents: 9000n});
    report.redemptions = [{id: 1n, units: 1000n, status: 0n}, {id: 2n, units: 500n, status: 1n}, {id: 3n, units: 9999n, status: 2n}] as FundReport['redemptions'];
    const result = operationsSummary(report);
    expect(result).toMatchObject({navPerUnit: 150n, proposedExitValue: 2250n, reservedExits: 3000n, commitments: 2000n});
    expect(result.warnings).toContain('Indicative pending redemption value exceeds available liquidity. Pending requests do not reserve cash.');
  });
  it('combines payer principal and gross commitments across SMEs, excluding unapproved proposals', () => {
    const report = snapshot(); Object.assign(report.fund, {navCents: 10000000n});
    report.invoices = [invoice(1n, {status: 3n, principal: 500000n}), invoice(2n, {entity: 'SME B', status: 2n, commitment: 498000n}), invoice(3n)];
    expect(operationsSummary(report).payerExposures).toEqual([{payer: 'Payer A', total: 1000000n, percentage: '10%', exceedsLimit: false}]);
    report.invoices[1].advance += 1n;
    expect(operationsSummary(report).warnings).toContain('A payer exceeds the 10% of NAV financing limit.');
  });
  it('uses reporting time for overdue principal, 1% concentration and valuation expiry warnings', () => {
    const report = snapshot(); Object.assign(report.fund, {navCents: 50000000n, outstandingCents: 500000n, valuationValidUntil: report.timestamp - 1n});
    report.invoices = [invoice(1n, {status: 3n, principal: 500000n, maturity: report.timestamp - 1n}), invoice(2n, {status: 5n, maturity: 1n})];
    report.concentrations = concentrationReport(report.invoices, report.fund.navCents, report.timestamp);
    const result = operationsSummary(report);
    expect(result.overdue.map(i => i.id)).toEqual([1n]); expect(result.overduePrincipal).toBe(500000n);
    expect(result.warnings.join(' ')).toContain('1% of NAV'); expect(result.warnings.join(' ')).toContain('valuation has expired');
  });
  it('does not turn unpriceable pending redemptions into zero-valued liabilities', () => {
    const report = snapshot(); report.redemptions = [{id: 1n, units: 100n, status: 0n}] as FundReport['redemptions'];
    expect(operationsSummary(report).proposedExitValue).toBeNull();
    expect(operationsSummary(report).warnings.join(' ')).toContain('no active pricing units');
  });
});

describe('manager operations dashboard', () => {
  it('leads with actual unavailable/zero states and keeps hypothetical capital blank and collapsed', () => {
    const rendered = view(null);
    expect(screen.getAllByText('Unavailable')).toHaveLength(4);
    expect(screen.getByText(/Requests are unavailable until/)).toBeTruthy();
    const nav = screen.getByLabelText('Scenario fund NAV (S$)') as HTMLInputElement;
    expect(nav.value).toBe(''); expect(nav.closest('details')?.open).toBe(false);
    expect(screen.queryByText(/10,000,000/)).toBeNull();
    rendered.rerender(<ManagerOperationsView report={snapshot()} loading={false} error="" canRead refresh={vi.fn()}/>);
    expect(screen.getByText('No active units')).toBeTruthy();
    expect(screen.getByText('No pending investment requests at this block.')).toBeTruthy();
  });
  it('reviews actual snapshot rows by type and keeps financial execution disabled', () => {
    const report = snapshot();
    report.subscriptions = [{id: 7n, investor: wallet, cents: 123400n, minimumUnits: 100n, funded: false, reviewed: false, status: 0n},
      {id: 8n, investor: other, cents: 100n, minimumUnits: 100n, funded: true, reviewed: true, status: 3n}];
    report.redemptions = [{id: 9n, investor: other, units: 250n, minimumCents: 0n, payoutCents: 0n, status: 0n}];
    report.invoices = [invoice(10n)]; view(report);
    expect(screen.getByRole('button', {name: 'Investment Requests 1'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'Review investment request 8'})).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Review investment request 7'}));
    expect(screen.getByRole('article', {name: 'Selected request review'}).textContent).toContain('Funding not confirmed');
    expect((screen.getByRole('button', {name: 'Confirm simulated funding'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Pending only'));
    expect(screen.getByRole('button', {name: 'Review investment request 8'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: 'Redemption Requests 1'}));
    expect(screen.getByText('2.50 RLU2')).toBeTruthy();
    expect(screen.queryByRole('article', {name: 'Selected request review'})).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Invoice Financing 1'}));
    expect(screen.getByRole('columnheader', {name: 'Maturity (SGT)'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Review invoice request 10'})).toBeTruthy();
    expect(screen.getByText(/Submission dates are not stored/)).toBeTruthy();
  });
  it('keeps scenario calculations separate from the displayed fund snapshot', () => {
    view();
    const navMetric = screen.getByText('V2 fund NAV').closest('.metric')!;
    const before = navMetric.textContent;
    fireEvent.click(screen.getByText('Scenario Analysis'));
    fireEvent.change(screen.getByLabelText('Scenario fund NAV (S$)'), {target: {value: '10000000'}});
    fireEvent.change(screen.getByLabelText('Scenario unreserved liquidity (S$)'), {target: {value: '10000000'}});
    fireEvent.click(screen.getByLabelText('Assume independent verification and low risk for this scenario only'));
    expect(screen.getByRole('heading', {name: 'Eligible for automatic approval'})).toBeTruthy();
    expect(navMetric.textContent).toBe(before);
    fireEvent.change(screen.getByLabelText('Scenario SME gross commitments (S$)'), {target: {value: '100000'}});
    expect(screen.getByText('SME S$100,000 cap exceeded')).toBeTruthy();
  });
  it('automatically loads public data and discards old reports on wallet/epoch/network changes', async () => {
    const pending: ((value: FundReport) => void)[] = [];
    const read = vi.spyOn(V2Ledger.prototype, 'readReport').mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const rendered = render(<ManagerOperations wallet={wallet} epoch={0} networkOk/>);
    expect(read).toHaveBeenCalledWith(wallet);
    rendered.rerender(<ManagerOperations wallet={other} epoch={1} networkOk/>);
    await act(async () => pending[0](snapshot()));
    expect(screen.queryByText('Blockchain snapshot · block 123')).toBeNull();
    await act(async () => pending[1]({...snapshot(), wallet: other}));
    expect(screen.getByText('Blockchain snapshot · block 123')).toBeTruthy();
    rendered.rerender(<ManagerOperations wallet={other} epoch={2} networkOk={false}/>);
    expect(screen.queryByText('Blockchain snapshot · block 123')).toBeNull();
    expect((screen.getByRole('button', {name: 'Refresh fund data'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('fails closed on a bad deployment override and shows a recoverable RPC failure', () => {
    vi.stubEnv('VITE_V2_CONTRACT_ADDRESS', other);
    const read = vi.spyOn(V2Ledger.prototype, 'readReport');
    const rendered = render(<ManagerOperations wallet={wallet} epoch={0} networkOk/>);
    expect(read).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toContain('must match the verified');
    rendered.rerender(<ManagerOperationsView report={null} loading={false} error="RPC unavailable" canRead refresh={vi.fn()}/>);
    expect(screen.getByRole('alert').textContent).toContain('RPC unavailable');
    expect(within(screen.getByRole('region', {name: 'V2 fund overview'})).getAllByText('Unavailable')).toHaveLength(4);
  });
});
