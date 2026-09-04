import { BrowserProvider, Contract } from "ethers";
import deployment from "../contracts/deployment.json";

export const LOCAL_CHAIN_ID = Number(deployment.chainId || 31337);
export const LOCAL_CHAIN_HEX = `0x${LOCAL_CHAIN_ID.toString(16)}`;

export function hasDeployment() {
  return Boolean(deployment.address && deployment.abi.length);
}

export function hasWallet() {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

export async function readWalletState({ requestAccounts = false } = {}) {
  if (!hasWallet()) throw new Error("MetaMask is not installed.");

  const provider = new BrowserProvider(window.ethereum);
  const method = requestAccounts ? "eth_requestAccounts" : "eth_accounts";
  const accounts = await provider.send(method, []);
  const network = await provider.getNetwork();

  return {
    provider,
    account: accounts[0] ?? "",
    chainId: Number(network.chainId),
  };
}

export async function createContract(provider, account) {
  if (!hasDeployment()) throw new Error("The contract has not been deployed locally yet.");
  const signer = await provider.getSigner(account);
  return new Contract(deployment.address, deployment.abi, signer);
}

export async function switchToLocalNetwork() {
  if (!hasWallet()) throw new Error("MetaMask is not installed.");

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: LOCAL_CHAIN_HEX }],
    });
  } catch (error) {
    if (error.code !== 4902) throw error;

    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: LOCAL_CHAIN_HEX,
          chainName: "Hardhat Local",
          nativeCurrency: { name: "Test Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["http://127.0.0.1:8545"],
        },
      ],
    });
  }
}

export function explainWalletError(error) {
  if (error?.code === 4001 || error?.code === "ACTION_REJECTED") {
    return "The MetaMask request was rejected. No blockchain change was made.";
  }

  const rawMessage =
    error?.revert?.name ||
    error?.shortMessage ||
    error?.info?.error?.message ||
    error?.reason ||
    error?.message ||
    "The transaction could not be completed.";

  const friendlyCustomErrors = {
    AlreadyRegistered: "This wallet is already registered.",
    InvalidRole: "This wallet does not have the required role.",
    InvalidCarrier: "The carrier wallet is not registered as a Carrier.",
    SelfAssignment: "A shipper cannot also be the carrier for the same agreement.",
    InvalidDeadline: "Choose a deadline in the future.",
    IncorrectEscrowAmount: "The escrow deposit must exactly match the agreement amount.",
    DeadlinePassed: "The agreement deadline has already passed.",
    DeadlineNotPassed: "The refund is available only after the deadline.",
    InvalidAgreementStatus: "That action is not allowed in the agreement's current state.",
    InvalidMilestoneOrder: "Complete the required earlier step before submitting this proof.",
    InvalidMilestoneProof: "The proof code does not match the code prepared by the Shipper.",
    MilestoneAlreadyCompleted: "That milestone has already been verified and paid.",
    EtherTransferFailed: "The Ether transfer failed, so the blockchain change was rolled back.",
    Unauthorized: "The connected wallet is not authorized for that action.",
  };

  const matchingName = Object.keys(friendlyCustomErrors).find((name) => rawMessage.includes(name));
  return matchingName ? friendlyCustomErrors[matchingName] : rawMessage.replace("execution reverted: ", "");
}
