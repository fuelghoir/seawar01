import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  encodePacked,
  fallback,
  hashMessage,
  http,
  isAddress,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { secp256k1 } from "@noble/curves/secp256k1";
import crypto from "crypto";
import { isBaseAppUserAgent } from "../../../lib/baseApp";
import {
  FLEET_MINER_DISCOUNT_ACTION,
  FLEET_MINER_DISCOUNT_DOMAIN,
  FLEET_MINER_DISCOUNT_TYPES,
  FLEET_MINER_SLOTS_CONTRACT_ADDRESS,
  fleetMinerSlotsAbi,
} from "../../../contracts/fleetMinerSlotsAbi";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BASE_RPCS = [
  process.env.NEXT_PUBLIC_BASE_RPC_URL,
  "https://base-rpc.publicnode.com",
  "https://base.meowrpc.com",
  "https://base.drpc.org",
  "https://mainnet.base.org",
].filter(Boolean) as string[];
const publicClient = createPublicClient({
  chain: base,
  transport: fallback(
    BASE_RPCS.map((url) => http(url, { retryCount: 0, timeout: 3_000 })),
    { retryCount: 0 },
  ),
});

const SLOT_ACTIONS = {
  slotBuyWithDiscount: FLEET_MINER_DISCOUNT_ACTION.buy,
  slotUpgradeWithDiscount: FLEET_MINER_DISCOUNT_ACTION.upgrade,
  slotMaxWithDiscount: FLEET_MINER_DISCOUNT_ACTION.max,
  slotBuyMaxWithDiscount: FLEET_MINER_DISCOUNT_ACTION.buyMax,
} as const;

type SlotAction = keyof typeof SLOT_ACTIONS;

export async function GET(req: NextRequest) {
  const wallet = String(req.nextUrl.searchParams.get("wallet") || "").trim();
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "Valid wallet required" }, { status: 400 });
  }

  const userAgent = req.headers.get("user-agent") || "";
  if (!isBaseAppUserAgent(userAgent)) {
    return NextResponse.json(
      { error: "Not eligible for discount. Please use Base App." },
      { status: 403 },
    );
  }

  const pk = process.env.DISCOUNT_SIGNER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) {
    return NextResponse.json({ error: "Signer not configured" }, { status: 500 });
  }

  if (req.nextUrl.searchParams.get("scope") === "slots") {
    return signSlotDiscount(req, wallet, pk);
  }

  return signLegacyDiscount(req, wallet, pk);
}

async function signSlotDiscount(req: NextRequest, wallet: `0x${string}`, privateKey: string) {
  if (FLEET_MINER_SLOTS_CONTRACT_ADDRESS === ZERO_ADDRESS) {
    return NextResponse.json(
      { error: "Extra miner contract is not deployed" },
      { status: 503 },
    );
  }

  const actionName = String(req.nextUrl.searchParams.get("action") || "") as SlotAction;
  const action = SLOT_ACTIONS[actionName];
  const slot = Number(req.nextUrl.searchParams.get("slot"));
  if (!action || !Number.isInteger(slot) || slot < 1 || slot > 9) {
    return NextResponse.json({ error: "Invalid slot discount request" }, { status: 400 });
  }

  try {
    const account = privateKeyToAccount(normalizePrivateKey(privateKey));
    const [state, nonce, onchainSigner] = await Promise.all([
      publicClient.readContract({
        address: FLEET_MINER_SLOTS_CONTRACT_ADDRESS,
        abi: fleetMinerSlotsAbi,
        functionName: "minerStateOf",
        args: [wallet, slot],
      }),
      publicClient.readContract({
        address: FLEET_MINER_SLOTS_CONTRACT_ADDRESS,
        abi: fleetMinerSlotsAbi,
        functionName: "discountNonces",
        args: [wallet],
      }),
      publicClient.readContract({
        address: FLEET_MINER_SLOTS_CONTRACT_ADDRESS,
        abi: fleetMinerSlotsAbi,
        functionName: "signerAddress",
      }),
    ]);

    if (onchainSigner.toLowerCase() !== account.address.toLowerCase()) {
      return NextResponse.json(
        { error: "Discount signer does not match the contract" },
        { status: 503 },
      );
    }

    let fullPrice: bigint;
    if (actionName === "slotBuyWithDiscount") {
      if (state.owned || !state.unlocked) throw new Error("Slot is not available for purchase");
      fullPrice = BigInt(500_000);
    } else if (actionName === "slotBuyMaxWithDiscount") {
      if (state.owned || !state.unlocked) throw new Error("Slot is not available for purchase");
      fullPrice = await publicClient.readContract({
        address: FLEET_MINER_SLOTS_CONTRACT_ADDRESS,
        abi: fleetMinerSlotsAbi,
        functionName: "fullMinerPrice",
      });
    } else if (actionName === "slotUpgradeWithDiscount") {
      if (!state.owned || state.maxed || state.nextPrice <= BigInt(0)) {
        throw new Error("Miner cannot be upgraded");
      }
      fullPrice = state.nextPrice;
    } else {
      if (!state.owned || state.maxed || state.maxUpgradePrice <= BigInt(0)) {
        throw new Error("Miner cannot be upgraded to max");
      }
      fullPrice = state.maxUpgradePrice;
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 5 * 60);
    const signature = await account.signTypedData({
      domain: {
        ...FLEET_MINER_DISCOUNT_DOMAIN,
        chainId: base.id,
        verifyingContract: FLEET_MINER_SLOTS_CONTRACT_ADDRESS,
      },
      types: FLEET_MINER_DISCOUNT_TYPES,
      primaryType: "Discount",
      message: {
        player: wallet,
        slot,
        action,
        fullPrice,
        nonce,
        deadline,
      },
    });

    return NextResponse.json({
      signature,
      deadline: deadline.toString(),
      nonce: nonce.toString(),
      fullPrice: fullPrice.toString(),
      paidPrice: ((fullPrice * BigInt(5_000)) / BigInt(10_000)).toString(),
      action,
      slot,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sign slot discount" },
      { status: 400 },
    );
  }
}

function signLegacyDiscount(req: NextRequest, wallet: `0x${string}`, privateKey: string) {
  const action = req.nextUrl.searchParams.get("action");
  let signAction = "discount_buy";
  if (action === "upgradeWithDiscount") signAction = "discount_upgrade";
  if (action === "maxWithDiscount") signAction = "discount_max_upgrade";

  try {
    const rawPk = normalizePrivateKey(privateKey).slice(2);
    const privKeyBytes = Buffer.from(rawPk, "hex");
    const messageHash = keccak256(
      encodePacked(["address", "string"], [wallet, signAction]),
    );
    const ethHash = hashMessage({ raw: messageHash });
    const sigObj = secp256k1.sign(ethHash.slice(2), privKeyBytes, {
      extraEntropy: crypto.randomBytes(32),
    });
    const r = sigObj.r.toString(16).padStart(64, "0");
    const s = sigObj.s.toString(16).padStart(64, "0");
    const v = sigObj.recovery === 0 ? "1b" : "1c";
    return NextResponse.json({ signature: `0x${r}${s}${v}` });
  } catch {
    return NextResponse.json({ error: "Failed to generate signature" }, { status: 500 });
  }
}

function normalizePrivateKey(value: string): `0x${string}` {
  const normalized = value.trim();
  return (normalized.startsWith("0x") ? normalized : `0x${normalized}`) as `0x${string}`;
}
