// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V2App } from './V2App';
import { V2Ledger } from './V2Ledger';
import { InvestorAssets, ManagerReport } from './Reports';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('fund workspace', () => {
  it('keeps financing estimates collapsed until requested and leaves submission unavailable', () => {
    render(<V2App />);
    expect(screen.getByText(/Requests are not available from this workspace yet/)).toBeTruthy();
    const calculator = screen.getByText('Financing calculator');
    expect(calculator.closest('details')?.open).toBe(false);
    fireEvent.click(calculator);
    expect(screen.getByText('Estimated amount payable before payer offset')).toBeTruthy();
    fireEvent.click(screen.getByText('Advance and repayment breakdown'));
    expect(screen.getByText('Reserve / holdback (not a fee)')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Submit financing request' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps redemption unavailable without inventing holdings or redundant transaction controls', () => {
    render(<V2App />);
    fireEvent.click(screen.getByRole('button', { name: 'Investor requests' }));
    expect(screen.queryByRole('heading', { name: 'Your RLU2 holdings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Transfer RLU' })).toBeNull();
    fireEvent.click(screen.getByText('Estimate a redemption'));
    expect((screen.getByRole('button', { name: 'Submit redemption request' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Live fund data is required to estimate a payout.')).toBeTruthy();
  });
  it('changes only the explicit eligibility estimate and requires a wallet for public reads', () => {
    render(<V2App />);
    fireEvent.click(screen.getByText('Financing calculator'));
    expect(screen.getByText('Blocked')).toBeTruthy();
    fireEvent.click(screen.getByText('Fund assumptions'));
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('Eligible for automatic approval')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manager controls' }));
    expect((screen.getByRole('button', { name: 'Refresh fund records' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('discards a report response after an A/B/A wallet inspection change', async () => {
    let resolve!: (value: Awaited<ReturnType<V2Ledger['readReport']>>) => void;
    const pending = new Promise<Awaited<ReturnType<V2Ledger['readReport']>>>(r => { resolve = r; });
    vi.spyOn(V2Ledger.prototype, 'readReport').mockReturnValue(pending);
    render(<V2App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manager controls' }));
    fireEvent.click(screen.getByText('Data source'));
    const wallet = screen.getByLabelText('Public wallet address to inspect'), a = '0x' + '22'.repeat(20);
    fireEvent.change(screen.getByLabelText('Fund contract address'), { target: { value: '0x' + 'aa'.repeat(20) } });
    fireEvent.change(wallet, { target: { value: a } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh fund records' }));
    fireEvent.change(wallet, { target: { value: '0x' + '33'.repeat(20) } });
    fireEvent.change(wallet, { target: { value: a } });
    await act(async () => { resolve({ wallet: a, blockTag: 123456, fund: {} } as Awaited<ReturnType<V2Ledger['readReport']>>); await pending; });
    expect(screen.queryByText(/Sepolia block 123456/)).toBeNull();
  });
  it('renders zero holdings and empty reports without fabricating history', () => {
    const report = { wallet: 'public wallet', blockTag: 1, movementsFromBlock: 0, concentrations: [], movements: [], fund: { fundAssetsCents: 0n, freeLiquidityCents: 0n, accruedInterestCents: 0n, bookedAccruedCents: 0n, impairmentCents: 0n }, assets: { nav: 0n, activeUnits: 0n, navPerRlu: null, ownership: '0%', activeValue: 0n, allocatedClaim: 0n, personalValue: 0n } } as unknown as Awaited<ReturnType<V2Ledger['readReport']>>;
    render(<><InvestorAssets report={report} /><ManagerReport report={report} /></>);
    expect(screen.getByText('No active units')).toBeTruthy();
    expect(screen.getByText('No invoices at this block.')).toBeTruthy();
    expect(screen.getByText('No NAV movement records in this range.')).toBeTruthy();
  });
});
