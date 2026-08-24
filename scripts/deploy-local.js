import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { network } from "hardhat";

const { ethers, networkName } = await network.create();

console.log(`Deploying ProofRouteEscrow to ${networkName}...`);
const contract = await ethers.deployContract("ProofRouteEscrow");
await contract.waitForDeployment();

const address = await contract.getAddress();
const artifactPath = path.resolve(
  "artifacts/contracts/ProofRouteEscrow.sol/ProofRouteEscrow.json",
);
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const outputDirectory = path.resolve("frontend/src/contracts");
const outputPath = path.join(outputDirectory, "deployment.json");

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      contractName: "ProofRouteEscrow",
      chainId: 31337,
      address,
      abi: artifact.abi,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`ProofRouteEscrow deployed at ${address}`);
console.log(`Frontend deployment data written to ${outputPath}`);
