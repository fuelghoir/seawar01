import { headers } from "next/headers";
import HomeClient from "./HomeClient";

function getInitialIsNarrowScreen(headersList: Headers) {
  const ua = headersList.get("user-agent") ?? "";
  const clientHintMobile = headersList.get("sec-ch-ua-mobile");
  const viewportWidth = Number(
    headersList.get("viewport-width") ?? headersList.get("sec-ch-viewport-width")
  );

  if (clientHintMobile === "?1") return true;
  if (Number.isFinite(viewportWidth) && viewportWidth <= 720) return true;

  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile|BaseApp|CoinbaseWallet|Farcaster/i.test(
    ua
  );
}

export default async function Page() {
  const headersList = await headers();

  return (
    <HomeClient
      initialIsNarrowScreen={getInitialIsNarrowScreen(headersList)}
    />
  );
}
