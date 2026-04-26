"use client";

import { useState, useEffect } from "react";
import { getWalletName, shortAddress } from "../lib/ens";

interface Props {
  address: string;
  className?: string;
}

export function WalletName({ address, className }: Props) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getWalletName(address).then(n => {
      if (!cancelled) setName(n);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [address]);

  return (
    <span className={className} title={address}>
      {name ?? shortAddress(address)}
    </span>
  );
}
