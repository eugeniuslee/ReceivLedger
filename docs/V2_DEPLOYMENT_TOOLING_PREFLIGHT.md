# Current deployed V2 status

V2 is deployed at 0x9672b0aec292c9f8dd8fefbc9daab876b8ec9882 on Sepolia, block 11974932. [Read-only verification](V2_DEPLOYMENT_VERIFICATION.md) confirms the supplied receipt, exact reviewed runtime/creation/ABI and Manager. Financial execution, private V2 onboarding and automation workers remain inactive/incomplete. Do not deploy again. The pre-deployment wording and action lists below are historical.

# V2 deployment tooling preflight — 23 October 2026

Repository: `C:\Users\Eugen\Documents\GitHub\ReceivLedger`, branch `feat/v2-financing-redemption`.
This report supersedes the Osaka gas allowance in earlier readiness notes. No deployment occurred.

## Preserved review artifacts

- Solidity SHA-256: `15092c6c595fcc186c2dab03e367c5b3f3343441cde5c2a32c76de7309eee14c`.
- Creation payload keccak256 (confirmed manager constructor): `0x05c064223cbf7177b86b379f4786bfa4a2e337bca9ffc454703c7ecbed723b0d`.
- Runtime keccak256: `0x178c217074a782a35c93fab8752cc7980ba850628de4ebf279728bc9d427a12d`.
- Compiler, imports and settings unchanged. Runtime 23,735 bytes; initcode including argument 24,776 bytes.

## Delegated deployer

Manager/deployer: `0x79b246212650b686a0e9e5726092b1558b35d974`.
Exact EIP-7702 marker points to `0x63c0c19a282a1b52b07dd5a65b58948a07dae32b`, documented by MetaMask as its Delegator implementation.
Read from Sepolia: 11,185-byte implementation, keccak256 `0x9270f73d98e7ed6978677bf0550038289efd510e67e700d024502d62510fc1e4`.
The script pins this observed implementation hash and stops on arbitrary sender code, unknown delegation targets or changed implementation.
The hash is a change guard, not an independent security audit or proof of reproducible upstream compilation.

Public implementation getters returned:
- DelegationManager `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`.
- EntryPoint `0x0000000071727De22E5E9d8BAf0edAc6f37da032`.
Both have deployed code. Upstream v1.3.0 core code restricts execution to self/EntryPoint or DelegationManager as appropriate and checks signatures. These components and any previously granted permissions remain part of the manager wallet's security boundary. Existing off-chain signed delegations were not enumerated or audited. No wallet permissions were modified.

Use a **direct type-2 contract-creation transaction**, no `to`, zero value, no authorization list. EIP-7702 permits delegated EOAs to originate regular transactions. Direct CREATE does not execute the sender's delegate code. Do not use type 4 (which requires a destination), bundlers, `wallet_sendCalls`, or delegated execution for this deployment.

## Live checks

Final repeat at 2026-10-23 03:42:30 UTC, PublicNode / Reth v2.8.0, block 11974059:

| Check | Result |
| --- | --- |
| Chain | 11155111 |
| Block gas limit | 200,000,000 |
| Latest/pending nonce | 26 / 26 |
| Exact creation estimate | 37,781,906 gas |
| Allowance (ceil estimate × 1.2) | 45,338,288 gas |
| Estimate with explicit allowance | 37,781,906 gas, successful |
| Creation eth_call with allowance | Reviewed runtime hash, successful |
| Maximum fee / priority quote | 42 / 10 wei per gas |
| Maximum allowance cost | 1,904,208,096 wei = 0.000000001904208096 ETH |
| Wallet balance | 0.016338500787220527 SepoliaETH |
| Predicted direct CREATE address | `0x9672B0Aec292C9F8DD8FefBC9daAb876b8eC9882` |

The predicted address was empty and distinct from V1. Fees, nonce, address and limits must be refreshed immediately before an approved deployment.

Amsterdam activated on Sepolia on 6 October 2026. EIP-8037 caps execution gas at 16,777,216 but permits total gas up to 4,294,967,295 subject to block inclusion in both dimensions. The old 16M total-gas guard was incorrect for state-heavy creation. A successful bounded RPC simulation checks the current network implementation; the script does not infer execution gas merely by subtracting code-deposit cost.

The unsigned offline Amsterdam VM transaction uses the actual sender marker, target code and nonce and validates normal transaction processing, unchanged delegation, CREATE address, runtime and zero initial state. Gas used: 37,483,253. This experimental local fork model is not an exact replica of the RPC client: the higher live estimate controls the allowance. Osaka's 5,316,751 gas is retained only as historical output.

## Next controlled deployment step

Verification completed: full Solidity suite 92/92 passed; final focused deployment suite 6/6 passed, including the subsequently added delegated-sender CREATE regression. These runs overlap. The reviewed Solidity and compiled hashes remained unchanged. Frontend/database checks were not rerun for this tooling-only change.

Final unsigned live package: `supabase/.temp/v2-deployment-20261023034230879-efcf83/`. This directory is ignored local output; do not publish private configuration alongside it. Offline-only packages are never ready-to-submit requests.

1. Obtain separate deployment approval and rerun the live preparation command below. Use only its newest package; previous packages may contain stale limits. Review Sepolia, the manager argument, no destination, zero value, type 2, unchanged creation-data hash and fresh fee/nonce fields.
2. With the owner's explicit wallet confirmation, submit that direct creation request through a wallet/provider supporting the current Sepolia total gas allowance. If the wallet rejects the allowance, rewrites it into a smart-account batch, adds authorizations, or requests a delegation change, cancel and stop. Wallet UI acceptance has not been exercised because signing is not authorized.

```powershell
node scripts/prepare-v2-deployment.mjs --manager 0x79b246212650b686a0e9e5726092b1558b35d974 --deployer 0x79b246212650b686a0e9e5726092b1558b35d974 --rpc https://ethereum-sepolia-rpc.publicnode.com
```

The tool cannot sign/broadcast. Its in-memory unsigned dry run supplies a public sender to the VM without a private key. Live calls are only network/account/block reads, eth_estimateGas and eth_call. Source/bytecode hashes are guarded, mainnet is rejected, V1 cannot be the role or creation destination, and pending transactions/insufficient funds stop preparation.

After separately approved deployment, verify the receipt/address/runtime, owner and zero state before any integration. Publish the package's standard JSON input using compiler v0.8.38+commit.1835d247, optimizer 200, viaIR, Cancun target, contract `contracts/ReceivLedgerV2.sol:ReceivLedgerV2`, and exported constructor arguments. No source verification or hosted change occurred here.

## Primary references

- https://support.metamask.io/configure/accounts/what-is-a-smart-account/
- https://github.com/MetaMask/delegation-framework/blob/v1.3.0/src/EIP7702/EIP7702DeleGatorCore.sol
- https://eips.ethereum.org/EIPS/eip-7702
- https://eips.ethereum.org/EIPS/eip-8037
- https://blog.ethereum.org/en/2026/09/17/glamsterdam-testnet-announcement
