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

  const friendlyRevertReasons = {
    "Wallet is already registered": "This wallet is already registered.",
    "Wallet has the wrong role": "This wallet does not have the required role.",
    "Carrier must be registered as Carrier": "The carrier wallet is not registered as a Carrier.",
    "Verifier must be registered and different": "The Verifier wallet must be registered as a Verifier and differ from both participants.",
    "Shipper and Carrier must be different": "A Shipper cannot also be the Carrier for the same agreement.",
    "Deadline must be in the future": "Choose a deadline in the future.",
    "Exact escrow amount is required": "The escrow deposit must exactly match the agreement amount.",
    "Agreement deadline has passed": "The agreement deadline has already passed.",
    "Agreement deadline has not passed": "The refund is available only after the deadline.",
    "Pickup requires a funded agreement": "Fund the agreement before submitting pickup evidence or approval.",
    "Delivery requires approved pickup": "Approve pickup before submitting delivery evidence or approval.",
    "Proof code is incorrect": "The proof code does not match the code prepared by the Shipper.",
    "Milestone is already completed": "That milestone has already been verified and paid.",
    "Evidence CID must be 1 to 128 characters": "The evidence CID must contain 1 to 128 characters.",
    "Evidence must be submitted before approval": "The Carrier must submit evidence before the Verifier can approve this milestone.",
    "Ether transfer failed": "The Ether transfer failed, so the blockchain change was rolled back.",
  };

  const matchingReason = Object.keys(friendlyRevertReasons).find((reason) => rawMessage.includes(reason));
  return matchingReason
    ? friendlyRevertReasons[matchingReason]
    : rawMessage.replace("execution reverted: ", "").replace(/^"|"$/g, "");
}
