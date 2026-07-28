import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const rootDir = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(rootDir, "contracts", "FleetMinerSlots.sol");
const source = fs.readFileSync(sourcePath, "utf8");

const input = {
  language: "Solidity",
  sources: { "FleetMinerSlots.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": [
          "abi",
          "evm.bytecode.object",
          "evm.deployedBytecode.object",
        ],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const diagnostics = output.errors ?? [];
const errors = diagnostics.filter((entry) => entry.severity === "error");
if (errors.length > 0) {
  throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
}

const compiled = output.contracts?.["FleetMinerSlots.sol"]?.FleetMinerSlots;
if (!compiled?.evm?.bytecode?.object) {
  throw new Error("FleetMinerSlots bytecode was not generated");
}

const functions = new Set(
  compiled.abi
    .filter((entry) => entry.type === "function")
    .map((entry) => entry.name),
);
const requiredFunctions = [
  "buyMiner",
  "buyMinerWithDiscount",
  "buyMinerToMax",
  "buyMinerToMaxWithDiscount",
  "upgradeMiner",
  "upgradeMinerWithDiscount",
  "upgradeMinerToMax",
  "upgradeMinerToMaxWithDiscount",
  "restoreMiner",
  "claimPassivePoints",
  "claimAllPassivePoints",
  "minerStateOf",
  "allMinerStatesOf",
  "discountDigest",
];
for (const name of requiredFunctions) {
  if (!functions.has(name)) throw new Error(`Missing required ABI function: ${name}`);
}

const constructor = compiled.abi.find((entry) => entry.type === "constructor");
if (constructor?.inputs?.length !== 5) {
  throw new Error("Constructor must have exactly five address arguments");
}

const initCodeBytes = compiled.evm.bytecode.object.length / 2;
const runtimeBytes = compiled.evm.deployedBytecode.object.length / 2;
if (runtimeBytes >= 24_576) {
  throw new Error(`Runtime bytecode exceeds EIP-170 limit: ${runtimeBytes} bytes`);
}

for (const warning of diagnostics.filter((entry) => entry.severity === "warning")) {
  console.warn(warning.formattedMessage.trim());
}

console.log("FleetMinerSlots compile smoke passed");
console.log(`ABI functions: ${functions.size}`);
console.log(`Init bytecode: ${initCodeBytes} bytes`);
console.log(`Runtime bytecode: ${runtimeBytes} bytes`);
