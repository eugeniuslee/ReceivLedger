# V2 deployment verification — 23 October 2026

**Status: deployed on Ethereum Sepolia; financial application execution remains disabled.** This supersedes the earlier undeployed status and pre-deployment instructions. Do not deploy another contract.

## Verified deployment

| Item | Read-only evidence |
|---|---|
| Chain | Sepolia, 11155111, confirmed with eth_chainId |
| Contract | [0x9672B0Aec292C9F8DD8FefBC9daAb876b8eC9882](https://sepolia.etherscan.io/address/0x9672b0aec292c9f8dd8fefbc9daab876b8ec9882) |
| Creation transaction | [0xf0de9a8abb649fb62163cf8e4709349f5b6494f1a0980b8a665c95581a1583a3](https://sepolia.etherscan.io/tx/0xf0de9a8abb649fb62163cf8e4709349f5b6494f1a0980b8a665c95581a1583a3) |
| Receipt | Successful, status 1; direct type-2 CREATE, zero value, no destination |
| Deployment block | 11,974,932 |
| Deployment time | 23 October 2026, 14:39:24 SGT (06:39:24 UTC) |
| Deployer / constructor Manager | 0x79b246212650b686a0e9e5726092b1558b35d974; nonce 26 |
| Runtime | 23,735 bytes; byte-for-byte identical to fresh reviewed compilation |
| Runtime keccak256 | 0x178c217074a782a35c93fab8752cc7980ba850628de4ebf279728bc9d427a12d |
| Creation payload keccak256 | 0x05c064223cbf7177b86b379f4786bfa4a2e337bca9ffc454703c7ecbed723b0d |
| Compiler | solc 0.8.38+commit.1835d247, optimizer 200, viaIR, Cancun, OpenZeppelin 5.6.1; no warnings |
| ABI | Checked-in src/v2/abi.json exactly matches fresh compilation; no regeneration/change |
| Verification snapshot | Block 11,975,073, 23 October 2026 15:08:00 SGT; 142 confirmations |

The source SHA-256 remains 15092c6c595fcc186c2dab03e367c5b3f3343441cde5c2a32c76de7309eee14c; ABI SHA-256 remains 39984ac3e3a284ff01e0a842ab1b2051ce44d21d98e2c24b3a78df536fe03bd6.

Full machine-readable evidence is [V2_DEPLOYMENT_VERIFICATION.json](V2_DEPLOYMENT_VERIFICATION.json). It records the read block/hash, receipt, compiler, bytecode/creation comparisons, ABI comparison and public state. State and confirmations are observations at that block, not permanent guarantees.

## Manager permissions and current state

At the verification block owner() is the expected Manager, pendingOwner() is zero, automationEnabled() is false and paused() is false. Supply, NAV, fund cash, outstanding principal, invoice/subscription/redemption counts and optional overdue rate are zero.

The Manager has owner authority through the reviewed onlyOwner and owner-or-operator guards. Its explicit executor/attestor mappings are both false; this does not remove the owner's implicit execution/attestation authority. Exact runtime matching establishes that these are the reviewed permission rules. No permission grant, mutation simulation, signed action or operational workflow was sent. This check does not enumerate every operator or establish custody/security of the Manager's wallet.

## Actual frontend public-read smoke check

The current src/v2/V2Ledger.ts readReport adapter was loaded through Vite and called with resolveV2Address() and a public read-only provider, without a wallet/signer. At block 11,975,084 it read the expected Manager, zero supply/NAV, no invoices, no investment/redemption requests and no NAV movements. These are actual chain results, not substituted fixtures.

This verifies the configured adapter/ABI can read this deployment. Browser visual QA, successful private sessions/documents, canonical V2 identity finalization, automation workers and signed investment/financing/redemption flows remain unverified or incomplete. No full-application operational claim follows.

## Shared frontend configuration

src/v2/deployment.json is the checked-in public record for chain, address, deployment block, transaction, Manager and hashes. src/v2/config.ts resolves the verified address; empty/absent VITE_V2_CONTRACT_ADDRESS uses this default. A nonmatching override fails closed rather than silently using V1 or another contract. A matching override is optional in Vercel Preview.

The unified stakeholder workspace displays this address read-only. Public reads use the existing V2 ABI. src/chain/abi.ts and all V1 data remain separate. The optional server template has the same public V2_CONTRACT_ADDRESS, but no hosted function/secret/setting has been changed.

Financial buttons remain disabled; V2_EXECUTION_ENABLED remains false and the adapter still rejects signed execution. There is no address/environment flag that activates transactions.

## Reproduce read-only verification

Run from the real repository:

```powershell
node scripts/verify-v2-deployment.mjs
```

The script compiles locally, uses only public receipt/transaction/code/block/eth_call reads, and prints public evidence. It has no signer, private key, signing or broadcast path. Add --write-report only to replace the local public JSON snapshot. Do not run the historical creation-preparation workflow as a deployment instruction.

Explorer access was unavailable to the verification tool. Explorer source publication has therefore **not** been verified; on-chain runtime/creation matching against local compilation did pass. Do not confuse source publication with deployment or backend activation.

## Remaining release gates

Use [HANDOVER.md](../HANDOVER.md) and [TESTING_CHECKLIST.md](../TESTING_CHECKLIST.md). V2 registry/document binding, current authenticated permissions, receipt-driven UI handlers, automation/custody decisions and controlled Sepolia acceptance remain separate work. The documented MetaMask security warning remains unresolved. No protection was bypassed.

The branch can be reviewed for an execution-disabled Vercel Preview after local checks and owner approval. No additional contract deployment, Solidity/ABI modification, hosted Supabase change, signing, commit, push, merge or Vercel deployment was performed in this verification.

## Final local checks for this update

Frontend/backend/database: 400/400 tests across 27 files; focused offline deployment/compiler regressions: 6/6; TypeScript, both Edge checks, production build and git diff --check: PASS. The earlier full Solidity suite was 93/93 and was not rerun for this configuration/documentation update. Reviewed Solidity and both ABIs remain unchanged.
