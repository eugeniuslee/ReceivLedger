export type Address = string;
export interface Investor { name: string; bal: number; ok: boolean }
export interface InvoiceRec { id: number; sme: Address; payer: string; amount: number; mat: number; status: number; reason: string }
export interface LogEntry { id: number; ts: number; type: string; detail: string; amount: number; status: 'Success' | 'Reverted'; tx: string; avail: number; out: number }
/** Whole ledger snapshot. Amounts are whole S$ (= RLU units, decimals 0); times are ms since epoch. */
export interface State { now: number; caller: Address; total: number; avail: number; inv: Record<Address, Investor>; invoices: InvoiceRec[]; log: LogEntry[] }
/** Runs a ledger action against a copy of the state; return value becomes the toast message. Thrown errors = contract reverts. */
export type RunFn = (fn: (c: State) => string | void | null) => void;
