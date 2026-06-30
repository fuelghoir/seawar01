import type { MetadataRoute } from "next";
import { absoluteUrl } from "./lib/seo";

const publicRoutes = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/play", priority: 0.92, changeFrequency: "daily" },
  { path: "/season", priority: 0.9, changeFrequency: "daily" },
  { path: "/shop", priority: 0.86, changeFrequency: "daily" },
  { path: "/leaderboard", priority: 0.82, changeFrequency: "hourly" },
  { path: "/challenge", priority: 0.72, changeFrequency: "weekly" },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return publicRoutes.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
