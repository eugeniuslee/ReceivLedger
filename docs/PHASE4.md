# Phase 4: local Supabase audit — 22 October 2026

Verified working directory and Git root: `C:\Users\Eugen\Documents\GitHub\ReceivLedger`. Started with clean `main`; all Phase 4 edits are on `feat/phase4-supabase-audit`. No hosted project was inspected or changed. No Sepolia transaction, Solidity/address change, commit, push or deployment was performed. Batch 3 source and financial features are preserved.

## Audit findings

| Area | Local finding |
|---|---|
| Registration | Investor/SME forms and database validation already exist. Wallet ownership comes from a protected Web3 identity and session, not form fields or editable metadata. Pending/rejected applications can be resubmitted for the same kind; approved applications are locked. |
| Session isolation | Memory-only tokens; wallet/network changes immediately hide private state. Generation checks discard stale private responses, including returning to the original wallet. Fixed silent cleanup errors: returned and thrown sign-out failures are reported, and a new sign-in stops if prior session cleanup fails. Failed network sign-out cannot guarantee server revocation. |
| Manager | Edge reads the existing contract's live manager, validates the user token and verified wallet, and only then permits privileged review. Users cannot write manager configuration or execute service-only review RPCs, including with a forged actor argument. |
| Application approval | Verified fictional KYC, pending state and matching version are required. Investor approval additionally validates the exact Sepolia manager transaction, contract, recipient, receipt/event, two confirmations and live approval mapping. Finalization retries reuse the hash. SME review remains entirely off-chain. |
| Private records | RLS scopes profiles, contact fields, applications and document metadata to owner/manager. Anonymous and cross-owner reads are denied. Shared approved-name directory excludes private contact/company fields. |
| Storage | Private bucket; server PDF parsing and owner/invoice checks; no direct client upload/update. Found that a legacy permissive DELETE policy could permit owner/manager deletion because DELETE uses the existing read guard's USING expression. New migration 002 adds a restrictive DELETE guard; regression coverage also verifies privileged server cleanup still works. |
| Contract boundary | Off-chain registration neither grants nor enforces a Solidity SME role. Existing wallets retain blockchain access; off-chain investor status never overrides live revocation. |

The identity format and Web3 authentication behavior were cross-checked against [Supabase Web3 documentation](https://supabase.com/docs/guides/auth/auth-web3) and the [Auth implementation](https://github.com/supabase/auth/blob/master/internal/api/web3.go). Hosted Auth compatibility still requires acceptance testing; local SQL tests use disposable PostgreSQL with representative Auth/Storage tables, not a complete Supabase stack.

## Activation inventory

This checkout has `.env.example` but no `.env.local`. Hosted configuration is unverified, not assumed absent. Follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md) in guided pairs, preserving existing project resources.

| Location | Exact requirement |
|---|---|
| Root ignored `.env.local` | `VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co`, `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`; no service-role key. Existing frontend accepts publishable keys only. |
| Auth | Enable Web3 Ethereum; keep separate unlinked Ethereum identities. Site URL is the testing origin; exact redirect roots `http://localhost:5173/`, `http://localhost:4173/`. Production root only after approval. Keep Web3 rate limits; mandatory CAPTCHA needs frontend integration first. |
| Database | Data API enabled, `public` exposed. After approval apply `202610220001_registration_documents.sql`, then `202610220002_private_document_delete_guard.sql`. Check existing objects/history first; never rerun the first raw migration over an existing schema. |
| Storage | Migration 001 creates private `receiveledger-documents`, 5 MB, PDF MIME only. Policies: `rl_private_document_read`, restrictive `rl_private_document_guard`, plus migration 002's restrictive `rl_private_document_delete_guard`. No additional permissive policies are needed. |
| Edge secrets | `SEPOLIA_RPC_URL`: trusted HTTPS read-only Sepolia RPC (11155111). `ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173` for local testing, no trailing slashes/wildcards. Add production only after approval. |
| Runtime-injected server values | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Keep these server-side; confirm legacy anon/service-role keys remain available in the existing project runtime. Never put privileged values in Vite/Vercel frontend variables. |
| Edge Function | Only `registry`; deploy after separate approval with `supabase functions deploy registry --project-ref YOUR_PROJECT_REF`, from this repository. Supplied config sets `verify_jwt=false`; handler independently validates every user token and protected Web3 session. Imports use `supabase/functions/registry/deno.json`. CLI project/auth selection belongs to the owner. |

## Limits and hosted acceptance still required

Local tests prove the reviewed code's boundaries, not the hosted project's effective policies. After approved activation, test separate owner, unrelated wallet and manager sessions with fictional records: both application kinds, reject/resubmit/approve, private PDF upload/download, cross-wallet API denial, forged-manager denial, session expiry/revocation, account/network switches and direct Storage mutation denial. Investor approval with a real receipt requires a separately authorized manager transaction; do not send one simply to complete this audit.

The service's 20-document check is a best-effort count before insertion and can be exceeded by concurrent uploads; it is not an atomic database quota. Lists are capped at 200. PDF filtering is not antivirus or real KYC. Downloaded files cannot be recalled; failed cleanup can leave orphaned objects. No automatic retention/deletion workflow exists. These limits do not grant access to another wallet's documents.

## Next two owner actions

Validation passed: `npm.cmd run typecheck`, `npm.cmd run typecheck:edge`, `npm.cmd test` (182 tests across 14 files), `npm.cmd run build`, and `git diff --check`. The test/build tools required execution outside the filesystem sandbox because esbuild could not resolve the existing Vite config; Edge checking needed network access to locate Deno. No hosted database or function execution was involved. Existing Node jsdom local-storage warnings remained non-fatal.

1. Copy `.env.example` to `.env.local` beside `package.json` (edit rather than overwrite if a file has since been created).
2. Fill the Project URL and publishable key from the existing Supabase project's Connect dialog, save locally, and report that configuration is ready. Do not paste credentials into chat.

Stop here until the owner configures the project. No hosted migration or Edge deployment is authorized by this audit.
