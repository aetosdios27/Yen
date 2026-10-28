import type { MetadataRoute } from "next";
import { en } from "../i18n/messages/en";

export const MANIFEST_THEME_COLOR = "#14532d";
export const MANIFEST_BACKGROUND_COLOR = "#ffffff";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: en.app.name,
    short_name: en.app.name,
    description: en.metadata.appDescription,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: MANIFEST_BACKGROUND_COLOR,
    theme_color: MANIFEST_THEME_COLOR,
    lang: "en",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
