import { formatEther } from "ethers";

const AGREEMENT_EVENT_NAMES = [
  "AgreementCreated",
  "AgreementVerifierAssigned",
  "AgreementAccepted",
  "AgreementFunded",
  "MilestoneEvidenceSubmitted",
  "MilestoneVerified",
  "EscrowReleased",
  "AgreementCompleted",
  "AgreementCancelled",
  "AgreementRefunded",
];

function milestoneName(value) {
  return Number(value) === 0 ? "Pickup" : "Delivery";
}

function describeEvent(log) {
  const { name } = log.fragment;
  const args = log.args;

  switch (name) {
    case "AgreementCreated":
      return {
        title: "Agreement created",
        detail: `${formatEther(args.requiredEscrow)} ETH proposed for escrow.`,
      };
    case "AgreementVerifierAssigned":
      return { title: "Verifier nominated", detail: "The Shipper assigned an independent Verifier to this agreement." };
    case "AgreementAccepted":
      return { title: "Carrier accepted", detail: "The Carrier accepted the delivery assignment." };
    case "AgreementFunded":
      return { title: "Escrow funded", detail: `${formatEther(args.amount)} ETH locked in the contract.` };
    case "MilestoneEvidenceSubmitted":
      return {
        title: `${milestoneName(args.milestone)} evidence submitted`,
        detail: "The Carrier recorded an IPFS content identifier for Verifier review.",
        evidenceCid: args.evidenceCid,
      };
    case "MilestoneVerified":
      return {
        title: `${milestoneName(args.milestone)} approved by Verifier`,
        detail: "The nominated Verifier reviewed the evidence and supplied the matching one-time code.",
      };
    case "EscrowReleased":
      return {
        title: `${milestoneName(args.milestone)} payout released`,
        detail: `${formatEther(args.amount)} ETH paid to the Carrier.`,
      };
    case "AgreementCompleted":
      return { title: "Agreement completed", detail: "Both delivery milestones are complete." };
    case "AgreementCancelled":
      return { title: "Agreement cancelled", detail: "The unfunded agreement was cancelled by the Shipper." };
    case "AgreementRefunded":
      return { title: "Escrow refunded", detail: `${formatEther(args.amount)} ETH returned to the Shipper.` };
    default:
      return { title: name, detail: "On-chain agreement event." };
  }
}

export async function loadAgreementHistory(contract, agreementIds) {
  if (agreementIds.length === 0) return [];

  const ownedIds = new Set(agreementIds.map((agreementId) => agreementId.toString()));
  const eventGroups = await Promise.all(
    AGREEMENT_EVENT_NAMES.map((eventName) =>
      contract.queryFilter(contract.filters[eventName](), 0, "latest"),
    ),
  );
  const logs = eventGroups
    .flat()
    .filter((log) => log.args?.agreementId && ownedIds.has(log.args.agreementId.toString()));

  const provider = contract.runner.provider;
  const blockNumbers = [...new Set(logs.map((log) => log.blockNumber))];
  const blocks = await Promise.all(blockNumbers.map((blockNumber) => provider.getBlock(blockNumber)));
  const timestamps = new Map(blocks.map((block) => [block.number, block.timestamp]));

  return logs
    .sort((left, right) => left.blockNumber - right.blockNumber || left.index - right.index)
    .map((log) => ({
      key: `${log.transactionHash}-${log.index}`,
      agreementId: log.args.agreementId.toString(),
      transactionHash: log.transactionHash,
      timestamp: timestamps.get(log.blockNumber),
      ...describeEvent(log),
    }));
}
