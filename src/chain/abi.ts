/** Human-readable ABI for ethers.js, derived from contracts/ReceivLedger.sol (ERC-20 parts from OpenZeppelin). */
export const RECEIVLEDGER_ABI = [
  'function manager() view returns (address)',
  'function totalFundSize() view returns (uint256)',
  'function availableFunds() view returns (uint256)',
  'function invoiceCount() view returns (uint256)',
  'function approvedInvestors(address) view returns (bool)',
  'function invoices(uint256) view returns (uint256 id, address sme, string payerName, uint256 amount, uint256 maturityDate, uint8 status, string rejectionReason)',
  'function getPayerExposure(string payerName) view returns (uint256)',
  'function getMaxPayerExposure() view returns (uint256)',
  'function MAX_FUND_SIZE() view returns (uint256)',
  'function MAX_MATURITY_DAYS() view returns (uint256)',
  'function MAX_PAYER_EXPOSURE_PERCENT() view returns (uint256)',
  'function approveInvestor(address investor)',
  'function revokeInvestor(address investor)',
  'function issueFundUnits(address investor, uint256 amount)',
  'function submitInvoice(string payerName, uint256 amount, uint256 maturityDate) returns (uint256)',
  'function approveInvoice(uint256 invoiceId)',
  'function financeInvoice(uint256 invoiceId)',
  'function recordRepayment(uint256 invoiceId)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event InvestorApproved(address investor)',
  'event InvestorRevoked(address investor)',
  'event FundUnitsIssued(address investor, uint256 amount)',
  'event InvoiceSubmitted(uint256 invoiceId, address sme, string payerName, uint256 amount)',
  'event InvoiceApproved(uint256 invoiceId)',
  'event InvoiceFinanced(uint256 invoiceId, uint256 amount)',
  'event InvoiceRejected(uint256 invoiceId, string reason)',
  'event InvoiceRepaid(uint256 invoiceId, uint256 amount)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
] as const;
export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_EXPLORER = 'https://sepolia.etherscan.io';

// Added deploy contract address
export const RECEIVLEDGER_ADDRESS = '0x18c6751a1a116053e413459464c9b1af356dbf1f';