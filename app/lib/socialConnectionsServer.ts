import { adminSupabase } from "./adminSupabase";

export { adminSupabase };

export type SocialProvider = "x" | "telegram";

export type SocialConnection = {
  wallet: string;
  provider: SocialProvider;
  provider_user_id: string | null;
  provider_username: string | null;
  base_verify_token: string | null;
  metadata: Record<string, unknown> | null;
  connected_at: string;
  updated_at: string;
};



export type AdminClient = NonNullable<ReturnType<typeof adminSupabase>>;

export function normalizeWallet(value: unknown) {
  const wallet = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : null;
}

export function socialDbMissingMessage(message: string) {
  if (/duplicate key|unique constraint|idx_social_connections_provider_user/i.test(message)) {
    return "This social account is already connected to another wallet. Try another account.";
  }

  return /schema cache|could not find the table|relation .*social_(connections|oauth_states|link_codes).* does not exist/i.test(message)
    ? "Social connections database is missing. Run scripts/supabase-social-connections.sql in Supabase."
    : message;
}

export async function getSocialConnections(admin: AdminClient, wallet: string) {
  const { data, error } = await admin
    .from("social_connections")
    .select("wallet,provider,provider_user_id,provider_username,base_verify_token,metadata,connected_at,updated_at")
    .eq("wallet", wallet);

  if (error) throw new Error(socialDbMissingMessage(error.message));
  return (data || []) as SocialConnection[];
}

export async function getSocialConnection(
  admin: AdminClient,
  wallet: string,
  provider: SocialProvider,
) {
  const { data, error } = await admin
    .from("social_connections")
    .select("wallet,provider,provider_user_id,provider_username,base_verify_token,metadata,connected_at,updated_at")
    .eq("wallet", wallet)
    .eq("provider", provider)
    .maybeSingle();

  if (error) throw new Error(socialDbMissingMessage(error.message));
  return (data as SocialConnection | null) ?? null;
}

export async function upsertSocialConnection(
  admin: AdminClient,
  row: {
    wallet: string;
    provider: SocialProvider;
    provider_user_id?: string | null;
    provider_username?: string | null;
    base_verify_token?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const now = new Date().toISOString();
  const existing = await getSocialConnection(admin, row.wallet, row.provider).catch(() => null);
  const { data, error } = await admin
    .from("social_connections")
    .upsert(
      {
        wallet: row.wallet,
        provider: row.provider,
        provider_user_id: row.provider_user_id ?? existing?.provider_user_id ?? null,
        provider_username: row.provider_username ?? existing?.provider_username ?? null,
        base_verify_token: row.base_verify_token ?? existing?.base_verify_token ?? null,
        metadata: {
          ...(existing?.metadata ?? {}),
          ...(row.metadata ?? {}),
        },
        connected_at: existing?.connected_at ?? now,
        updated_at: now,
      },
      { onConflict: "wallet,provider" },
    )
    .select("wallet,provider,provider_user_id,provider_username,base_verify_token,metadata,connected_at,updated_at")
    .single();

  if (error) throw new Error(socialDbMissingMessage(error.message));
  return data as SocialConnection;
}
