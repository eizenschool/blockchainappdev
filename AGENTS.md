# ProofRoute Project Constraints

This file is the source of truth for future coding sessions. Read it before changing the application.

## Product boundary

- ProofRoute is an Ethereum logistics escrow dApp for a two-person BMIS2003 assignment.
- The two roles are **Shipper** and **Carrier**. A connected wallet is the identity; there are no passwords.
- The fixed lifecycle is: register -> create -> accept -> fund -> verify pickup -> verify delivery -> complete, or refund after expiry.
- Escrow uses test ETH only. Never suggest or enable real-money use.
- Solidity cannot run itself on a timer. `processExpiredAgreement` must be called by a wallet after the deadline.
- Proof codes simulate trusted logistics scanners/oracles. Only hashes are stored before use; plaintext codes are one-time secrets but become public when submitted on-chain.
- Do not add a database, centralized backend, token, NFT, DAO, upgradeable proxy, or external oracle unless both members explicitly approve a scope change.

## Agreed stack

- Solidity 0.8.28, Hardhat 3, Ethers.js 6, OpenZeppelin Contracts 5.
- React 19 with Vite 8 and JavaScript/JSX for the interface.
- MetaMask and local Hardhat chain ID `31337`; Sepolia is optional only after local functionality is stable.
- Use npm and commit `package-lock.json`. Do not introduce Truffle, Ganache, Web3.js, Redux, Tailwind, or a router without a demonstrated need.
- Keep contract addresses and ABIs in `frontend/src/contracts/deployment.json`; never hard-code them in components.

## Ownership split

- **Member A:** registration, shipper agreement creation, escrow funding, cancellation, expiry/refund, shipper UI, and related tests.
- **Member B:** carrier workflow, milestone proof submission, progressive payouts, completion, carrier UI, event history, and related tests.
- `acceptAgreement` is implemented in Member A's foundation only because funding depends on it. Member B owns its final UI and acceptance experience.
- Shared changes to enums, structs, events, or public function signatures require coordination because they alter the ABI.

## Current implementation status

- Member A's reviewed foundation and Member B's Carrier milestone module are implemented.
- The Carrier entry point is `submitMilestoneProof(agreementId, milestoneType, proofCode)`; keep proof verification and payout in one atomic transaction.
- Pickup uses basis-point integer division. Delivery always receives `requiredEscrow - releasedAmount`, including any rounding remainder.
- The React event timeline queries contract logs directly. Do not replace it with locally fabricated records or persistent off-chain storage.
- A local redeployment regenerates `frontend/src/contracts/deployment.json`; old local-chain agreements do not survive a Hardhat node restart.

## Contract invariants

- Agreement IDs start at 1 and must be validated before access.
- Only a registered Shipper can create; the selected address must be a different, registered Carrier.
- Escrow amount is positive and must be funded exactly once with the exact required value before the deadline.
- Pickup payout is expressed in basis points and must be from 1 to 9,999; delivery receives the remainder.
- Proof hashes are nonzero and distinct. Milestones must remain ordered and non-repeatable.
- Cancellation is shipper-only and allowed only before funding.
- Expiry refunds only unreleased escrow to the shipper and must update state before external calls.
- Ether transfers use `.call`, protected by `ReentrancyGuard`, with failures reverting atomically.
- Direct Ether transfers to the contract are rejected so its balance remains accountable to agreements.

## UI and data rules

- Never persist plaintext proof codes in local storage, logs, source files, URLs, or analytics.
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

- Member A worked on `feature/shipper-escrow`; Member B works from the reviewed foundation on `feature/carrier-milestones`.
- Keep `main` stable. Use focused commits and pull requests; do not commit private keys, seed phrases, `.env` files, build artifacts, or `node_modules`.
- Do not merge a public ABI change until both members understand and approve it.
