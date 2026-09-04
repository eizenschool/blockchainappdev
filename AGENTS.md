# ProofRoute Project Constraints

This file is the source of truth for future coding sessions. Read it before changing the application.

## Product boundary

- ProofRoute is an Ethereum logistics escrow dApp for a two-person BMIS2003 assignment.
- The enhanced branch has three roles: **Shipper**, **Carrier**, and a Shipper-nominated **Verifier**. A connected wallet is the identity; there are no passwords.
- The fixed lifecycle is: register -> create -> accept -> fund -> submit pickup evidence -> verify pickup -> submit delivery evidence -> verify delivery -> complete, or refund after expiry.
- Escrow uses test ETH only. Never suggest or enable real-money use.
- Solidity cannot run itself on a timer. `processExpiredAgreement` must be called by a wallet after the deadline.
- Proof codes simulate trusted logistics scanners/oracles. Only hashes are stored before use; the Shipper gives plaintext codes to the Verifier, and they become public when submitted on-chain.
- Carriers upload non-sensitive demonstration photos externally and paste IPFS CIDs. Never add or store an upload-provider API token.
- Do not add a database, centralized backend, token, NFT, DAO, upgradeable proxy, or external oracle unless both members explicitly approve a scope change.

## Agreed stack

- Solidity 0.8.28, Hardhat 3, Ethers.js 6, OpenZeppelin Contracts 5.
- React 19 with Vite 8 and JavaScript/JSX for the interface.
- MetaMask and local Hardhat chain ID `31337`; Sepolia is optional only after local functionality is stable.
- Use npm and commit `package-lock.json`. Do not introduce Truffle, Ganache, Web3.js, Redux, Tailwind, or a router without a demonstrated need.
- Keep contract addresses and ABIs in `frontend/src/contracts/deployment.json`; never hard-code them in components.

## Ownership split

- **Member A:** registration, shipper agreement creation, escrow funding, cancellation, expiry/refund, shipper UI, and related tests.
- **Member B:** carrier evidence workflow, Verifier approval, progressive payouts, completion, Carrier/Verifier UI, event history, and related tests.
- `acceptAgreement` is implemented in Member A's foundation only because funding depends on it. Member B owns its final UI and acceptance experience.
- Shared changes to enums, structs, events, or public function signatures require coordination because they alter the ABI.

## Current implementation status

- The original two-role implementation is preserved at `baseline/two-role-v1`; `main` remains unchanged.
- The Verifier workflow is implemented on isolated feature/module branches and remains a scope exception until accepted by the team or tutor.
- The Carrier entry point is `submitMilestoneEvidence(agreementId, milestoneType, evidenceCid)`. The nominated Verifier calls `approveMilestone(agreementId, milestoneType, proofCode)`; no Carrier-controlled payout bypass may be added.
- Pickup uses basis-point integer division. Delivery always receives `requiredEscrow - releasedAmount`, including any rounding remainder.
- The React event timeline queries contract logs directly. Do not replace it with locally fabricated records or persistent off-chain storage.
- A local redeployment regenerates `frontend/src/contracts/deployment.json`; old local-chain agreements do not survive a Hardhat node restart.

## Contract invariants

- Agreement IDs start at 1 and must be validated before access.
- Only a registered Shipper can create; the Carrier and Verifier must be registered for their roles, and all three wallets must differ.
- Escrow amount is positive and must be funded exactly once with the exact required value before the deadline.
- Pickup payout is expressed in basis points and must be from 1 to 9,999; delivery receives the remainder.
- Proof hashes are nonzero and distinct. Milestones must remain ordered and non-repeatable.
- Evidence CIDs are non-empty, no longer than 128 characters, replaceable before approval, and immutable after approval.
- Cancellation is shipper-only and allowed only before funding.
- Expiry refunds only unreleased escrow to the shipper and must update state before external calls.
- Ether transfers use `.call`, protected by `ReentrancyGuard`, with failures reverting atomically.
- Direct Ether transfers to the contract are rejected so its balance remains accountable to agreements.

## UI and data rules

- Never persist plaintext proof codes in local storage, logs, source files, URLs, or analytics.
- Treat IPFS evidence as public and warn users not to upload faces, patient records, addresses, or other sensitive information.
- Validate addresses, amounts, deadlines, text lengths, role, network, and wallet state before asking MetaMask to transact.
- Always show pending, success, user-rejected, wrong-network, and contract-error states in plain language.
- The current UI is a functional accessible baseline. Later Figma styling must preserve behavior and contract calls.

## Quality gate

- Before handoff, run `npm test`, `npm run frontend:lint`, and `npm run frontend:build`.
- Add positive and negative tests for every new contract state transition, including authorization and repeat-call failures.
- Preserve checks-effects-interactions and do not weaken validation merely to make a UI flow easier.
- Keep the README setup steps and `docs/BUSINESS_RULES.md` synchronized with contract behavior.
- Cite AI assistance and third-party sources in the assignment report. Do not copy the previous student's repository.

## Git workflow

- The enhanced sequence is `feature/verifier-evidence` followed by `module/01-registry` through `module/05-frontend-history`.
- Keep `main` stable. Use focused commits and pull requests; do not commit private keys, seed phrases, `.env` files, build artifacts, or `node_modules`.
- Do not merge a public ABI change until both members understand and approve it.
